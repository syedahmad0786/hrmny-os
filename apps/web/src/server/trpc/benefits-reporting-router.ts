import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  availableHrReportingModules,
  canAccessBenefitsEmployee,
  isBenefitsHrAdmin,
  isEligibleForBenefit,
  type EligibilityEmployee,
  type EligibilityRule,
  type HrReportingPresence,
} from "../benefits-reporting";
import { getDb } from "../db";
import { writeAudit } from "../m1-persistence";
import { router, staffProcedure, type TrpcContext } from "./trpc";

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for benefits",
    });
  }
  return db;
}

function actor(ctx: TrpcContext) {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return { employeeId: ctx.employeeId, roles: ctx.roles };
}

function requireHr(ctx: TrpcContext) {
  if (!isBenefitsHrAdmin(ctx.roles)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "HR access required" });
  }
  return actor(ctx);
}

function targetEmployee(ctx: TrpcContext, requested?: string) {
  const current = actor(ctx);
  const target = requested ?? current.employeeId;
  if (
    !canAccessBenefitsEmployee({
      actorEmployeeId: current.employeeId,
      targetEmployeeId: target,
      roles: current.roles,
    })
  ) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return target;
}

async function audit(
  ctx: TrpcContext,
  action: string,
  entityType: string,
  entityId: string,
  after: Record<string, unknown>,
) {
  await writeAudit({
    actorEmployeeId: actor(ctx).employeeId,
    action,
    entityType,
    entityId,
    before: null,
    after,
    reason: null,
  });
}

const uuid = z.string().uuid();
const optionalEmployee = z.object({ employeeId: uuid.optional() }).optional();
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .default("AED");
const storagePath = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .regex(/^[a-zA-Z0-9/_\-.]+$/)
  .refine((value) => !value.includes(".."), "Invalid storage path");

async function employeeEligibility(employeeId: string) {
  const rows = await requireDb().execute(sql<EligibilityEmployee>`
    select
      e.department,
      p.employment_type as "employmentType",
      p.joining_date::text as "joiningDate"
    from public.employee e
    left join public.employee_hr_profile p on p.employee_id = e.employee_id
    where e.employee_id = ${employeeId}::uuid and e.is_active = true
    limit 1
  `);
  const employee = rows[0] as unknown as EligibilityEmployee | undefined;
  if (!employee) throw new TRPCError({ code: "NOT_FOUND" });
  return employee;
}

async function benefitRules(benefitId: string) {
  const rows = await requireDb().execute(sql<EligibilityRule>`
    select
      department,
      employment_type as "employmentType",
      min_service_days as "minServiceDays",
      starts_at::text as "startsAt",
      ends_at::text as "endsAt",
      is_active as "isActive"
    from public.benefit_eligibility_rule
    where benefit_id = ${benefitId}::uuid
  `);
  return rows as unknown as EligibilityRule[];
}

export const benefitsReportingRouter = router({
  catalog: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const employee = await employeeEligibility(current.employeeId);
      const benefits = await requireDb().execute(sql`
        select benefit_id, code, name, category, description, currency,
          employee_contribution_limit, employer_contribution_limit
        from public.benefit_catalog
        where is_active = true
        order by category, name
      `);
      const rules = (await requireDb().execute(sql<
        EligibilityRule & { benefitId: string }
      >`
          select
            benefit_id as "benefitId", department,
            employment_type as "employmentType",
            min_service_days as "minServiceDays",
            starts_at::text as "startsAt", ends_at::text as "endsAt",
            is_active as "isActive"
          from public.benefit_eligibility_rule
        `)) as unknown as Array<EligibilityRule & { benefitId: string }>;
      return benefits.map((benefit) => ({
        ...benefit,
        eligible: isEligibleForBenefit(
          rules.filter((rule) => rule.benefitId === benefit.benefit_id),
          employee,
        ),
      }));
    }),

    adminList: staffProcedure.query(async ({ ctx }) => {
      requireHr(ctx);
      return requireDb().execute(sql`
        select * from public.benefit_catalog order by category, name
      `);
    }),

    create: staffProcedure
      .input(
        z.object({
          code: z.string().trim().min(2).max(80),
          name: z.string().trim().min(2).max(160),
          category: z.enum([
            "health_insurance",
            "allowance",
            "wellness",
            "perk",
            "other",
          ]),
          description: z.string().trim().max(2_000).optional(),
          providerName: z.string().trim().max(160).optional(),
          providerReference: z.string().trim().max(160).optional(),
          providerTerms: z.record(z.unknown()).default({}),
          currency,
          employeeContributionLimit: z.number().nonnegative().optional(),
          employerContributionLimit: z.number().nonnegative().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireHr(ctx);
        const rows = await requireDb().execute(sql`
          insert into public.benefit_catalog (
            code, name, category, description, provider_name,
            provider_reference, provider_terms, currency,
            employee_contribution_limit, employer_contribution_limit
          ) values (
            ${input.code}, ${input.name}, ${input.category},
            ${input.description ?? null}, ${input.providerName ?? null},
            ${input.providerReference ?? null},
            ${JSON.stringify(input.providerTerms)}::jsonb, ${input.currency},
            ${input.employeeContributionLimit ?? null},
            ${input.employerContributionLimit ?? null}
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "benefit.catalog.create",
          "benefit_catalog",
          String(created.benefit_id),
          {
            code: input.code,
            category: input.category,
          },
        );
        return created;
      }),

    setActive: staffProcedure
      .input(z.object({ benefitId: uuid, isActive: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        requireHr(ctx);
        const rows = await requireDb().execute(sql`
          update public.benefit_catalog
          set is_active = ${input.isActive}, updated_at = now()
          where benefit_id = ${input.benefitId}::uuid
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "benefit.catalog.status",
          "benefit_catalog",
          input.benefitId,
          {
            isActive: input.isActive,
          },
        );
        return rows[0];
      }),

    addEligibilityRule: staffProcedure
      .input(
        z.object({
          benefitId: uuid,
          department: z.string().trim().max(120).optional(),
          employmentType: z.string().trim().max(80).optional(),
          minServiceDays: z.number().int().min(0).max(20_000).default(0),
          startsAt: z.string().date().optional(),
          endsAt: z.string().date().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireHr(ctx);
        if (input.startsAt && input.endsAt && input.endsAt < input.startsAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid rule dates",
          });
        }
        const rows = await requireDb().execute(sql`
          insert into public.benefit_eligibility_rule (
            benefit_id, department, employment_type, min_service_days,
            starts_at, ends_at
          ) values (
            ${input.benefitId}::uuid, ${input.department ?? null},
            ${input.employmentType ?? null}, ${input.minServiceDays},
            ${input.startsAt ?? null}::date, ${input.endsAt ?? null}::date
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "benefit.eligibility.create",
          "benefit_eligibility_rule",
          String(created.benefit_eligibility_rule_id),
          { benefitId: input.benefitId },
        );
        return created;
      }),

    setEligibilityRuleActive: staffProcedure
      .input(z.object({ ruleId: uuid, isActive: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        requireHr(ctx);
        const rows = await requireDb().execute(sql`
          update public.benefit_eligibility_rule
          set is_active = ${input.isActive}, updated_at = now()
          where benefit_eligibility_rule_id = ${input.ruleId}::uuid
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "benefit.eligibility.status",
          "benefit_eligibility_rule",
          input.ruleId,
          { isActive: input.isActive },
        );
        return rows[0];
      }),
  }),

  enrolments: router({
    list: staffProcedure
      .input(optionalEmployee)
      .query(async ({ input, ctx }) => {
        if (isBenefitsHrAdmin(ctx.roles) && !input?.employeeId) {
          return requireDb().execute(sql`
            select e.*, b.code, b.name, b.category, b.currency,
              person.display_name, person.email
            from public.benefit_enrolment e
            join public.benefit_catalog b on b.benefit_id = e.benefit_id
            join public.employee person on person.employee_id = e.employee_id
            order by e.status, e.created_at desc
          `);
        }
        const employeeId = targetEmployee(ctx, input?.employeeId);
        return requireDb().execute(sql`
        select e.*, b.code, b.name, b.category, b.currency
        from public.benefit_enrolment e
        join public.benefit_catalog b on b.benefit_id = e.benefit_id
        where e.employee_id = ${employeeId}::uuid
        order by e.created_at desc
      `);
      }),

    request: staffProcedure
      .input(
        z.object({
          benefitId: uuid,
          employeeNote: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        const benefits = await requireDb().execute(sql<{ is_active: boolean }>`
          select is_active from public.benefit_catalog
          where benefit_id = ${input.benefitId}::uuid
          limit 1
        `);
        if (!benefits[0]?.is_active) throw new TRPCError({ code: "NOT_FOUND" });
        if (
          !isEligibleForBenefit(
            await benefitRules(input.benefitId),
            await employeeEligibility(current.employeeId),
          )
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not eligible for this benefit",
          });
        }
        const rows = await requireDb().execute(sql`
          insert into public.benefit_enrolment (
            benefit_id, employee_id, employee_note
          ) values (
            ${input.benefitId}::uuid, ${current.employeeId}::uuid,
            ${input.employeeNote ?? null}
          )
          on conflict (benefit_id, employee_id)
            where status in ('requested', 'active') do nothing
          returning *
        `);
        const created = rows[0];
        if (!created) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Open enrolment already exists",
          });
        }
        await audit(
          ctx,
          "benefit.enrolment.request",
          "benefit_enrolment",
          String(created.benefit_enrolment_id),
          {
            benefitId: input.benefitId,
          },
        );
        return created;
      }),

    decide: staffProcedure
      .input(
        z.object({
          enrolmentId: uuid,
          status: z.enum(["active", "declined"]),
          coverageStart: z.string().date().optional(),
          coverageEnd: z.string().date().optional(),
          employeeContribution: z.number().nonnegative().default(0),
          employerContribution: z.number().nonnegative().default(0),
          decisionNote: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireHr(ctx);
        const rows = await requireDb().execute(sql`
          update public.benefit_enrolment enrolment
          set status = ${input.status},
            coverage_start = case when ${input.status} = 'active'
              then coalesce(${input.coverageStart ?? null}::date, current_date)
              else coverage_start end,
            coverage_end = ${input.coverageEnd ?? null}::date,
            employee_contribution = ${input.employeeContribution},
            employer_contribution = ${input.employerContribution},
            decision_note = ${input.decisionNote ?? null},
            approved_by_employee_id = ${current.employeeId}::uuid,
            decided_at = now(), updated_at = now()
          from public.benefit_catalog benefit
          where enrolment.benefit_enrolment_id = ${input.enrolmentId}::uuid
            and enrolment.benefit_id = benefit.benefit_id
            and enrolment.status = 'requested'
            and (
              benefit.employee_contribution_limit is null
              or ${input.employeeContribution} <= benefit.employee_contribution_limit
            )
            and (
              benefit.employer_contribution_limit is null
              or ${input.employerContribution} <= benefit.employer_contribution_limit
            )
          returning enrolment.*
        `);
        const updated = rows[0];
        if (!updated) throw new TRPCError({ code: "CONFLICT" });
        await audit(
          ctx,
          "benefit.enrolment.decide",
          "benefit_enrolment",
          input.enrolmentId,
          {
            status: input.status,
          },
        );
        return updated;
      }),

    close: staffProcedure
      .input(
        z.object({
          enrolmentId: uuid,
          status: z.enum(["ended", "cancelled"]),
          coverageEnd: z.string().date().optional(),
          decisionNote: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireHr(ctx);
        const rows = await requireDb().execute(sql`
          update public.benefit_enrolment
          set status = ${input.status},
            coverage_end = coalesce(${input.coverageEnd ?? null}::date, current_date),
            decision_note = ${input.decisionNote ?? null},
            approved_by_employee_id = ${current.employeeId}::uuid,
            decided_at = now(), updated_at = now()
          where benefit_enrolment_id = ${input.enrolmentId}::uuid
            and status in ('requested', 'active')
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "CONFLICT" });
        await audit(
          ctx,
          "benefit.enrolment.close",
          "benefit_enrolment",
          input.enrolmentId,
          {
            status: input.status,
          },
        );
        return rows[0];
      }),
  }),

  dependants: router({
    list: staffProcedure
      .input(optionalEmployee)
      .query(async ({ input, ctx }) => {
        const employeeId = targetEmployee(ctx, input?.employeeId);
        return requireDb().execute(sql`
        select employee_dependant_id, employee_id, display_name, relationship,
          date_of_birth, nationality, emirates_id_number, status, created_at, updated_at
        from public.employee_dependant
        where employee_id = ${employeeId}::uuid
        order by status, display_name
      `);
      }),

    create: staffProcedure
      .input(
        z.object({
          employeeId: uuid.optional(),
          displayName: z.string().trim().min(2).max(160),
          relationship: z.enum(["spouse", "child", "parent", "other"]),
          dateOfBirth: z.string().date().optional(),
          nationality: z.string().trim().max(100).optional(),
          emiratesIdNumber: z.string().trim().max(80).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = targetEmployee(ctx, input.employeeId);
        const rows = await requireDb().execute(sql`
          insert into public.employee_dependant (
            employee_id, display_name, relationship, date_of_birth,
            nationality, emirates_id_number
          ) values (
            ${employeeId}::uuid, ${input.displayName}, ${input.relationship},
            ${input.dateOfBirth ?? null}::date, ${input.nationality ?? null},
            ${input.emiratesIdNumber ?? null}
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "benefit.dependant.create",
          "employee_dependant",
          String(created.employee_dependant_id),
          {
            employeeId,
            relationship: input.relationship,
          },
        );
        return created;
      }),

    setStatus: staffProcedure
      .input(
        z.object({ dependantId: uuid, status: z.enum(["active", "inactive"]) }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        const rows = await requireDb().execute(sql<{ employee_id: string }>`
          select employee_id from public.employee_dependant
          where employee_dependant_id = ${input.dependantId}::uuid limit 1
        `);
        const existing = rows[0] as { employee_id: string } | undefined;
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        targetEmployee(ctx, existing.employee_id);
        const updated = await requireDb().execute(sql`
          update public.employee_dependant
          set status = ${input.status}, updated_at = now()
          where employee_dependant_id = ${input.dependantId}::uuid
          returning *
        `);
        await audit(
          ctx,
          "benefit.dependant.status",
          "employee_dependant",
          input.dependantId,
          {
            status: input.status,
            actorEmployeeId: current.employeeId,
          },
        );
        return updated[0]!;
      }),
  }),

  health: router({
    availablePolicies: staffProcedure.query(async () =>
      requireDb().execute(sql`
        select health_policy_id, plan_name, starts_at, ends_at, status
        from public.health_policy
        where status = 'active'
        order by starts_at desc
      `),
    ),

    policies: staffProcedure.query(async ({ ctx }) => {
      requireHr(ctx);
      return requireDb().execute(sql`
        select p.*, b.name as benefit_name
        from public.health_policy p
        left join public.benefit_catalog b on b.benefit_id = p.benefit_id
        order by p.starts_at desc
      `);
    }),

    createPolicy: staffProcedure
      .input(
        z.object({
          benefitId: uuid.optional(),
          providerName: z.string().trim().min(2).max(160),
          policyNumber: z.string().trim().min(2).max(160),
          planName: z.string().trim().min(2).max(160),
          startsAt: z.string().date(),
          endsAt: z.string().date(),
          brokerContact: z.record(z.unknown()).default({}),
          documentStoragePath: storagePath.optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireHr(ctx);
        if (input.endsAt < input.startsAt)
          throw new TRPCError({ code: "BAD_REQUEST" });
        const rows = await requireDb().execute(sql`
          insert into public.health_policy (
            benefit_id, provider_name, policy_number, plan_name,
            starts_at, ends_at, broker_contact, document_storage_path
          ) values (
            ${input.benefitId ?? null}::uuid, ${input.providerName},
            ${input.policyNumber}, ${input.planName}, ${input.startsAt}::date,
            ${input.endsAt}::date, ${JSON.stringify(input.brokerContact)}::jsonb,
            ${input.documentStoragePath ?? null}
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "health.policy.create",
          "health_policy",
          String(created.health_policy_id),
          {
            planName: input.planName,
          },
        );
        return created;
      }),

    setPolicyStatus: staffProcedure
      .input(
        z.object({
          policyId: uuid,
          status: z.enum(["draft", "active", "expired", "cancelled"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireHr(ctx);
        const rows = await requireDb().execute(sql`
          update public.health_policy
          set status = ${input.status}, updated_at = now()
          where health_policy_id = ${input.policyId}::uuid
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "health.policy.status",
          "health_policy",
          input.policyId,
          {
            status: input.status,
          },
        );
        return rows[0];
      }),

    members: staffProcedure
      .input(optionalEmployee)
      .query(async ({ input, ctx }) => {
        const current = actor(ctx);
        if (isBenefitsHrAdmin(current.roles)) {
          const access = input?.employeeId
            ? sql`m.employee_id = ${input.employeeId}::uuid`
            : sql`true`;
          return requireDb().execute(sql`
          select m.*, d.display_name as dependant_name, d.relationship,
            p.provider_name, p.policy_number, p.plan_name, p.status as policy_status,
            p.broker_contact, p.document_storage_path
          from public.health_policy_member m
          join public.health_policy p on p.health_policy_id = m.health_policy_id
          left join public.employee_dependant d
            on d.employee_dependant_id = m.employee_dependant_id
          where ${access}
          order by m.status, m.created_at desc
        `);
        }
        const employeeId = targetEmployee(ctx, input?.employeeId);
        return requireDb().execute(sql`
        select m.health_policy_member_id, m.health_policy_id,
          m.employee_dependant_id,
          m.member_number, m.status, m.effective_from, m.effective_to,
          d.display_name as dependant_name, d.relationship, p.plan_name,
          p.starts_at as policy_starts_at, p.ends_at as policy_ends_at
        from public.health_policy_member m
        join public.health_policy p on p.health_policy_id = m.health_policy_id
        left join public.employee_dependant d
          on d.employee_dependant_id = m.employee_dependant_id
        where m.employee_id = ${employeeId}::uuid
        order by m.status, m.created_at desc
      `);
      }),

    addMember: staffProcedure
      .input(
        z.object({
          policyId: uuid,
          employeeId: uuid,
          dependantId: uuid.optional(),
          memberNumber: z.string().trim().max(160).optional(),
          effectiveFrom: z.string().date().optional(),
          effectiveTo: z.string().date().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireHr(ctx);
        if (input.dependantId) {
          const dependants = await requireDb().execute(sql`
            select 1 from public.employee_dependant
            where employee_dependant_id = ${input.dependantId}::uuid
              and employee_id = ${input.employeeId}::uuid
            limit 1
          `);
          if (!dependants[0]) throw new TRPCError({ code: "BAD_REQUEST" });
        }
        const rows = await requireDb().execute(sql`
          insert into public.health_policy_member (
            health_policy_id, employee_id, employee_dependant_id,
            member_number, effective_from, effective_to
          ) values (
            ${input.policyId}::uuid, ${input.employeeId}::uuid,
            ${input.dependantId ?? null}::uuid, ${input.memberNumber ?? null},
            ${input.effectiveFrom ?? null}::date, ${input.effectiveTo ?? null}::date
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "health.member.create",
          "health_policy_member",
          String(created.health_policy_member_id),
          {
            employeeId: input.employeeId,
            hasDependant: Boolean(input.dependantId),
          },
        );
        return created;
      }),

    setMemberStatus: staffProcedure
      .input(
        z.object({
          memberId: uuid,
          status: z.enum([
            "pending",
            "active",
            "suspended",
            "ended",
            "rejected",
          ]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireHr(ctx);
        const rows = await requireDb().execute(sql`
          update public.health_policy_member
          set status = ${input.status}, updated_at = now(),
            effective_to = case when ${input.status} = 'ended'
              then coalesce(effective_to, current_date) else effective_to end
          where health_policy_member_id = ${input.memberId}::uuid
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "health.member.status",
          "health_policy_member",
          input.memberId,
          {
            status: input.status,
          },
        );
        return rows[0];
      }),

    cards: staffProcedure
      .input(optionalEmployee)
      .query(async ({ input, ctx }) => {
        const current = actor(ctx);
        const access = isBenefitsHrAdmin(current.roles)
          ? input?.employeeId
            ? sql`m.employee_id = ${input.employeeId}::uuid`
            : sql`true`
          : sql`m.employee_id = ${targetEmployee(ctx, input?.employeeId)}::uuid`;
        return requireDb().execute(sql`
        select c.health_insurance_card_id, c.health_policy_member_id,
          c.card_number, c.storage_path, c.issued_at, c.expires_at, c.status,
          p.plan_name, m.member_number, d.display_name as dependant_name,
          d.relationship
        from public.health_insurance_card c
        join public.health_policy_member m
          on m.health_policy_member_id = c.health_policy_member_id
        join public.health_policy p on p.health_policy_id = m.health_policy_id
        left join public.employee_dependant d
          on d.employee_dependant_id = m.employee_dependant_id
        where ${access}
        order by c.status, c.expires_at desc nulls last
      `);
      }),

    addCard: staffProcedure
      .input(
        z.object({
          memberId: uuid,
          cardNumber: z.string().trim().max(160).optional(),
          storagePath,
          issuedAt: z.string().date().optional(),
          expiresAt: z.string().date().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireHr(ctx);
        const created = await requireDb().transaction(async (tx) => {
          await tx.execute(sql`
            update public.health_insurance_card
            set status = 'replaced', updated_at = now()
            where health_policy_member_id = ${input.memberId}::uuid
              and status = 'active'
          `);
          const rows = await tx.execute(sql`
            insert into public.health_insurance_card (
              health_policy_member_id, card_number, storage_path,
              issued_at, expires_at
            ) values (
              ${input.memberId}::uuid, ${input.cardNumber ?? null},
              ${input.storagePath}, ${input.issuedAt ?? null}::date,
              ${input.expiresAt ?? null}::date
            )
            returning *
          `);
          return rows[0]!;
        });
        await audit(
          ctx,
          "health.card.create",
          "health_insurance_card",
          String(created.health_insurance_card_id),
          {
            memberId: input.memberId,
          },
        );
        return created;
      }),

    endorsements: staffProcedure
      .input(optionalEmployee)
      .query(async ({ input, ctx }) => {
        const current = actor(ctx);
        if (isBenefitsHrAdmin(current.roles) && !input?.employeeId) {
          return requireDb().execute(sql`
          select e.*, p.provider_name, p.policy_number, p.plan_name
          from public.health_policy_endorsement e
          join public.health_policy p on p.health_policy_id = e.health_policy_id
          order by e.status, e.created_at desc
        `);
        }
        const employeeId = targetEmployee(ctx, input?.employeeId);
        return requireDb().execute(sql`
        select e.health_policy_endorsement_id, e.health_policy_member_id,
          e.request_type, e.request_payload, e.status, e.decision_note,
          e.handled_at, e.created_at, p.plan_name
        from public.health_policy_endorsement e
        join public.health_policy p on p.health_policy_id = e.health_policy_id
        where e.employee_id = ${employeeId}::uuid
        order by e.status, e.created_at desc
      `);
      }),

    requestEndorsement: staffProcedure
      .input(
        z.object({
          policyId: uuid,
          memberId: uuid.optional(),
          requestType: z.enum([
            "add_member",
            "remove_member",
            "change_member",
            "replace_card",
            "other",
          ]),
          requestPayload: z.record(z.unknown()).default({}),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        if (input.memberId) {
          const members = await requireDb().execute(sql`
            select 1 from public.health_policy_member
            where health_policy_member_id = ${input.memberId}::uuid
              and health_policy_id = ${input.policyId}::uuid
              and employee_id = ${current.employeeId}::uuid
            limit 1
          `);
          if (!members[0]) throw new TRPCError({ code: "FORBIDDEN" });
        } else {
          const policies = await requireDb().execute(sql`
            select 1 from public.health_policy
            where health_policy_id = ${input.policyId}::uuid
              and status = 'active'
            limit 1
          `);
          if (!policies[0]) throw new TRPCError({ code: "NOT_FOUND" });
        }
        const rows = await requireDb().execute(sql`
          insert into public.health_policy_endorsement (
            health_policy_id, health_policy_member_id, employee_id,
            request_type, request_payload, requested_by_employee_id
          ) values (
            ${input.policyId}::uuid, ${input.memberId ?? null}::uuid,
            ${current.employeeId}::uuid, ${input.requestType},
            ${JSON.stringify(input.requestPayload)}::jsonb,
            ${current.employeeId}::uuid
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "health.endorsement.request",
          "health_policy_endorsement",
          String(created.health_policy_endorsement_id),
          {
            requestType: input.requestType,
          },
        );
        return created;
      }),

    decideEndorsement: staffProcedure
      .input(
        z.object({
          endorsementId: uuid,
          status: z.enum(["processing", "completed", "rejected"]),
          decisionNote: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireHr(ctx);
        const rows = await requireDb().execute(sql`
          update public.health_policy_endorsement
          set status = ${input.status}, decision_note = ${input.decisionNote ?? null},
            handled_by_employee_id = ${current.employeeId}::uuid,
            handled_at = case when ${input.status} in ('completed', 'rejected')
              then now() else handled_at end,
            updated_at = now()
          where health_policy_endorsement_id = ${input.endorsementId}::uuid
            and status in ('requested', 'processing')
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "CONFLICT" });
        await audit(
          ctx,
          "health.endorsement.decide",
          "health_policy_endorsement",
          input.endorsementId,
          {
            status: input.status,
          },
        );
        return rows[0];
      }),
  }),

  perks: router({
    list: staffProcedure
      .input(optionalEmployee)
      .query(async ({ input, ctx }) => {
        const current = actor(ctx);
        if (isBenefitsHrAdmin(current.roles) && !input?.employeeId) {
          return requireDb().execute(sql`
          select u.*, b.code, b.name, e.display_name, e.email
          from public.employee_perk_usage u
          join public.benefit_catalog b on b.benefit_id = u.benefit_id
          join public.employee e on e.employee_id = u.employee_id
          order by u.used_at desc
        `);
        }
        const employeeId = targetEmployee(ctx, input?.employeeId);
        return requireDb().execute(sql`
        select u.*, b.code, b.name
        from public.employee_perk_usage u
        join public.benefit_catalog b on b.benefit_id = u.benefit_id
        where u.employee_id = ${employeeId}::uuid
        order by u.used_at desc
      `);
      }),

    record: staffProcedure
      .input(
        z.object({
          employeeId: uuid.optional(),
          benefitId: uuid,
          usedAt: z.string().date(),
          quantity: z.number().positive().max(1_000).default(1),
          amount: z.number().nonnegative().optional(),
          currency,
          note: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        const employeeId = targetEmployee(ctx, input.employeeId);
        const benefits = await requireDb().execute(sql`
          select 1 from public.benefit_catalog
          where benefit_id = ${input.benefitId}::uuid
            and category in ('perk', 'wellness') and is_active = true
          limit 1
        `);
        if (!benefits[0]) throw new TRPCError({ code: "BAD_REQUEST" });
        const rows = await requireDb().execute(sql`
          insert into public.employee_perk_usage (
            employee_id, benefit_id, used_at, quantity, amount, currency,
            note, recorded_by_employee_id
          ) values (
            ${employeeId}::uuid, ${input.benefitId}::uuid, ${input.usedAt}::date,
            ${input.quantity}, ${input.amount ?? null}, ${input.currency},
            ${input.note ?? null}, ${current.employeeId}::uuid
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "benefit.perk.record",
          "employee_perk_usage",
          String(created.employee_perk_usage_id),
          {
            employeeId,
            benefitId: input.benefitId,
          },
        );
        return created;
      }),

    decide: staffProcedure
      .input(
        z.object({
          usageId: uuid,
          status: z.enum(["approved", "rejected"]),
          decisionNote: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireHr(ctx);
        const rows = await requireDb().execute(sql`
          update public.employee_perk_usage
          set status = ${input.status}, decision_note = ${input.decisionNote ?? null},
            decided_by_employee_id = ${current.employeeId}::uuid,
            decided_at = now(), updated_at = now()
          where employee_perk_usage_id = ${input.usageId}::uuid
            and status = 'submitted'
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "CONFLICT" });
        await audit(
          ctx,
          "benefit.perk.decide",
          "employee_perk_usage",
          input.usageId,
          {
            status: input.status,
          },
        );
        return rows[0];
      }),
  }),

  reports: router({
    snapshot: staffProcedure
      .input(
        z
          .object({ from: z.string().date(), to: z.string().date() })
          .refine((value) => value.to >= value.from, "Invalid reporting range"),
      )
      .query(async ({ input, ctx }) => {
        requireHr(ctx);
        const presenceRows = await requireDb().execute(sql<HrReportingPresence>`
          select
            to_regclass('public.leave_request') is not null as "leaveRequest",
            to_regclass('public.attendance_record') is not null as "attendanceRecord",
            to_regclass('public.salary_package') is not null as "salaryPackage",
            to_regclass('public.payroll_run') is not null as "payrollRun"
        `);
        const presence = presenceRows[0] as unknown as HrReportingPresence;
        const modules = availableHrReportingModules(presence);
        const headcountRows = await requireDb().execute(sql`
          select
            count(*)::integer as total,
            count(*) filter (where is_active)::integer as active,
            count(*) filter (where not is_active)::integer as inactive,
            count(*) filter (
              where not is_active and updated_at::date between ${input.from}::date and ${input.to}::date
            )::integer as exits_in_range
          from public.employee
        `);
        const headcount = headcountRows[0]!;
        const active = Number(headcount.active ?? 0);
        const exits = Number(headcount.exits_in_range ?? 0);

        const leave = modules.leave
          ? (
              await requireDb().execute(sql`
              select
                count(*) filter (where status = 'pending')::integer as pending,
                count(*) filter (where status = 'approved')::integer as approved,
                coalesce(sum(days) filter (where status = 'approved'), 0)::numeric as approved_days
              from public.leave_request
              where start_date <= ${input.to}::date and end_date >= ${input.from}::date
            `)
            )[0]
          : null;
        const attendance = modules.attendance
          ? (
              await requireDb().execute(sql`
              select
                count(*)::integer as records,
                count(distinct employee_id)::integer as employees_present,
                count(*) filter (where clock_out_at is null)::integer as open_clock_ins
              from public.attendance_record
              where work_date between ${input.from}::date and ${input.to}::date
            `)
            )[0]
          : null;
        const payrollReadiness = modules.payrollReadiness
          ? (
              await requireDb().execute(sql`
              select
                (select count(*)::integer
                  from public.employee e
                  where e.is_active and not exists (
                    select 1 from public.salary_package s
                    where s.employee_id = e.employee_id
                      and s.effective_from <= ${input.to}::date
                      and (s.effective_to is null or s.effective_to >= ${input.to}::date)
                  )) as employees_missing_salary_package,
                (select status from public.payroll_run
                  order by period_end desc, run_number desc limit 1) as latest_run_status,
                (select wps_status from public.payroll_run
                  order by period_end desc, run_number desc limit 1) as latest_wps_status
            `)
            )[0]
          : null;

        return {
          range: input,
          availableModules: modules,
          headcount,
          turnover: {
            exits,
            currentHeadcountProxyPct:
              active === 0 ? null : Math.round((exits / active) * 10_000) / 100,
            definition:
              "Inactive employees updated in range divided by current active headcount; replace with effective-dated employment history for statutory turnover.",
          },
          leave,
          attendance,
          payrollReadiness,
        };
      }),
  }),
});
