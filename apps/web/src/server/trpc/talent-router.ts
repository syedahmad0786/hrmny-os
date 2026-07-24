import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { auditEvent, sql, type Db } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import {
  canAccessEmployeeTalentRecord,
  canTransitionTalent,
  isTalentAdministrator,
  type TalentWorkflow,
} from "../talent";
import { router, staffProcedure, type TrpcContext } from "./trpc";

type TalentTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type StatusRow = { id: string; status: string };
type CandidateRow = { id: string; stage: string };
type ReviewRow = { id: string; employee_id: string; status: string };

const requisitionStatus = z.enum([
  "draft",
  "open",
  "paused",
  "closed",
  "cancelled",
]);
const candidateStage = z.enum([
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
]);
const offerStatus = z.enum([
  "draft",
  "sent",
  "accepted",
  "declined",
  "withdrawn",
]);
const cycleStatus = z.enum(["draft", "active", "closed"]);
const surveyStatus = z.enum(["draft", "open", "closed"]);

function requireDb(): Db {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for Talent",
    });
  }
  return db;
}

function requireEmployeeId(ctx: TrpcContext): string {
  if (!ctx.employeeId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Employee required" });
  }
  return ctx.employeeId;
}

function requireTalentAdmin(ctx: TrpcContext): string {
  const employeeId = requireEmployeeId(ctx);
  if (!isTalentAdministrator(ctx.roles)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Talent administration permission required",
    });
  }
  return employeeId;
}

function requireEmployeeScope(ctx: TrpcContext, subjectEmployeeId: string) {
  const actorEmployeeId = requireEmployeeId(ctx);
  if (
    !canAccessEmployeeTalentRecord(
      actorEmployeeId,
      ctx.roles,
      subjectEmployeeId,
    )
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Employee record denied",
    });
  }
  return actorEmployeeId;
}

function requireTransition(workflow: TalentWorkflow, from: string, to: string) {
  if (!canTransitionTalent(workflow, from, to)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Cannot move ${workflow} from ${from} to ${to}`,
    });
  }
}

function requireRow<T>(row: T | undefined): T {
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return row;
}

async function appendAudit(
  tx: TalentTx,
  actorEmployeeId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  reason?: string,
) {
  await tx.insert(auditEvent).values({
    actorEmployeeId,
    action,
    entityType,
    entityId,
    before,
    after,
    reason: reason ?? null,
  });
}

export const talentRouter = router({
  requisitions: router({
    list: staffProcedure.query(async ({ ctx }) => {
      requireTalentAdmin(ctx);
      return requireDb().execute(sql`
        SELECT * FROM public.job_requisition
        ORDER BY created_at DESC
      `);
    }),

    create: staffProcedure
      .input(
        z.object({
          title: z.string().trim().min(2).max(160),
          department: z.string().trim().min(2).max(120),
          description: z.string().trim().max(20_000).default(""),
          location: z.string().trim().max(160).optional(),
          employmentType: z
            .enum(["full_time", "part_time", "contract", "internship"])
            .default("full_time"),
          openings: z.number().int().positive().max(100).default(1),
          hiringManagerEmployeeId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        const id = randomUUID();
        return db.transaction(async (tx) => {
          const rows = await tx.execute(sql<Record<string, unknown>>`
            INSERT INTO public.job_requisition (
              job_requisition_id, title, department, description, location,
              employment_type, openings, requester_employee_id,
              hiring_manager_employee_id
            ) VALUES (
              ${id}::uuid, ${input.title}, ${input.department}, ${input.description},
              ${input.location ?? null}, ${input.employmentType}, ${input.openings},
              ${actor}::uuid, ${input.hiringManagerEmployeeId ?? null}::uuid
            ) RETURNING *
          `);
          const created = requireRow(rows[0]);
          await appendAudit(
            tx,
            actor,
            "talent.requisition.create",
            "job_requisition",
            id,
            null,
            created,
          );
          return created;
        });
      }),

    transition: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: requisitionStatus,
          reason: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        return db.transaction(async (tx) => {
          const existing = requireRow(
            (
              await tx.execute<StatusRow>(sql`
                SELECT job_requisition_id AS id, status
                FROM public.job_requisition
                WHERE job_requisition_id = ${input.id}::uuid
                FOR UPDATE
              `)
            )[0],
          );
          requireTransition("requisition", existing.status, input.status);
          const rows = await tx.execute(sql<Record<string, unknown>>`
            UPDATE public.job_requisition
            SET status = ${input.status},
                opened_by_employee_id = CASE WHEN ${input.status} = 'open' THEN ${actor}::uuid ELSE opened_by_employee_id END,
                opened_at = CASE WHEN ${input.status} = 'open' THEN now() ELSE opened_at END,
                closed_at = CASE WHEN ${input.status} IN ('closed', 'cancelled') THEN now() ELSE closed_at END,
                updated_at = now()
            WHERE job_requisition_id = ${input.id}::uuid
            RETURNING *
          `);
          const updated = requireRow(rows[0]);
          await appendAudit(
            tx,
            actor,
            "talent.requisition.transition",
            "job_requisition",
            input.id,
            { status: existing.status },
            updated,
            input.reason,
          );
          return updated;
        });
      }),
  }),

  candidates: router({
    list: staffProcedure
      .input(
        z.object({ requisitionId: z.string().uuid().optional() }).optional(),
      )
      .query(async ({ input, ctx }) => {
        requireTalentAdmin(ctx);
        const db = requireDb();
        return input?.requisitionId
          ? db.execute(sql`
              SELECT * FROM public.job_candidate
              WHERE job_requisition_id = ${input.requisitionId}::uuid
              ORDER BY created_at DESC
            `)
          : db.execute(sql`
              SELECT * FROM public.job_candidate
              ORDER BY created_at DESC
            `);
      }),

    history: staffProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        requireTalentAdmin(ctx);
        return requireDb().execute(sql`
          SELECT * FROM public.candidate_stage_event
          WHERE job_candidate_id = ${input.id}::uuid
          ORDER BY created_at
        `);
      }),

    create: staffProcedure
      .input(
        z.object({
          requisitionId: z.string().uuid(),
          fullName: z.string().trim().min(2).max(160),
          email: z.string().trim().email().max(320),
          phone: z.string().trim().max(60).optional(),
          source: z.string().trim().max(120).optional(),
          resumeStoragePath: z.string().trim().max(1_000).optional(),
          consentAt: z.string().datetime().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        const id = randomUUID();
        return db.transaction(async (tx) => {
          const requisition = requireRow(
            (
              await tx.execute<StatusRow>(sql`
                SELECT job_requisition_id AS id, status
                FROM public.job_requisition
                WHERE job_requisition_id = ${input.requisitionId}::uuid
              `)
            )[0],
          );
          if (requisition.status !== "open") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Requisition is not open",
            });
          }
          const rows = await tx.execute(sql<Record<string, unknown>>`
            INSERT INTO public.job_candidate (
              job_candidate_id, job_requisition_id, full_name, email, phone,
              source, resume_storage_path, consent_at, created_by_employee_id
            ) VALUES (
              ${id}::uuid, ${input.requisitionId}::uuid, ${input.fullName},
              lower(${input.email}), ${input.phone ?? null}, ${input.source ?? null},
              ${input.resumeStoragePath ?? null}, ${input.consentAt ?? null}::timestamptz,
              ${actor}::uuid
            ) RETURNING *
          `);
          const created = requireRow(rows[0]);
          await tx.execute(sql`
            INSERT INTO public.candidate_stage_event (
              job_candidate_id, from_stage, to_stage, actor_employee_id, reason
            ) VALUES (${id}::uuid, NULL, 'applied', ${actor}::uuid, 'Candidate created')
          `);
          await appendAudit(
            tx,
            actor,
            "talent.candidate.create",
            "job_candidate",
            id,
            null,
            {
              requisitionId: input.requisitionId,
              stage: "applied",
            },
          );
          return created;
        });
      }),

    move: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          stage: candidateStage,
          reason: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        return db.transaction(async (tx) => {
          const existing = requireRow(
            (
              await tx.execute<CandidateRow>(sql`
                SELECT job_candidate_id AS id, stage
                FROM public.job_candidate
                WHERE job_candidate_id = ${input.id}::uuid
                FOR UPDATE
              `)
            )[0],
          );
          requireTransition("candidate", existing.stage, input.stage);
          const rows = await tx.execute(sql<Record<string, unknown>>`
            UPDATE public.job_candidate
            SET stage = ${input.stage}, updated_at = now(),
                archived_at = CASE WHEN ${input.stage} IN ('rejected', 'withdrawn') THEN now() ELSE archived_at END
            WHERE job_candidate_id = ${input.id}::uuid
            RETURNING *
          `);
          const updated = requireRow(rows[0]);
          await tx.execute(sql`
            INSERT INTO public.candidate_stage_event (
              job_candidate_id, from_stage, to_stage, actor_employee_id, reason
            ) VALUES (
              ${input.id}::uuid, ${existing.stage}, ${input.stage}, ${actor}::uuid,
              ${input.reason ?? null}
            )
          `);
          await appendAudit(
            tx,
            actor,
            "talent.candidate.move",
            "job_candidate",
            input.id,
            { stage: existing.stage },
            { stage: input.stage },
            input.reason,
          );
          return updated;
        });
      }),
  }),

  interviews: router({
    list: staffProcedure
      .input(z.object({ candidateId: z.string().uuid().optional() }).optional())
      .query(async ({ input, ctx }) => {
        requireTalentAdmin(ctx);
        const db = requireDb();
        return input?.candidateId
          ? db.execute(sql`
              SELECT * FROM public.candidate_interview
              WHERE job_candidate_id = ${input.candidateId}::uuid
              ORDER BY starts_at
            `)
          : db.execute(sql`
              SELECT * FROM public.candidate_interview
              ORDER BY starts_at DESC
            `);
      }),

    schedule: staffProcedure
      .input(
        z.object({
          candidateId: z.string().uuid(),
          interviewerEmployeeId: z.string().uuid().optional(),
          startsAt: z.string().datetime(),
          endsAt: z.string().datetime(),
          locationOrLink: z.string().trim().max(1_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Interview end must follow start",
          });
        }
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        const id = randomUUID();
        return db.transaction(async (tx) => {
          const rows = await tx.execute(sql<Record<string, unknown>>`
            INSERT INTO public.candidate_interview (
              candidate_interview_id, job_candidate_id, interviewer_employee_id,
              starts_at, ends_at, location_or_link, created_by_employee_id
            ) VALUES (
              ${id}::uuid, ${input.candidateId}::uuid,
              ${input.interviewerEmployeeId ?? null}::uuid, ${input.startsAt}::timestamptz,
              ${input.endsAt}::timestamptz, ${input.locationOrLink ?? null}, ${actor}::uuid
            ) RETURNING *
          `);
          const created = requireRow(rows[0]);
          await appendAudit(
            tx,
            actor,
            "talent.interview.schedule",
            "candidate_interview",
            id,
            null,
            {
              candidateId: input.candidateId,
              startsAt: input.startsAt,
            },
          );
          return created;
        });
      }),

    recordOutcome: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(["completed", "cancelled", "no_show"]),
          feedback: z.record(z.unknown()).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        return db.transaction(async (tx) => {
          const rows = await tx.execute(sql<Record<string, unknown>>`
            UPDATE public.candidate_interview
            SET status = ${input.status}, feedback = ${input.feedback ? JSON.stringify(input.feedback) : null}::jsonb,
                updated_at = now()
            WHERE candidate_interview_id = ${input.id}::uuid AND status = 'scheduled'
            RETURNING *
          `);
          const updated = requireRow(rows[0]);
          await appendAudit(
            tx,
            actor,
            "talent.interview.outcome",
            "candidate_interview",
            input.id,
            {
              status: "scheduled",
            },
            { status: input.status },
          );
          return updated;
        });
      }),
  }),

  offers: router({
    list: staffProcedure
      .input(z.object({ candidateId: z.string().uuid().optional() }).optional())
      .query(async ({ input, ctx }) => {
        requireTalentAdmin(ctx);
        const db = requireDb();
        return input?.candidateId
          ? db.execute(sql`
              SELECT * FROM public.candidate_offer
              WHERE job_candidate_id = ${input.candidateId}::uuid
              ORDER BY version DESC
            `)
          : db.execute(sql`
              SELECT * FROM public.candidate_offer
              ORDER BY created_at DESC
            `);
      }),

    create: staffProcedure
      .input(
        z.object({
          candidateId: z.string().uuid(),
          salaryAmount: z.number().nonnegative().max(100_000_000),
          currency: z
            .string()
            .trim()
            .regex(/^[A-Z]{3}$/)
            .default("AED"),
          startDate: z.string().date().optional(),
          expiresAt: z.string().datetime().optional(),
          terms: z.record(z.unknown()).default({}),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        const id = randomUUID();
        return db.transaction(async (tx) => {
          const candidate = requireRow(
            (
              await tx.execute<CandidateRow>(sql`
                SELECT job_candidate_id AS id, stage
                FROM public.job_candidate
                WHERE job_candidate_id = ${input.candidateId}::uuid
                FOR UPDATE
              `)
            )[0],
          );
          if (candidate.stage !== "offer") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Candidate is not at offer stage",
            });
          }
          const rows = await tx.execute(sql<Record<string, unknown>>`
            INSERT INTO public.candidate_offer (
              candidate_offer_id, job_candidate_id, version, salary_amount,
              currency, start_date, expires_at, terms, created_by_employee_id
            ) VALUES (
              ${id}::uuid, ${input.candidateId}::uuid,
              (SELECT coalesce(max(version), 0) + 1 FROM public.candidate_offer WHERE job_candidate_id = ${input.candidateId}::uuid),
              ${input.salaryAmount}, ${input.currency}, ${input.startDate ?? null}::date,
              ${input.expiresAt ?? null}::timestamptz, ${JSON.stringify(input.terms)}::jsonb, ${actor}::uuid
            ) RETURNING *
          `);
          const created = requireRow(rows[0]);
          await appendAudit(
            tx,
            actor,
            "talent.offer.create",
            "candidate_offer",
            id,
            null,
            {
              candidateId: input.candidateId,
              currency: input.currency,
            },
          );
          return created;
        });
      }),

    transition: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: offerStatus,
          reason: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        return db.transaction(async (tx) => {
          const existing = requireRow(
            (
              await tx.execute<StatusRow & { candidate_id: string }>(sql`
                SELECT candidate_offer_id AS id, job_candidate_id AS candidate_id, status
                FROM public.candidate_offer
                WHERE candidate_offer_id = ${input.id}::uuid
                FOR UPDATE
              `)
            )[0],
          );
          requireTransition("offer", existing.status, input.status);
          const rows = await tx.execute(sql<Record<string, unknown>>`
            UPDATE public.candidate_offer
            SET status = ${input.status},
                decided_at = CASE WHEN ${input.status} IN ('accepted', 'declined', 'withdrawn') THEN now() ELSE decided_at END,
                updated_at = now()
            WHERE candidate_offer_id = ${input.id}::uuid
            RETURNING *
          `);
          const updated = requireRow(rows[0]);
          if (input.status === "accepted") {
            const candidate = requireRow(
              (
                await tx.execute<CandidateRow>(sql`
                  UPDATE public.job_candidate
                  SET stage = 'hired', updated_at = now()
                  WHERE job_candidate_id = ${existing.candidate_id}::uuid AND stage = 'offer'
                  RETURNING job_candidate_id AS id, stage
                `)
              )[0],
            );
            await tx.execute(sql`
              INSERT INTO public.candidate_stage_event (
                job_candidate_id, from_stage, to_stage, actor_employee_id, reason
              ) VALUES (${candidate.id}::uuid, 'offer', 'hired', ${actor}::uuid, 'Offer accepted')
            `);
          }
          await appendAudit(
            tx,
            actor,
            "talent.offer.transition",
            "candidate_offer",
            input.id,
            { status: existing.status },
            { status: input.status },
            input.reason,
          );
          return updated;
        });
      }),
  }),

  performance: router({
    cycles: router({
      list: staffProcedure.query(async () =>
        requireDb().execute(sql`
          SELECT * FROM public.performance_cycle
          ORDER BY start_date DESC
        `),
      ),

      create: staffProcedure
        .input(
          z.object({
            name: z.string().trim().min(2).max(160),
            startDate: z.string().date(),
            endDate: z.string().date(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          if (input.endDate < input.startDate) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cycle end must follow start",
            });
          }
          const db = requireDb();
          const actor = requireTalentAdmin(ctx);
          const id = randomUUID();
          return db.transaction(async (tx) => {
            const rows = await tx.execute(sql<Record<string, unknown>>`
              INSERT INTO public.performance_cycle (
                performance_cycle_id, name, start_date, end_date, created_by_employee_id
              ) VALUES (
                ${id}::uuid, ${input.name}, ${input.startDate}::date,
                ${input.endDate}::date, ${actor}::uuid
              ) RETURNING *
            `);
            const created = requireRow(rows[0]);
            await appendAudit(
              tx,
              actor,
              "talent.performanceCycle.create",
              "performance_cycle",
              id,
              null,
              created,
            );
            return created;
          });
        }),

      transition: staffProcedure
        .input(z.object({ id: z.string().uuid(), status: cycleStatus }))
        .mutation(async ({ input, ctx }) => {
          const db = requireDb();
          const actor = requireTalentAdmin(ctx);
          return db.transaction(async (tx) => {
            const existing = requireRow(
              (
                await tx.execute<StatusRow>(sql`
                  SELECT performance_cycle_id AS id, status
                  FROM public.performance_cycle
                  WHERE performance_cycle_id = ${input.id}::uuid
                  FOR UPDATE
                `)
              )[0],
            );
            requireTransition("cycle", existing.status, input.status);
            const rows = await tx.execute(sql<Record<string, unknown>>`
              UPDATE public.performance_cycle
              SET status = ${input.status}, updated_at = now()
              WHERE performance_cycle_id = ${input.id}::uuid
              RETURNING *
            `);
            const updated = requireRow(rows[0]);
            await appendAudit(
              tx,
              actor,
              "talent.performanceCycle.transition",
              "performance_cycle",
              input.id,
              { status: existing.status },
              { status: input.status },
            );
            return updated;
          });
        }),
    }),

    goals: router({
      list: staffProcedure
        .input(
          z.object({ employeeId: z.string().uuid().optional() }).optional(),
        )
        .query(async ({ input, ctx }) => {
          const actor = requireEmployeeId(ctx);
          const subject = input?.employeeId ?? actor;
          requireEmployeeScope(ctx, subject);
          return requireDb().execute(sql`
            SELECT * FROM public.performance_goal
            WHERE employee_id = ${subject}::uuid
            ORDER BY created_at DESC
          `);
        }),

      create: staffProcedure
        .input(
          z.object({
            employeeId: z.string().uuid().optional(),
            cycleId: z.string().uuid().optional(),
            title: z.string().trim().min(2).max(200),
            description: z.string().trim().max(10_000).default(""),
            target: z.string().trim().max(2_000).optional(),
            weight: z.number().min(0).max(100).optional(),
            dueDate: z.string().date().optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const actor = requireEmployeeId(ctx);
          const subject = input.employeeId ?? actor;
          requireEmployeeScope(ctx, subject);
          const db = requireDb();
          const id = randomUUID();
          return db.transaction(async (tx) => {
            const rows = await tx.execute(sql<Record<string, unknown>>`
              INSERT INTO public.performance_goal (
                performance_goal_id, performance_cycle_id, employee_id, title,
                description, target, weight, due_date, created_by_employee_id
              ) VALUES (
                ${id}::uuid, ${input.cycleId ?? null}::uuid, ${subject}::uuid,
                ${input.title}, ${input.description}, ${input.target ?? null},
                ${input.weight ?? null}, ${input.dueDate ?? null}::date, ${actor}::uuid
              ) RETURNING *
            `);
            const created = requireRow(rows[0]);
            await appendAudit(
              tx,
              actor,
              "talent.goal.create",
              "performance_goal",
              id,
              null,
              {
                employeeId: subject,
                title: input.title,
              },
            );
            return created;
          });
        }),

      update: staffProcedure
        .input(
          z.object({
            id: z.string().uuid(),
            progress: z.number().int().min(0).max(100),
            status: z.enum(["draft", "active", "completed", "cancelled"]),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const db = requireDb();
          const actor = requireEmployeeId(ctx);
          return db.transaction(async (tx) => {
            const existing = requireRow(
              (
                await tx.execute<{
                  employee_id: string;
                  progress: number;
                  status: string;
                }>(sql`
                  SELECT employee_id, progress, status
                  FROM public.performance_goal
                  WHERE performance_goal_id = ${input.id}::uuid
                  FOR UPDATE
                `)
              )[0],
            );
            requireEmployeeScope(ctx, existing.employee_id);
            const rows = await tx.execute(sql<Record<string, unknown>>`
              UPDATE public.performance_goal
              SET progress = ${input.progress}, status = ${input.status}, updated_at = now()
              WHERE performance_goal_id = ${input.id}::uuid
              RETURNING *
            `);
            const updated = requireRow(rows[0]);
            await appendAudit(
              tx,
              actor,
              "talent.goal.update",
              "performance_goal",
              input.id,
              { progress: existing.progress, status: existing.status },
              { progress: input.progress, status: input.status },
            );
            return updated;
          });
        }),
    }),

    reviews: router({
      list: staffProcedure
        .input(
          z.object({ employeeId: z.string().uuid().optional() }).optional(),
        )
        .query(async ({ input, ctx }) => {
          const actor = requireEmployeeId(ctx);
          const subject = input?.employeeId ?? actor;
          requireEmployeeScope(ctx, subject);
          return requireDb().execute(sql`
            SELECT performance_review_id, performance_cycle_id, employee_id,
                   reviewer_employee_id, overall_rating, ratings, summary,
                   employee_comment, status, submitted_at, acknowledged_at,
                   created_at, updated_at
            FROM public.performance_review
            WHERE employee_id = ${subject}::uuid
              AND (${isTalentAdministrator(ctx.roles)} OR status <> 'draft')
            ORDER BY created_at DESC
          `);
        }),

      upsert: staffProcedure
        .input(
          z.object({
            cycleId: z.string().uuid(),
            employeeId: z.string().uuid(),
            reviewerEmployeeId: z.string().uuid().optional(),
            overallRating: z.number().min(1).max(5).optional(),
            ratings: z.record(z.number().min(1).max(5)).default({}),
            summary: z.string().trim().max(20_000).optional(),
            submit: z.boolean().default(false),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const db = requireDb();
          const actor = requireTalentAdmin(ctx);
          const reviewer = input.reviewerEmployeeId ?? actor;
          return db.transaction(async (tx) => {
            const rows = await tx.execute(sql<Record<string, unknown>>`
              INSERT INTO public.performance_review (
                performance_cycle_id, employee_id, reviewer_employee_id,
                overall_rating, ratings, summary, status, submitted_at
              ) VALUES (
                ${input.cycleId}::uuid, ${input.employeeId}::uuid, ${reviewer}::uuid,
                ${input.overallRating ?? null}, ${JSON.stringify(input.ratings)}::jsonb,
                ${input.summary ?? null}, ${input.submit ? "submitted" : "draft"},
                CASE WHEN ${input.submit} THEN now() ELSE NULL END
              )
              ON CONFLICT (performance_cycle_id, employee_id, reviewer_employee_id)
              DO UPDATE SET
                overall_rating = EXCLUDED.overall_rating,
                ratings = EXCLUDED.ratings,
                summary = EXCLUDED.summary,
                status = EXCLUDED.status,
                submitted_at = EXCLUDED.submitted_at,
                updated_at = now()
              WHERE public.performance_review.status = 'draft'
              RETURNING *
            `);
            const updated = requireRow(rows[0]);
            const id = String(updated.performance_review_id);
            await appendAudit(
              tx,
              actor,
              "talent.review.upsert",
              "performance_review",
              id,
              null,
              {
                employeeId: input.employeeId,
                reviewerEmployeeId: reviewer,
                status: input.submit ? "submitted" : "draft",
              },
            );
            return updated;
          });
        }),

      acknowledge: staffProcedure
        .input(
          z.object({
            id: z.string().uuid(),
            employeeComment: z.string().trim().max(20_000).optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const db = requireDb();
          const actor = requireEmployeeId(ctx);
          return db.transaction(async (tx) => {
            const existing = requireRow(
              (
                await tx.execute<ReviewRow>(sql`
                  SELECT performance_review_id AS id, employee_id, status
                  FROM public.performance_review
                  WHERE performance_review_id = ${input.id}::uuid
                  FOR UPDATE
                `)
              )[0],
            );
            if (
              existing.employee_id !== actor ||
              existing.status !== "submitted"
            ) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "Only the reviewed employee can acknowledge",
              });
            }
            const rows = await tx.execute(sql<Record<string, unknown>>`
              UPDATE public.performance_review
              SET status = 'acknowledged', employee_comment = ${input.employeeComment ?? null},
                  acknowledged_at = now(), updated_at = now()
              WHERE performance_review_id = ${input.id}::uuid
              RETURNING *
            `);
            const updated = requireRow(rows[0]);
            await appendAudit(
              tx,
              actor,
              "talent.review.acknowledge",
              "performance_review",
              input.id,
              { status: "submitted" },
              { status: "acknowledged" },
            );
            return updated;
          });
        }),
    }),
  }),

  surveys: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const actor = requireEmployeeId(ctx);
      const admin = isTalentAdministrator(ctx.roles);
      return requireDb().execute(sql`
        SELECT survey.employee_survey_id, survey.title, survey.description,
               survey.questions, survey.is_anonymous, survey.status,
               survey.opens_at, survey.closes_at, survey.created_at,
               (response.employee_survey_response_id IS NOT NULL) AS responded
        FROM public.employee_survey survey
        LEFT JOIN public.employee_survey_response response
          ON response.employee_survey_id = survey.employee_survey_id
         AND response.employee_id = ${actor}::uuid
        WHERE ${admin} OR survey.status IN ('open', 'closed')
        ORDER BY survey.created_at DESC
      `);
    }),

    create: staffProcedure
      .input(
        z.object({
          title: z.string().trim().min(2).max(200),
          description: z.string().trim().max(10_000).default(""),
          questions: z
            .array(
              z.object({
                id: z.string().trim().min(1).max(80),
                prompt: z.string().trim().min(2).max(1_000),
                type: z.enum(["text", "rating", "single_choice"]),
                options: z
                  .array(z.string().trim().min(1).max(200))
                  .max(20)
                  .optional(),
              }),
            )
            .min(1)
            .max(50),
          isAnonymous: z.boolean().default(true),
          opensAt: z.string().datetime().optional(),
          closesAt: z.string().datetime().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (
          input.opensAt &&
          input.closesAt &&
          Date.parse(input.closesAt) <= Date.parse(input.opensAt)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Survey close must follow open",
          });
        }
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        const id = randomUUID();
        return db.transaction(async (tx) => {
          const rows = await tx.execute(sql<Record<string, unknown>>`
            INSERT INTO public.employee_survey (
              employee_survey_id, title, description, questions, is_anonymous,
              opens_at, closes_at, created_by_employee_id
            ) VALUES (
              ${id}::uuid, ${input.title}, ${input.description},
              ${JSON.stringify(input.questions)}::jsonb, ${input.isAnonymous},
              ${input.opensAt ?? null}::timestamptz, ${input.closesAt ?? null}::timestamptz,
              ${actor}::uuid
            ) RETURNING *
          `);
          const created = requireRow(rows[0]);
          await appendAudit(
            tx,
            actor,
            "talent.survey.create",
            "employee_survey",
            id,
            null,
            {
              title: input.title,
              isAnonymous: input.isAnonymous,
            },
          );
          return created;
        });
      }),

    transition: staffProcedure
      .input(z.object({ id: z.string().uuid(), status: surveyStatus }))
      .mutation(async ({ input, ctx }) => {
        const db = requireDb();
        const actor = requireTalentAdmin(ctx);
        return db.transaction(async (tx) => {
          const existing = requireRow(
            (
              await tx.execute<StatusRow>(sql`
                SELECT employee_survey_id AS id, status
                FROM public.employee_survey
                WHERE employee_survey_id = ${input.id}::uuid
                FOR UPDATE
              `)
            )[0],
          );
          requireTransition("survey", existing.status, input.status);
          const rows = await tx.execute(sql<Record<string, unknown>>`
            UPDATE public.employee_survey
            SET status = ${input.status},
                opens_at = CASE WHEN ${input.status} = 'open' THEN coalesce(opens_at, now()) ELSE opens_at END,
                closes_at = CASE WHEN ${input.status} = 'closed' THEN coalesce(closes_at, now()) ELSE closes_at END,
                updated_at = now()
            WHERE employee_survey_id = ${input.id}::uuid
            RETURNING *
          `);
          const updated = requireRow(rows[0]);
          await appendAudit(
            tx,
            actor,
            "talent.survey.transition",
            "employee_survey",
            input.id,
            { status: existing.status },
            { status: input.status },
          );
          return updated;
        });
      }),

    respond: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          answers: z.record(z.unknown()),
          rating: z.number().int().min(1).max(5).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = requireDb();
        const actor = requireEmployeeId(ctx);
        return db.transaction(async (tx) => {
          const survey = requireRow(
            (
              await tx.execute<
                StatusRow & { opens_at: Date | null; closes_at: Date | null }
              >(sql`
                SELECT employee_survey_id AS id, status, opens_at, closes_at
                FROM public.employee_survey
                WHERE employee_survey_id = ${input.id}::uuid
                FOR UPDATE
              `)
            )[0],
          );
          const now = Date.now();
          if (
            survey.status !== "open" ||
            (survey.opens_at && new Date(survey.opens_at).getTime() > now) ||
            (survey.closes_at && new Date(survey.closes_at).getTime() <= now)
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Survey is not accepting responses",
            });
          }
          const rows = await tx.execute(sql<Record<string, unknown>>`
            INSERT INTO public.employee_survey_response (
              employee_survey_id, employee_id, answers, rating
            ) VALUES (
              ${input.id}::uuid, ${actor}::uuid, ${JSON.stringify(input.answers)}::jsonb,
              ${input.rating ?? null}
            )
            ON CONFLICT (employee_survey_id, employee_id)
            DO UPDATE SET answers = EXCLUDED.answers, rating = EXCLUDED.rating, updated_at = now()
            RETURNING employee_survey_response_id, employee_survey_id, submitted_at, updated_at
          `);
          const response = requireRow(rows[0]);
          await appendAudit(
            tx,
            actor,
            "talent.survey.respond",
            "employee_survey",
            input.id,
            null,
            {
              responseRecorded: true,
            },
          );
          return response;
        });
      }),

    results: staffProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        requireTalentAdmin(ctx);
        const rows = await requireDb().execute<{
          response_count: number;
          average_rating: string | null;
          rating_1: number;
          rating_2: number;
          rating_3: number;
          rating_4: number;
          rating_5: number;
        }>(sql`
          SELECT count(*)::int AS response_count,
                 round(avg(rating), 2)::text AS average_rating,
                 count(*) FILTER (WHERE rating = 1)::int AS rating_1,
                 count(*) FILTER (WHERE rating = 2)::int AS rating_2,
                 count(*) FILTER (WHERE rating = 3)::int AS rating_3,
                 count(*) FILTER (WHERE rating = 4)::int AS rating_4,
                 count(*) FILTER (WHERE rating = 5)::int AS rating_5
          FROM public.employee_survey_response
          WHERE employee_survey_id = ${input.id}::uuid
        `);
        return requireRow(rows[0]);
      }),
  }),
});
