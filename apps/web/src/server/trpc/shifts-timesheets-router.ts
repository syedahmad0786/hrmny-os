import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { auditEvent, sql, type Db } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import {
  canDecideWorkRequest,
  canTransitionShift,
  canViewWorkRecord,
  isWorkforceOperator,
  validateDailyMinutes,
  validateShiftWindow,
} from "../shifts-timesheets";
import { router, staffProcedure, type TrpcContext } from "./trpc";

type WorkTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type EmployeeRow = {
  employee_id: string;
  reports_to_email: string | null;
};
type ShiftRow = {
  id: string;
  status: string;
  starts_at: Date;
  ends_at: Date;
};
type AssignmentRow = {
  id: string;
  employee_id: string;
  shift_instance_id: string;
  status: string;
};
type ChangeRow = AssignmentRow & {
  change_id: string;
  request_status: string;
  request_type: string;
  requested_shift_instance_id: string | null;
};
type TimeEntryRow = {
  id: string;
  employee_id: string;
  work_date: string;
  minutes: number;
  status: string;
};

const date = z.string().date();
const decision = z.enum(["approved", "rejected"]);

function database(): Db {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for shifts and timesheets",
    });
  }
  return db;
}

function actorId(ctx: TrpcContext): string {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return ctx.employeeId;
}

function requireOperator(ctx: TrpcContext): string {
  const actor = actorId(ctx);
  if (!isWorkforceOperator(ctx.roles)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "HR or traffic role required",
    });
  }
  return actor;
}

function requireRow<T>(row: T | undefined): T {
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return row;
}

async function employeeScope(
  ctx: TrpcContext,
  targetEmployeeId: string,
  mode: "view" | "decide",
): Promise<EmployeeRow> {
  const target = requireRow(
    (
      await database().execute<EmployeeRow>(sql`
        SELECT employee_id, reports_to_email
        FROM public.employee
        WHERE employee_id = ${targetEmployeeId}::uuid
      `)
    )[0],
  );
  const input = {
    roles: ctx.roles,
    actorEmployeeId: actorId(ctx),
    targetEmployeeId,
    isDirectReport:
      Boolean(target.reports_to_email) &&
      target.reports_to_email!.toLowerCase() === ctx.user!.email.toLowerCase(),
  };
  const allowed =
    mode === "decide" ? canDecideWorkRequest(input) : canViewWorkRecord(input);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
  return target;
}

async function appendAudit(
  tx: WorkTx,
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

function parseShiftWindow(startsAt: string, endsAt: string) {
  try {
    return validateShiftWindow(startsAt, endsAt);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Shift end must follow start and be within 48 hours",
    });
  }
}

async function lockEmployee(tx: WorkTx, employeeId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${employeeId}::text, 0))`,
  );
}

async function assertNoShiftConflict(
  tx: WorkTx,
  employeeId: string,
  targetShiftId: string,
  ignoreAssignmentId?: string,
) {
  const conflict = (
    await tx.execute<{ id: string }>(sql`
      SELECT existing.shift_assignment_id AS id
      FROM public.shift_instance target
      JOIN public.shift_assignment existing
        ON existing.employee_id = ${employeeId}::uuid
      JOIN public.shift_instance occupied
        ON occupied.shift_instance_id = existing.shift_instance_id
      WHERE target.shift_instance_id = ${targetShiftId}::uuid
        AND (${ignoreAssignmentId ?? null}::uuid IS NULL
          OR existing.shift_assignment_id <> ${ignoreAssignmentId ?? null}::uuid)
        AND (
          existing.shift_instance_id = target.shift_instance_id
          OR (
            existing.status IN ('assigned', 'confirmed')
            AND occupied.status <> 'cancelled'
            AND occupied.starts_at < target.ends_at
            AND occupied.ends_at > target.starts_at
          )
        )
      LIMIT 1
    `)
  )[0];
  if (conflict) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Employee already has an overlapping shift",
    });
  }
}

const templatesRouter = router({
  list: staffProcedure.query(({ ctx }) =>
    database().execute(sql`
      SELECT *
      FROM public.shift_template
      WHERE is_active OR ${isWorkforceOperator(ctx.roles)}
      ORDER BY name
    `),
  ),

  save: staffProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(160),
        startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
        endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
        breakMinutes: z.number().int().min(0).max(720).default(0),
        site: z.string().trim().max(200).optional(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.startTime === input.endTime) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Shift cannot be 24 hours",
        });
      }
      const actor = requireOperator(ctx);
      const db = database();
      return db.transaction(async (tx) => {
        const before = input.id
          ? (
              await tx.execute<Record<string, unknown>>(sql`
                SELECT * FROM public.shift_template
                WHERE shift_template_id = ${input.id}::uuid
                FOR UPDATE
              `)
            )[0]
          : undefined;
        if (input.id && !before) throw new TRPCError({ code: "NOT_FOUND" });
        const id = input.id ?? randomUUID();
        const saved = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              INSERT INTO public.shift_template (
                shift_template_id, name, start_time, end_time, break_minutes,
                site, is_active, created_by_employee_id
              ) VALUES (
                ${id}::uuid, ${input.name}, ${input.startTime}::time,
                ${input.endTime}::time, ${input.breakMinutes}, ${input.site ?? null},
                ${input.isActive}, ${actor}::uuid
              )
              ON CONFLICT (shift_template_id) DO UPDATE SET
                name = EXCLUDED.name, start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time, break_minutes = EXCLUDED.break_minutes,
                site = EXCLUDED.site, is_active = EXCLUDED.is_active,
                updated_at = now()
              RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          input.id ? "shift.template.update" : "shift.template.create",
          "shift_template",
          id,
          before ?? null,
          saved,
        );
        return saved;
      });
    }),
});

const shiftsRouter = router({
  list: staffProcedure
    .input(
      z
        .object({
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
          employeeId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const actor = actorId(ctx);
      const target = input?.employeeId;
      if (target) await employeeScope(ctx, target, "view");
      const operator = isWorkforceOperator(ctx.roles);
      return database().execute(sql`
        SELECT shift.*, assignment.shift_assignment_id, assignment.employee_id,
               assignment.status AS assignment_status, employee.display_name AS employee_name
        FROM public.shift_instance shift
        LEFT JOIN public.shift_assignment assignment
          ON assignment.shift_instance_id = shift.shift_instance_id
         AND assignment.status <> 'cancelled'
        LEFT JOIN public.employee employee
          ON employee.employee_id = assignment.employee_id
        WHERE (${input?.from ?? null}::timestamptz IS NULL OR shift.ends_at >= ${input?.from ?? null}::timestamptz)
          AND (${input?.to ?? null}::timestamptz IS NULL OR shift.starts_at <= ${input?.to ?? null}::timestamptz)
          AND (${target ?? null}::uuid IS NULL OR assignment.employee_id = ${target ?? null}::uuid)
          AND (
            ${operator}
            OR (
              shift.status = 'published'
              AND (
                assignment.employee_id = ${actor}::uuid
                OR lower(employee.reports_to_email) = lower(${ctx.user!.email})
              )
            )
          )
        ORDER BY shift.starts_at, employee.display_name
      `);
    }),

  create: staffProcedure
    .input(
      z.object({
        templateId: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(160),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        breakMinutes: z.number().int().min(0).max(720).default(0),
        site: z.string().trim().max(200).optional(),
        requiredStaff: z.number().int().min(0).max(10000).default(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const window = parseShiftWindow(input.startsAt, input.endsAt);
      const actor = requireOperator(ctx);
      const db = database();
      const id = randomUUID();
      return db.transaction(async (tx) => {
        const created = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              INSERT INTO public.shift_instance (
                shift_instance_id, shift_template_id, name, starts_at, ends_at,
                break_minutes, site, required_staff, created_by_employee_id
              ) VALUES (
                ${id}::uuid, ${input.templateId ?? null}::uuid, ${input.name},
                ${window.startsAt}, ${window.endsAt}, ${input.breakMinutes},
                ${input.site ?? null}, ${input.requiredStaff}, ${actor}::uuid
              ) RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          "shift.instance.create",
          "shift_instance",
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
        status: z.enum(["published", "cancelled"]),
        reason: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const actor = requireOperator(ctx);
      const db = database();
      return db.transaction(async (tx) => {
        const before = requireRow(
          (
            await tx.execute<ShiftRow>(sql`
              SELECT shift_instance_id AS id, status, starts_at, ends_at
              FROM public.shift_instance
              WHERE shift_instance_id = ${input.id}::uuid
              FOR UPDATE
            `)
          )[0],
        );
        if (!canTransitionShift(before.status, input.status)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Invalid shift transition",
          });
        }
        if (input.status === "published") {
          const conflicts = await tx.execute<{ employee_id: string }>(sql`
            SELECT DISTINCT assignment.employee_id
            FROM public.shift_assignment assignment
            WHERE assignment.shift_instance_id = ${input.id}::uuid
              AND assignment.status IN ('assigned', 'confirmed')
              AND EXISTS (
                SELECT 1
                FROM public.shift_assignment other_assignment
                JOIN public.shift_instance other
                  ON other.shift_instance_id = other_assignment.shift_instance_id
                WHERE other_assignment.employee_id = assignment.employee_id
                  AND other_assignment.status IN ('assigned', 'confirmed')
                  AND other.status = 'published'
                  AND other.shift_instance_id <> ${input.id}::uuid
                  AND other.starts_at < ${before.ends_at}
                  AND other.ends_at > ${before.starts_at}
              )
          `);
          if (conflicts.length) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `${conflicts.length} employee(s) have overlapping published shifts`,
            });
          }
        }
        const saved = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              UPDATE public.shift_instance
              SET status = ${input.status},
                  published_by_employee_id = CASE WHEN ${input.status} = 'published' THEN ${actor}::uuid ELSE published_by_employee_id END,
                  published_at = CASE WHEN ${input.status} = 'published' THEN now() ELSE published_at END,
                  cancelled_by_employee_id = CASE WHEN ${input.status} = 'cancelled' THEN ${actor}::uuid ELSE cancelled_by_employee_id END,
                  cancelled_at = CASE WHEN ${input.status} = 'cancelled' THEN now() ELSE cancelled_at END,
                  updated_at = now()
              WHERE shift_instance_id = ${input.id}::uuid
              RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          `shift.instance.${input.status}`,
          "shift_instance",
          input.id,
          { status: before.status },
          saved,
          input.reason,
        );
        return saved;
      });
    }),
});

const assignmentsRouter = router({
  assign: staffProcedure
    .input(
      z.object({
        shiftId: z.string().uuid(),
        employeeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const actor = requireOperator(ctx);
      const db = database();
      return db.transaction(async (tx) => {
        await lockEmployee(tx, input.employeeId);
        const shift = requireRow(
          (
            await tx.execute<ShiftRow>(sql`
              SELECT shift_instance_id AS id, status, starts_at, ends_at
              FROM public.shift_instance
              WHERE shift_instance_id = ${input.shiftId}::uuid
              FOR UPDATE
            `)
          )[0],
        );
        if (shift.status !== "draft") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Assign before publishing the shift",
          });
        }
        await employeeScope(ctx, input.employeeId, "view");
        await assertNoShiftConflict(tx, input.employeeId, input.shiftId);
        const id = randomUUID();
        const created = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              INSERT INTO public.shift_assignment (
                shift_assignment_id, shift_instance_id, employee_id, assigned_by_employee_id
              ) VALUES (${id}::uuid, ${input.shiftId}::uuid, ${input.employeeId}::uuid, ${actor}::uuid)
              RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          "shift.assignment.create",
          "shift_assignment",
          id,
          null,
          created,
        );
        return created;
      });
    }),

  respond: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        response: z.enum(["confirmed", "declined"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = database();
      const actor = actorId(ctx);
      return db.transaction(async (tx) => {
        const before = requireRow(
          (
            await tx.execute<AssignmentRow & { shift_status: string }>(sql`
              SELECT assignment.shift_assignment_id AS id, assignment.employee_id,
                     assignment.shift_instance_id, assignment.status, shift.status AS shift_status
              FROM public.shift_assignment assignment
              JOIN public.shift_instance shift USING (shift_instance_id)
              WHERE assignment.shift_assignment_id = ${input.id}::uuid
              FOR UPDATE OF assignment
            `)
          )[0],
        );
        if (
          before.employee_id !== actor ||
          before.status !== "assigned" ||
          before.shift_status !== "published"
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Assignment cannot be changed",
          });
        }
        const saved = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              UPDATE public.shift_assignment
              SET status = ${input.response},
                  confirmed_at = CASE WHEN ${input.response} = 'confirmed' THEN now() ELSE NULL END,
                  updated_at = now()
              WHERE shift_assignment_id = ${input.id}::uuid
              RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          `shift.assignment.${input.response}`,
          "shift_assignment",
          input.id,
          { status: before.status },
          saved,
        );
        return saved;
      });
    }),
});

const changesRouter = router({
  list: staffProcedure.query(async ({ ctx }) => {
    const actor = actorId(ctx);
    const operator = isWorkforceOperator(ctx.roles);
    return database().execute(sql`
      SELECT request.*, employee.display_name,
             current_shift.name AS current_shift_name,
             requested_shift.name AS requested_shift_name
      FROM public.shift_change_request request
      JOIN public.employee employee ON employee.employee_id = request.employee_id
      JOIN public.shift_assignment assignment USING (shift_assignment_id)
      JOIN public.shift_instance current_shift ON current_shift.shift_instance_id = assignment.shift_instance_id
      LEFT JOIN public.shift_instance requested_shift
        ON requested_shift.shift_instance_id = request.requested_shift_instance_id
      WHERE ${operator}
         OR request.employee_id = ${actor}::uuid
         OR lower(employee.reports_to_email) = lower(${ctx.user!.email})
      ORDER BY request.created_at DESC
    `);
  }),

  create: staffProcedure
    .input(
      z.object({
        assignmentId: z.string().uuid(),
        type: z.enum(["move", "unassign"]),
        requestedShiftId: z.string().uuid().optional(),
        reason: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if ((input.type === "move") !== Boolean(input.requestedShiftId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Move requests need a target shift",
        });
      }
      const db = database();
      const actor = actorId(ctx);
      const id = randomUUID();
      return db.transaction(async (tx) => {
        const assignment = requireRow(
          (
            await tx.execute<AssignmentRow & { shift_status: string }>(sql`
              SELECT assignment.shift_assignment_id AS id, assignment.employee_id,
                     assignment.shift_instance_id, assignment.status, shift.status AS shift_status
              FROM public.shift_assignment assignment
              JOIN public.shift_instance shift USING (shift_instance_id)
              WHERE assignment.shift_assignment_id = ${input.assignmentId}::uuid
              FOR UPDATE OF assignment
            `)
          )[0],
        );
        if (
          assignment.employee_id !== actor ||
          !["assigned", "confirmed"].includes(assignment.status) ||
          assignment.shift_status !== "published"
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only your published assignment can be changed",
          });
        }
        if (input.requestedShiftId === assignment.shift_instance_id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose a different shift",
          });
        }
        const pending = (
          await tx.execute<{ id: string }>(sql`
            SELECT shift_change_request_id AS id
            FROM public.shift_change_request
            WHERE shift_assignment_id = ${input.assignmentId}::uuid AND status = 'pending'
          `)
        )[0];
        if (pending)
          throw new TRPCError({
            code: "CONFLICT",
            message: "A change request is already pending",
          });
        if (input.requestedShiftId) {
          const requested = requireRow(
            (
              await tx.execute<ShiftRow>(sql`
                SELECT shift_instance_id AS id, status, starts_at, ends_at
                FROM public.shift_instance
                WHERE shift_instance_id = ${input.requestedShiftId}::uuid
              `)
            )[0],
          );
          if (requested.status !== "published") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Requested shift is not published",
            });
          }
          await lockEmployee(tx, actor);
          await assertNoShiftConflict(tx, actor, requested.id, assignment.id);
        }
        const created = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              INSERT INTO public.shift_change_request (
                shift_change_request_id, shift_assignment_id, employee_id,
                request_type, requested_shift_instance_id, reason
              ) VALUES (
                ${id}::uuid, ${input.assignmentId}::uuid, ${actor}::uuid,
                ${input.type}, ${input.requestedShiftId ?? null}::uuid, ${input.reason}
              ) RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          "shift.change.create",
          "shift_change_request",
          id,
          null,
          created,
        );
        return created;
      });
    }),

  decide: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        decision,
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = database();
      const actor = actorId(ctx);
      return db.transaction(async (tx) => {
        const request = requireRow(
          (
            await tx.execute<ChangeRow>(sql`
              SELECT request.shift_change_request_id AS change_id,
                     request.status AS request_status, request.request_type,
                     request.requested_shift_instance_id,
                     assignment.shift_assignment_id AS id, assignment.employee_id,
                     assignment.shift_instance_id, assignment.status
              FROM public.shift_change_request request
              JOIN public.shift_assignment assignment USING (shift_assignment_id)
              WHERE request.shift_change_request_id = ${input.id}::uuid
              FOR UPDATE OF request, assignment
            `)
          )[0],
        );
        if (request.request_status !== "pending") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Request already decided",
          });
        }
        await employeeScope(ctx, request.employee_id, "decide");
        if (input.decision === "approved") {
          await lockEmployee(tx, request.employee_id);
          if (
            request.request_type === "move" &&
            request.requested_shift_instance_id
          ) {
            const requested = requireRow(
              (
                await tx.execute<ShiftRow>(sql`
                  SELECT shift_instance_id AS id, status, starts_at, ends_at
                  FROM public.shift_instance
                  WHERE shift_instance_id = ${request.requested_shift_instance_id}::uuid
                  FOR UPDATE
                `)
              )[0],
            );
            if (requested.status !== "published") {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Requested shift is no longer published",
              });
            }
            await assertNoShiftConflict(
              tx,
              request.employee_id,
              request.requested_shift_instance_id,
              request.id,
            );
            await tx.execute(sql`
              UPDATE public.shift_assignment
              SET shift_instance_id = ${request.requested_shift_instance_id}::uuid,
                  status = 'assigned', confirmed_at = NULL, updated_at = now()
              WHERE shift_assignment_id = ${request.id}::uuid
            `);
          } else {
            await tx.execute(sql`
              UPDATE public.shift_assignment
              SET status = 'cancelled', updated_at = now()
              WHERE shift_assignment_id = ${request.id}::uuid
            `);
          }
        }
        const saved = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              UPDATE public.shift_change_request
              SET status = ${input.decision}, decided_by_employee_id = ${actor}::uuid,
                  decision_note = ${input.note ?? null}, decided_at = now(), updated_at = now()
              WHERE shift_change_request_id = ${input.id}::uuid
              RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          `shift.change.${input.decision}`,
          "shift_change_request",
          input.id,
          { status: "pending" },
          saved,
          input.note,
        );
        return saved;
      });
    }),
});

const projectsRouter = router({
  list: staffProcedure.query(({ ctx }) =>
    database().execute(sql`
      SELECT project.*, client.name AS client_name
      FROM public.work_project project
      LEFT JOIN public.client client USING (client_id)
      WHERE project.is_active OR ${isWorkforceOperator(ctx.roles)}
      ORDER BY project.name
    `),
  ),

  save: staffProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
        code: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(5000).optional(),
        isBillableDefault: z.boolean().default(true),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const actor = requireOperator(ctx);
      const db = database();
      const id = input.id ?? randomUUID();
      return db.transaction(async (tx) => {
        const before = input.id
          ? (
              await tx.execute<Record<string, unknown>>(sql`
                SELECT * FROM public.work_project
                WHERE work_project_id = ${input.id}::uuid
                FOR UPDATE
              `)
            )[0]
          : undefined;
        if (input.id && !before) throw new TRPCError({ code: "NOT_FOUND" });
        const saved = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              INSERT INTO public.work_project (
                work_project_id, client_id, code, name, description,
                is_billable_default, is_active, created_by_employee_id
              ) VALUES (
                ${id}::uuid, ${input.clientId ?? null}::uuid, ${input.code}, ${input.name},
                ${input.description ?? null}, ${input.isBillableDefault}, ${input.isActive},
                ${actor}::uuid
              )
              ON CONFLICT (work_project_id) DO UPDATE SET
                client_id = EXCLUDED.client_id, code = EXCLUDED.code,
                name = EXCLUDED.name, description = EXCLUDED.description,
                is_billable_default = EXCLUDED.is_billable_default,
                is_active = EXCLUDED.is_active, updated_at = now()
              RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          input.id ? "timesheet.project.update" : "timesheet.project.create",
          "work_project",
          id,
          before ?? null,
          saved,
        );
        return saved;
      });
    }),
});

const entriesRouter = router({
  list: staffProcedure
    .input(
      z
        .object({
          employeeId: z.string().uuid().optional(),
          from: date.optional(),
          to: date.optional(),
          status: z
            .enum(["draft", "submitted", "approved", "rejected"])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const actor = actorId(ctx);
      if (input?.employeeId) await employeeScope(ctx, input.employeeId, "view");
      const operator = isWorkforceOperator(ctx.roles);
      return database().execute(sql`
        SELECT entry.*, employee.display_name AS employee_name,
               project.code AS project_code, project.name AS project_name,
               client.name AS client_name
        FROM public.time_entry entry
        JOIN public.employee employee USING (employee_id)
        JOIN public.work_project project USING (work_project_id)
        LEFT JOIN public.client client ON client.client_id = project.client_id
        WHERE (${input?.employeeId ?? null}::uuid IS NULL OR entry.employee_id = ${input?.employeeId ?? null}::uuid)
          AND (${input?.from ?? null}::date IS NULL OR entry.work_date >= ${input?.from ?? null}::date)
          AND (${input?.to ?? null}::date IS NULL OR entry.work_date <= ${input?.to ?? null}::date)
          AND (${input?.status ?? null}::text IS NULL OR entry.status = ${input?.status ?? null})
          AND (
            ${operator}
            OR entry.employee_id = ${actor}::uuid
            OR lower(employee.reports_to_email) = lower(${ctx.user!.email})
          )
        ORDER BY entry.work_date DESC, entry.created_at DESC
      `);
    }),

  create: staffProcedure
    .input(
      z.object({
        employeeId: z.string().uuid().optional(),
        projectId: z.string().uuid(),
        workDate: date,
        minutes: z.number().int().min(1).max(1440),
        isBillable: z.boolean(),
        description: z.string().trim().max(5000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = database();
      const actor = actorId(ctx);
      const target = input.employeeId ?? actor;
      if (target !== actor && !isWorkforceOperator(ctx.roles)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot create another employee's time",
        });
      }
      await employeeScope(ctx, target, "view");
      const id = randomUUID();
      return db.transaction(async (tx) => {
        await lockEmployee(tx, `${target}:${input.workDate}`);
        const total = Number(
          (
            await tx.execute<{ minutes: number }>(sql`
              SELECT coalesce(sum(minutes), 0)::int AS minutes
              FROM public.time_entry
              WHERE employee_id = ${target}::uuid AND work_date = ${input.workDate}::date
            `)
          )[0]?.minutes ?? 0,
        );
        try {
          validateDailyMinutes(total, input.minutes);
        } catch {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Daily time cannot exceed 24 hours",
          });
        }
        const created = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              INSERT INTO public.time_entry (
                time_entry_id, employee_id, work_project_id, work_date, minutes,
                is_billable, description, created_by_employee_id
              ) VALUES (
                ${id}::uuid, ${target}::uuid, ${input.projectId}::uuid,
                ${input.workDate}::date, ${input.minutes}, ${input.isBillable},
                ${input.description ?? null}, ${actor}::uuid
              ) RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          "timesheet.entry.create",
          "time_entry",
          id,
          null,
          created,
        );
        return created;
      });
    }),

  update: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        projectId: z.string().uuid(),
        workDate: date,
        minutes: z.number().int().min(1).max(1440),
        isBillable: z.boolean(),
        description: z.string().trim().max(5000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = database();
      const actor = actorId(ctx);
      return db.transaction(async (tx) => {
        const before = requireRow(
          (
            await tx.execute<TimeEntryRow>(sql`
              SELECT time_entry_id AS id, employee_id, work_date::text, minutes, status
              FROM public.time_entry
              WHERE time_entry_id = ${input.id}::uuid
              FOR UPDATE
            `)
          )[0],
        );
        if (
          (before.employee_id !== actor && !isWorkforceOperator(ctx.roles)) ||
          !["draft", "rejected"].includes(before.status)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only draft or rejected entries can change",
          });
        }
        await lockEmployee(tx, `${before.employee_id}:${input.workDate}`);
        const total = Number(
          (
            await tx.execute<{ minutes: number }>(sql`
              SELECT coalesce(sum(minutes), 0)::int AS minutes
              FROM public.time_entry
              WHERE employee_id = ${before.employee_id}::uuid
                AND work_date = ${input.workDate}::date
                AND time_entry_id <> ${input.id}::uuid
            `)
          )[0]?.minutes ?? 0,
        );
        try {
          validateDailyMinutes(total, input.minutes);
        } catch {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Daily time cannot exceed 24 hours",
          });
        }
        const saved = requireRow(
          (
            await tx.execute<Record<string, unknown>>(sql`
              UPDATE public.time_entry
              SET work_project_id = ${input.projectId}::uuid,
                  work_date = ${input.workDate}::date, minutes = ${input.minutes},
                  is_billable = ${input.isBillable}, description = ${input.description ?? null},
                  status = 'draft', submitted_at = NULL, decision_note = NULL,
                  decided_by_employee_id = NULL, decided_at = NULL, updated_at = now()
              WHERE time_entry_id = ${input.id}::uuid
              RETURNING *
            `)
          )[0],
        );
        await appendAudit(
          tx,
          actor,
          "timesheet.entry.update",
          "time_entry",
          input.id,
          before,
          saved,
        );
        return saved;
      });
    }),

  remove: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const db = database();
      const actor = actorId(ctx);
      return db.transaction(async (tx) => {
        const before = requireRow(
          (
            await tx.execute<TimeEntryRow & Record<string, unknown>>(sql`
              SELECT *, time_entry_id AS id
              FROM public.time_entry
              WHERE time_entry_id = ${input.id}::uuid
              FOR UPDATE
            `)
          )[0],
        );
        if (
          (before.employee_id !== actor && !isWorkforceOperator(ctx.roles)) ||
          !["draft", "rejected"].includes(before.status)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only draft or rejected entries can be removed",
          });
        }
        await tx.execute(
          sql`DELETE FROM public.time_entry WHERE time_entry_id = ${input.id}::uuid`,
        );
        await appendAudit(
          tx,
          actor,
          "timesheet.entry.remove",
          "time_entry",
          input.id,
          before,
          null,
        );
        return { ok: true };
      });
    }),

  submit: staffProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const db = database();
      const actor = actorId(ctx);
      return db.transaction(async (tx) => {
        const rows = await tx.execute<TimeEntryRow>(sql`
          SELECT time_entry_id AS id, employee_id, work_date::text, minutes, status
          FROM public.time_entry
          WHERE time_entry_id = ANY(${input.ids}::uuid[])
          FOR UPDATE
        `);
        if (
          rows.length !== new Set(input.ids).size ||
          rows.some(
            (row) =>
              !["draft", "rejected"].includes(row.status) ||
              (row.employee_id !== actor && !isWorkforceOperator(ctx.roles)),
          )
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Entries cannot be submitted",
          });
        }
        const updated = await tx.execute<Record<string, unknown>>(sql`
          UPDATE public.time_entry
          SET status = 'submitted', submitted_at = now(), updated_at = now()
          WHERE time_entry_id = ANY(${input.ids}::uuid[])
          RETURNING *
        `);
        for (const entry of rows) {
          await appendAudit(
            tx,
            actor,
            "timesheet.entry.submit",
            "time_entry",
            entry.id,
            { status: entry.status },
            { status: "submitted" },
          );
        }
        return updated;
      });
    }),

  decide: staffProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        decision,
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = database();
      const actor = actorId(ctx);
      return db.transaction(async (tx) => {
        const rows = await tx.execute<TimeEntryRow>(sql`
          SELECT time_entry_id AS id, employee_id, work_date::text, minutes, status
          FROM public.time_entry
          WHERE time_entry_id = ANY(${input.ids}::uuid[])
          FOR UPDATE
        `);
        if (
          rows.length !== new Set(input.ids).size ||
          rows.some((row) => row.status !== "submitted")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Only submitted entries can be decided",
          });
        }
        for (const employeeId of new Set(rows.map((row) => row.employee_id))) {
          await employeeScope(ctx, employeeId, "decide");
        }
        const updated = await tx.execute<Record<string, unknown>>(sql`
          UPDATE public.time_entry
          SET status = ${input.decision}, decided_by_employee_id = ${actor}::uuid,
              decision_note = ${input.note ?? null}, decided_at = now(), updated_at = now()
          WHERE time_entry_id = ANY(${input.ids}::uuid[])
          RETURNING *
        `);
        for (const entry of rows) {
          await appendAudit(
            tx,
            actor,
            `timesheet.entry.${input.decision}`,
            "time_entry",
            entry.id,
            { status: "submitted" },
            { status: input.decision },
            input.note,
          );
        }
        return updated;
      });
    }),

  summary: staffProcedure
    .input(
      z.object({
        from: date,
        to: date,
        employeeId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const actor = actorId(ctx);
      if (input.employeeId) await employeeScope(ctx, input.employeeId, "view");
      const operator = isWorkforceOperator(ctx.roles);
      return database().execute(sql`
        SELECT project.work_project_id, project.code, project.name,
               client.name AS client_name, entry.employee_id, employee.display_name,
               sum(entry.minutes)::int AS total_minutes,
               sum(entry.minutes) FILTER (WHERE entry.is_billable)::int AS billable_minutes,
               sum(entry.minutes) FILTER (WHERE NOT entry.is_billable)::int AS nonbillable_minutes
        FROM public.time_entry entry
        JOIN public.work_project project USING (work_project_id)
        JOIN public.employee employee USING (employee_id)
        LEFT JOIN public.client client ON client.client_id = project.client_id
        WHERE entry.work_date BETWEEN ${input.from}::date AND ${input.to}::date
          AND (${input.employeeId ?? null}::uuid IS NULL OR entry.employee_id = ${input.employeeId ?? null}::uuid)
          AND (
            ${operator}
            OR entry.employee_id = ${actor}::uuid
            OR lower(employee.reports_to_email) = lower(${ctx.user!.email})
          )
        GROUP BY project.work_project_id, project.code, project.name,
                 client.name, entry.employee_id, employee.display_name
        ORDER BY project.name, employee.display_name
      `);
    }),
});

export const shiftsTimesheetsRouter = router({
  templates: templatesRouter,
  shifts: shiftsRouter,
  assignments: assignmentsRouter,
  changes: changesRouter,
  projects: projectsRouter,
  entries: entriesRouter,
});
