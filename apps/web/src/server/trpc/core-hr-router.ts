import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import {
  canAccessEmployeeRecord,
  documentExpiryState,
  isCoreHrAdmin,
} from "../core-hr";
import { getDb } from "../db";
import { writeAudit } from "../m1-persistence";
import { router, staffProcedure, type TrpcContext } from "./trpc";

type EmployeeAccessRow = {
  employee_id: string;
  reports_to_email: string | null;
};

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for Core HR",
    });
  }
  return db;
}

function actor(ctx: TrpcContext) {
  if (!ctx.employeeId || !ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return {
    employeeId: ctx.employeeId,
    email: ctx.user.email,
    roles: ctx.roles,
  };
}

function requireAdmin(roles: readonly string[]) {
  if (!isCoreHrAdmin(roles)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "HR access required" });
  }
}

async function requireEmployeeAccess(
  ctx: TrpcContext,
  targetEmployeeId: string,
) {
  const current = actor(ctx);
  const rows = await requireDb().execute(
    sql<EmployeeAccessRow>`
      select employee_id, reports_to_email
      from public.employee
      where employee_id = ${targetEmployeeId}::uuid
      limit 1
    `,
  );
  const target = rows[0] as EmployeeAccessRow | undefined;
  if (!target) throw new TRPCError({ code: "NOT_FOUND" });
  if (
    !canAccessEmployeeRecord({
      actorEmployeeId: current.employeeId,
      actorEmail: current.email,
      roles: current.roles,
      targetEmployeeId: target.employee_id,
      targetReportsToEmail: target.reports_to_email,
    })
  ) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return current;
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
const storagePath = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .regex(/^[a-zA-Z0-9/_\-.]+$/)
  .refine((value) => !value.includes(".."), "Invalid storage path");

export const coreHrRouter = router({
  employees: staffProcedure.query(async ({ ctx }) => {
    const current = actor(ctx);
    const access = isCoreHrAdmin(current.roles)
      ? sql`true`
      : sql`(
          e.employee_id = ${current.employeeId}::uuid
          or lower(coalesce(e.reports_to_email, '')) = lower(${current.email})
        )`;
    return requireDb().execute(sql`
      select
        e.employee_id,
        e.display_name,
        e.email,
        e.job_title,
        e.department,
        e.reports_to_email,
        e.lifecycle_status,
        p.personal_email,
        p.phone,
        p.nationality,
        p.employment_type,
        p.office,
        p.joining_date,
        p.probation_end_date
      from public.employee e
      left join public.employee_hr_profile p on p.employee_id = e.employee_id
      where ${access} and e.is_active = true
      order by e.display_name
    `);
  }),

  profile: router({
    get: staffProcedure
      .input(z.object({ employeeId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireEmployeeAccess(ctx, input.employeeId);
        const rows = await requireDb().execute(sql`
          select e.*, p.*
          from public.employee e
          left join public.employee_hr_profile p on p.employee_id = e.employee_id
          where e.employee_id = ${input.employeeId}::uuid
          limit 1
        `);
        return rows[0] ?? null;
      }),

    update: staffProcedure
      .input(
        z.object({
          employeeId: uuid,
          personalEmail: z.string().email().max(320).optional(),
          phone: z.string().trim().max(40).optional(),
          emergencyContact: z.record(z.unknown()).optional(),
          nationality: z.string().trim().max(100).optional(),
          dateOfBirth: z.string().date().optional(),
          employmentType: z.string().trim().max(80).optional(),
          office: z.string().trim().max(120).optional(),
          joiningDate: z.string().date().optional(),
          probationEndDate: z.string().date().optional(),
          emiratesIdNumber: z.string().trim().max(80).optional(),
          workPermitNumber: z.string().trim().max(80).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = await requireEmployeeAccess(ctx, input.employeeId);
        const adminOnlyChanged = [
          input.nationality,
          input.dateOfBirth,
          input.employmentType,
          input.office,
          input.joiningDate,
          input.probationEndDate,
          input.emiratesIdNumber,
          input.workPermitNumber,
        ].some((value) => value !== undefined);
        if (adminOnlyChanged && !isCoreHrAdmin(current.roles)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        if (
          current.employeeId !== input.employeeId &&
          !isCoreHrAdmin(current.roles)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const rows = await requireDb().execute(sql`
          insert into public.employee_hr_profile (
            employee_id, personal_email, phone, emergency_contact, nationality,
            date_of_birth, employment_type, office, joining_date,
            probation_end_date, emirates_id_number, work_permit_number
          ) values (
            ${input.employeeId}::uuid,
            ${input.personalEmail ?? null},
            ${input.phone ?? null},
            ${JSON.stringify(input.emergencyContact ?? {})}::jsonb,
            ${input.nationality ?? null},
            ${input.dateOfBirth ?? null}::date,
            ${input.employmentType ?? null},
            ${input.office ?? null},
            ${input.joiningDate ?? null}::date,
            ${input.probationEndDate ?? null}::date,
            ${input.emiratesIdNumber ?? null},
            ${input.workPermitNumber ?? null}
          )
          on conflict (employee_id) do update set
            personal_email = coalesce(excluded.personal_email, employee_hr_profile.personal_email),
            phone = coalesce(excluded.phone, employee_hr_profile.phone),
            emergency_contact = case
              when excluded.emergency_contact = '{}'::jsonb then employee_hr_profile.emergency_contact
              else excluded.emergency_contact
            end,
            nationality = coalesce(excluded.nationality, employee_hr_profile.nationality),
            date_of_birth = coalesce(excluded.date_of_birth, employee_hr_profile.date_of_birth),
            employment_type = coalesce(excluded.employment_type, employee_hr_profile.employment_type),
            office = coalesce(excluded.office, employee_hr_profile.office),
            joining_date = coalesce(excluded.joining_date, employee_hr_profile.joining_date),
            probation_end_date = coalesce(excluded.probation_end_date, employee_hr_profile.probation_end_date),
            emirates_id_number = coalesce(excluded.emirates_id_number, employee_hr_profile.emirates_id_number),
            work_permit_number = coalesce(excluded.work_permit_number, employee_hr_profile.work_permit_number),
            updated_at = now()
          returning *
        `);
        await audit(
          ctx,
          "coreHr.profile.update",
          "employee",
          input.employeeId,
          {
            fields: Object.keys(input).filter((key) => key !== "employeeId"),
          },
        );
        return rows[0]!;
      }),
  }),

  documents: router({
    list: staffProcedure
      .input(z.object({ employeeId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireEmployeeAccess(ctx, input.employeeId);
        const rows = await requireDb().execute(sql<{
          expires_at: string | null;
          [key: string]: unknown;
        }>`
          select * from public.employee_document
          where employee_id = ${input.employeeId}::uuid
          order by expires_at nulls last, created_at desc
        `);
        return rows.map((raw) => {
          const row = raw as { expires_at: string | null } & Record<
            string,
            unknown
          >;
          return {
            ...row,
            expiry_state: documentExpiryState(row.expires_at),
          };
        });
      }),

    create: staffProcedure
      .input(
        z.object({
          employeeId: uuid,
          documentType: z.string().trim().min(2).max(100),
          documentNumber: z.string().trim().max(120).optional(),
          storagePath,
          issuedAt: z.string().date().optional(),
          expiresAt: z.string().date().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = await requireEmployeeAccess(ctx, input.employeeId);
        if (
          current.employeeId !== input.employeeId &&
          !isCoreHrAdmin(current.roles)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const rows = await requireDb().execute(sql`
          insert into public.employee_document (
            employee_id, document_type, document_number, storage_path,
            issued_at, expires_at, uploaded_by_employee_id
          ) values (
            ${input.employeeId}::uuid,
            ${input.documentType},
            ${input.documentNumber ?? null},
            ${input.storagePath},
            ${input.issuedAt ?? null}::date,
            ${input.expiresAt ?? null}::date,
            ${current.employeeId}::uuid
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "coreHr.document.create",
          "employee_document",
          String(created.employee_document_id),
          { employeeId: input.employeeId, documentType: input.documentType },
        );
        return created;
      }),
  }),

  assets: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const access = isCoreHrAdmin(current.roles)
        ? sql`true`
        : sql`a.employee_id = ${current.employeeId}::uuid`;
      return requireDb().execute(sql`
        select c.*, a.company_asset_assignment_id, a.employee_id,
          a.assigned_at, a.due_back_at, a.returned_at
        from public.company_asset c
        left join public.company_asset_assignment a
          on a.company_asset_id = c.company_asset_id and a.returned_at is null
        where ${access}
        order by c.asset_tag
      `);
    }),

    create: staffProcedure
      .input(
        z.object({
          assetTag: z.string().trim().min(1).max(80),
          name: z.string().trim().min(2).max(160),
          category: z.string().trim().min(2).max(80),
          serialNumber: z.string().trim().max(160).optional(),
          purchasedAt: z.string().date().optional(),
          purchaseCostAed: z.number().nonnegative().max(100_000_000).optional(),
          notes: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx.roles);
        const rows = await requireDb().execute(sql`
          insert into public.company_asset (
            asset_tag, name, category, serial_number, purchased_at,
            purchase_cost_aed, notes
          ) values (
            ${input.assetTag}, ${input.name}, ${input.category},
            ${input.serialNumber ?? null}, ${input.purchasedAt ?? null}::date,
            ${input.purchaseCostAed ?? null}, ${input.notes ?? null}
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "coreHr.asset.create",
          "company_asset",
          String(created.company_asset_id),
          {
            assetTag: input.assetTag,
          },
        );
        return created;
      }),

    assign: staffProcedure
      .input(
        z.object({
          assetId: uuid,
          employeeId: uuid,
          dueBackAt: z.string().datetime().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx.roles);
        const current = actor(ctx);
        const row = await requireDb().transaction(async (tx) => {
          const changed = await tx.execute(sql`
            update public.company_asset
            set status = 'assigned', updated_at = now()
            where company_asset_id = ${input.assetId}::uuid and status = 'available'
            returning company_asset_id
          `);
          if (!changed[0]) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Asset is unavailable",
            });
          }
          const assigned = await tx.execute(sql`
            insert into public.company_asset_assignment (
              company_asset_id, employee_id, assigned_by_employee_id, due_back_at
            ) values (
              ${input.assetId}::uuid, ${input.employeeId}::uuid,
              ${current.employeeId}::uuid, ${input.dueBackAt ?? null}::timestamptz
            )
            returning *
          `);
          return assigned[0]!;
        });
        await audit(
          ctx,
          "coreHr.asset.assign",
          "company_asset",
          input.assetId,
          {
            employeeId: input.employeeId,
          },
        );
        return row;
      }),

    return: staffProcedure
      .input(
        z.object({
          assignmentId: uuid,
          condition: z.string().trim().max(500).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx.roles);
        const row = await requireDb().transaction(async (tx) => {
          const returned = await tx.execute(sql`
            update public.company_asset_assignment
            set returned_at = now(), return_condition = ${input.condition ?? null},
                updated_at = now()
            where company_asset_assignment_id = ${input.assignmentId}::uuid
              and returned_at is null
            returning *
          `);
          const assignment = returned[0];
          if (!assignment) throw new TRPCError({ code: "NOT_FOUND" });
          await tx.execute(sql`
            update public.company_asset
            set status = 'available', updated_at = now()
            where company_asset_id = ${String(assignment.company_asset_id)}::uuid
          `);
          return assignment;
        });
        await audit(
          ctx,
          "coreHr.asset.return",
          "company_asset_assignment",
          input.assignmentId,
          {
            condition: input.condition ?? null,
          },
        );
        return row;
      }),
  }),

  lifecycle: router({
    templates: staffProcedure.query(async () =>
      requireDb().execute(sql`
        select * from public.lifecycle_task_template
        where is_active = true
        order by phase, relative_due_days, title
      `),
    ),

    createTemplate: staffProcedure
      .input(
        z.object({
          phase: z.enum(["onboarding", "offboarding"]),
          title: z.string().trim().min(2).max(160),
          description: z.string().trim().max(2_000).optional(),
          relativeDueDays: z.number().int().min(-365).max(365).default(0),
          assigneeRole: z.string().trim().max(80).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx.roles);
        const rows = await requireDb().execute(sql`
          insert into public.lifecycle_task_template (
            phase, title, description, relative_due_days, assignee_role
          ) values (
            ${input.phase}, ${input.title}, ${input.description ?? null},
            ${input.relativeDueDays}, ${input.assigneeRole ?? null}
          )
          returning *
        `);
        return rows[0]!;
      }),

    start: staffProcedure
      .input(
        z.object({
          employeeId: uuid,
          phase: z.enum(["onboarding", "offboarding"]),
          anchorAt: z.string().datetime().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx.roles);
        const anchor = input.anchorAt ? new Date(input.anchorAt) : new Date();
        const rows = await requireDb().execute(sql`
          insert into public.employee_lifecycle_task (
            employee_id, lifecycle_task_template_id, phase, title,
            description, assignee_role, due_at
          )
          select
            ${input.employeeId}::uuid,
            lifecycle_task_template_id,
            phase,
            title,
            description,
            assignee_role,
            ${anchor}::timestamptz + make_interval(days => relative_due_days)
          from public.lifecycle_task_template
          where phase = ${input.phase} and is_active = true
          returning *
        `);
        await audit(
          ctx,
          "coreHr.lifecycle.start",
          "employee",
          input.employeeId,
          {
            phase: input.phase,
            taskCount: rows.length,
          },
        );
        return rows;
      }),

    tasks: staffProcedure
      .input(z.object({ employeeId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireEmployeeAccess(ctx, input.employeeId);
        return requireDb().execute(sql`
          select * from public.employee_lifecycle_task
          where employee_id = ${input.employeeId}::uuid
          order by status, due_at nulls last, created_at
        `);
      }),

    completeTask: staffProcedure
      .input(z.object({ taskId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        const rows = await requireDb().execute(sql<{
          employee_id: string;
          assignee_employee_id: string | null;
        }>`
          select employee_id, assignee_employee_id
          from public.employee_lifecycle_task
          where employee_lifecycle_task_id = ${input.taskId}::uuid
          limit 1
        `);
        const task = rows[0];
        if (!task) throw new TRPCError({ code: "NOT_FOUND" });
        if (
          !isCoreHrAdmin(current.roles) &&
          current.employeeId !== task.employee_id &&
          current.employeeId !== task.assignee_employee_id
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const updated = await requireDb().execute(sql`
          update public.employee_lifecycle_task
          set status = 'completed', completed_by_employee_id = ${current.employeeId}::uuid,
              completed_at = now(), updated_at = now()
          where employee_lifecycle_task_id = ${input.taskId}::uuid
            and status in ('pending', 'in_progress')
          returning *
        `);
        if (!updated[0]) throw new TRPCError({ code: "CONFLICT" });
        return updated[0];
      }),
  }),

  letters: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const access = isCoreHrAdmin(current.roles)
        ? sql`true`
        : sql`(
            r.employee_id = ${current.employeeId}::uuid
            or lower(coalesce(e.reports_to_email, '')) = lower(${current.email})
          )`;
      return requireDb().execute(sql`
        select r.*, e.display_name, e.email
        from public.employee_letter_request r
        join public.employee e on e.employee_id = r.employee_id
        where ${access}
        order by r.created_at desc
      `);
    }),

    create: staffProcedure
      .input(
        z.object({
          letterType: z.string().trim().min(2).max(100),
          addressedTo: z.string().trim().max(200).optional(),
          purpose: z.string().trim().max(1_000).optional(),
          language: z.enum(["en", "ar", "both"]).default("en"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        const rows = await requireDb().execute(sql`
          insert into public.employee_letter_request (
            employee_id, letter_type, addressed_to, purpose, language
          ) values (
            ${current.employeeId}::uuid, ${input.letterType},
            ${input.addressedTo ?? null}, ${input.purpose ?? null}, ${input.language}
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "coreHr.letter.create",
          "employee_letter_request",
          String(created.employee_letter_request_id),
          { letterType: input.letterType },
        );
        return created;
      }),

    updateStatus: staffProcedure
      .input(
        z.object({
          requestId: uuid,
          status: z.enum(["processing", "ready", "rejected"]),
          storagePath: storagePath.optional(),
          note: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx.roles);
        if (input.status === "ready" && !input.storagePath) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A generated letter file is required",
          });
        }
        const current = actor(ctx);
        const rows = await requireDb().execute(sql`
          update public.employee_letter_request
          set status = ${input.status},
              storage_path = coalesce(${input.storagePath ?? null}, storage_path),
              decision_note = ${input.note ?? null},
              handled_by_employee_id = ${current.employeeId}::uuid,
              handled_at = now(), updated_at = now()
          where employee_letter_request_id = ${input.requestId}::uuid
            and status in ('requested', 'processing')
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "CONFLICT" });
        await audit(
          ctx,
          "coreHr.letter.status",
          "employee_letter_request",
          input.requestId,
          {
            status: input.status,
          },
        );
        return rows[0];
      }),
  }),
});
