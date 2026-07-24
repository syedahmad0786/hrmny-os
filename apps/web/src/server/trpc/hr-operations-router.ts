import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  and,
  attendanceCorrectionRequest,
  attendanceRecord,
  auditEvent,
  desc,
  employee,
  eq,
  leaveBalance,
  leavePolicy,
  leaveRequest,
  sql,
} from "@hrmny/db";
import { getDb } from "../db";
import {
  calculateLeaveDays,
  canAccessEmployeeHrData,
  canDecideEmployeeRequest,
  dubaiDate,
  isHrAdministrator,
  validateAttendanceWindow,
} from "../hr-operations";
import { router, staffProcedure, type TrpcContext } from "./trpc";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decision = z.enum(["approved", "rejected"]);

function database() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for leave and attendance",
    });
  }
  return db;
}

function actorId(ctx: TrpcContext): string {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return ctx.employeeId;
}

function requireHr(ctx: TrpcContext): void {
  if (!isHrAdministrator(ctx.roles)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "HR role required" });
  }
}

async function employeeScope(
  ctx: TrpcContext,
  targetEmployeeId: string,
  mode: "read" | "decide",
) {
  const db = database();
  const [target] = await db
    .select({
      employeeId: employee.employeeId,
      email: employee.email,
      displayName: employee.displayName,
      reportsToEmail: employee.reportsToEmail,
    })
    .from(employee)
    .where(eq(employee.employeeId, targetEmployeeId))
    .limit(1);
  if (!target) throw new TRPCError({ code: "NOT_FOUND" });

  const access = {
    roles: ctx.roles,
    actorEmployeeId: actorId(ctx),
    targetEmployeeId,
    isDirectReport:
      Boolean(target.reportsToEmail) &&
      target.reportsToEmail!.toLowerCase() === ctx.user!.email.toLowerCase(),
  };
  const allowed =
    mode === "decide"
      ? canDecideEmployeeRequest(access)
      : canAccessEmployeeHrData(access);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
  return target;
}

const policiesRouter = router({
  list: staffProcedure.query(() =>
    database().select().from(leavePolicy).orderBy(leavePolicy.name),
  ),

  save: staffProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        leaveType: z.string().trim().min(1).max(80),
        annualDays: z.number().min(0).max(366),
        maxCarryoverDays: z.number().min(0).max(366).default(0),
        isPaid: z.boolean().default(true),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireHr(ctx);
      const db = database();
      return db.transaction(async (tx) => {
        const [before] = input.id
          ? await tx
              .select()
              .from(leavePolicy)
              .where(eq(leavePolicy.leavePolicyId, input.id))
              .limit(1)
          : [];
        if (input.id && !before) throw new TRPCError({ code: "NOT_FOUND" });
        const values = {
          name: input.name,
          leaveType: input.leaveType,
          annualDays: String(input.annualDays),
          maxCarryoverDays: String(input.maxCarryoverDays),
          isPaid: input.isPaid,
          isActive: input.isActive,
          updatedAt: new Date(),
        };
        const [saved] = input.id
          ? await tx
              .update(leavePolicy)
              .set(values)
              .where(eq(leavePolicy.leavePolicyId, input.id))
              .returning()
          : await tx.insert(leavePolicy).values(values).returning();
        await tx.insert(auditEvent).values({
          actorEmployeeId: actorId(ctx),
          action: input.id ? "leave.policy.update" : "leave.policy.create",
          entityType: "leave_policy",
          entityId: saved!.leavePolicyId,
          before: before ?? null,
          after: saved!,
        });
        return saved!;
      });
    }),
});

const balancesRouter = router({
  list: staffProcedure
    .input(
      z.object({
        employeeId: z.string().uuid().optional(),
        year: z.number().int(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const target = input.employeeId ?? actorId(ctx);
      await employeeScope(ctx, target, "read");
      return database()
        .select({
          leaveBalanceId: leaveBalance.leaveBalanceId,
          employeeId: leaveBalance.employeeId,
          leavePolicyId: leaveBalance.leavePolicyId,
          policyName: leavePolicy.name,
          entitledDays: leaveBalance.entitledDays,
          carriedOverDays: leaveBalance.carriedOverDays,
          adjustmentDays: leaveBalance.adjustmentDays,
          year: leaveBalance.year,
        })
        .from(leaveBalance)
        .innerJoin(
          leavePolicy,
          eq(leavePolicy.leavePolicyId, leaveBalance.leavePolicyId),
        )
        .where(
          and(
            eq(leaveBalance.employeeId, target),
            eq(leaveBalance.year, input.year),
          ),
        );
    }),

  set: staffProcedure
    .input(
      z.object({
        employeeId: z.string().uuid(),
        leavePolicyId: z.string().uuid(),
        year: z.number().int().min(2000).max(2200),
        entitledDays: z.number().min(0).max(366),
        carriedOverDays: z.number().min(0).max(366).default(0),
        adjustmentDays: z.number().min(-366).max(366).default(0),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireHr(ctx);
      await employeeScope(ctx, input.employeeId, "read");
      const db = database();
      return db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(leaveBalance)
          .where(
            and(
              eq(leaveBalance.employeeId, input.employeeId),
              eq(leaveBalance.leavePolicyId, input.leavePolicyId),
              eq(leaveBalance.year, input.year),
            ),
          )
          .limit(1);
        const [saved] = await tx
          .insert(leaveBalance)
          .values({
            employeeId: input.employeeId,
            leavePolicyId: input.leavePolicyId,
            year: input.year,
            entitledDays: String(input.entitledDays),
            carriedOverDays: String(input.carriedOverDays),
            adjustmentDays: String(input.adjustmentDays),
          })
          .onConflictDoUpdate({
            target: [
              leaveBalance.employeeId,
              leaveBalance.leavePolicyId,
              leaveBalance.year,
            ],
            set: {
              entitledDays: String(input.entitledDays),
              carriedOverDays: String(input.carriedOverDays),
              adjustmentDays: String(input.adjustmentDays),
              updatedAt: new Date(),
            },
          })
          .returning();
        await tx.insert(auditEvent).values({
          actorEmployeeId: actorId(ctx),
          action: "leave.balance.set",
          entityType: "leave_balance",
          entityId: saved!.leaveBalanceId,
          before: before ?? null,
          after: saved!,
        });
        return saved!;
      });
    }),
});

const requestsRouter = router({
  list: staffProcedure
    .input(
      z
        .object({
          employeeId: z.string().uuid().optional(),
          status: z
            .enum(["pending", "approved", "rejected", "cancelled"])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      if (input?.employeeId) await employeeScope(ctx, input.employeeId, "read");
      const visible = input?.employeeId
        ? eq(leaveRequest.employeeId, input.employeeId)
        : isHrAdministrator(ctx.roles)
          ? sql<boolean>`true`
          : sql<boolean>`(${leaveRequest.employeeId} = ${actorId(ctx)} or lower(${employee.reportsToEmail}) = lower(${ctx.user!.email}))`;
      return database()
        .select({
          leaveRequestId: leaveRequest.leaveRequestId,
          employeeId: leaveRequest.employeeId,
          employeeName: employee.displayName,
          policyName: leavePolicy.name,
          startDate: leaveRequest.startDate,
          endDate: leaveRequest.endDate,
          portion: leaveRequest.portion,
          days: leaveRequest.days,
          reason: leaveRequest.reason,
          status: leaveRequest.status,
          decisionNote: leaveRequest.decisionNote,
          createdAt: leaveRequest.createdAt,
        })
        .from(leaveRequest)
        .innerJoin(employee, eq(employee.employeeId, leaveRequest.employeeId))
        .innerJoin(
          leavePolicy,
          eq(leavePolicy.leavePolicyId, leaveRequest.leavePolicyId),
        )
        .where(
          input?.status
            ? and(visible, eq(leaveRequest.status, input.status))
            : visible,
        )
        .orderBy(desc(leaveRequest.createdAt));
    }),

  create: staffProcedure
    .input(
      z.object({
        employeeId: z.string().uuid().optional(),
        leavePolicyId: z.string().uuid(),
        startDate: date,
        endDate: date,
        portion: z.enum(["full", "first_half", "second_half"]).default("full"),
        reason: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = input.employeeId ?? actorId(ctx);
      if (target !== actorId(ctx)) requireHr(ctx);
      await employeeScope(ctx, target, "read");
      if (input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A leave request cannot span entitlement years",
        });
      }
      let days: number;
      try {
        days = calculateLeaveDays(
          input.startDate,
          input.endDate,
          input.portion,
        );
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "INVALID_LEAVE_DATES",
        });
      }
      const db = database();
      return db.transaction(async (tx) => {
        const [policy] = await tx
          .select()
          .from(leavePolicy)
          .where(
            and(
              eq(leavePolicy.leavePolicyId, input.leavePolicyId),
              eq(leavePolicy.isActive, true),
            ),
          )
          .limit(1);
        if (!policy) throw new TRPCError({ code: "NOT_FOUND" });
        const [overlap] = await tx
          .select({ id: leaveRequest.leaveRequestId })
          .from(leaveRequest)
          .where(
            sql`${leaveRequest.employeeId} = ${target} and ${leaveRequest.status} in ('pending', 'approved') and ${leaveRequest.startDate} <= ${input.endDate}::date and ${leaveRequest.endDate} >= ${input.startDate}::date`,
          )
          .limit(1);
        if (overlap) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Leave overlaps an existing request",
          });
        }
        const [created] = await tx
          .insert(leaveRequest)
          .values({
            employeeId: target,
            leavePolicyId: input.leavePolicyId,
            startDate: input.startDate,
            endDate: input.endDate,
            portion: input.portion,
            days: String(days),
            reason: input.reason || null,
          })
          .returning();
        await tx.insert(auditEvent).values({
          actorEmployeeId: actorId(ctx),
          action: "leave.request.create",
          entityType: "leave_request",
          entityId: created!.leaveRequestId,
          after: created!,
        });
        return created!;
      });
    }),

  decide: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        decision,
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = database();
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(leaveRequest)
          .where(eq(leaveRequest.leaveRequestId, input.id))
          .limit(1)
          .for("update");
        if (!request) throw new TRPCError({ code: "NOT_FOUND" });
        if (request.status !== "pending") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Request already decided",
          });
        }
        await employeeScope(ctx, request.employeeId, "decide");
        if (input.decision === "approved") {
          const year = Number(request.startDate.slice(0, 4));
          const [balance] = await tx
            .select()
            .from(leaveBalance)
            .where(
              and(
                eq(leaveBalance.employeeId, request.employeeId),
                eq(leaveBalance.leavePolicyId, request.leavePolicyId),
                eq(leaveBalance.year, year),
              ),
            )
            .limit(1)
            .for("update");
          const [policy] = await tx
            .select({ annualDays: leavePolicy.annualDays })
            .from(leavePolicy)
            .where(eq(leavePolicy.leavePolicyId, request.leavePolicyId))
            .limit(1);
          const [usage] = await tx
            .select({
              days: sql<string>`coalesce(sum(${leaveRequest.days}), 0)`,
            })
            .from(leaveRequest)
            .where(
              sql`${leaveRequest.employeeId} = ${request.employeeId} and ${leaveRequest.leavePolicyId} = ${request.leavePolicyId} and ${leaveRequest.status} = 'approved' and extract(year from ${leaveRequest.startDate}) = ${year}`,
            );
          const entitlement = balance
            ? Number(balance.entitledDays) +
              Number(balance.carriedOverDays) +
              Number(balance.adjustmentDays)
            : Number(policy?.annualDays ?? 0);
          if (Number(usage?.days ?? 0) + Number(request.days) > entitlement) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Insufficient leave balance",
            });
          }
        }
        const now = new Date();
        const [saved] = await tx
          .update(leaveRequest)
          .set({
            status: input.decision,
            decisionNote: input.note || null,
            decidedByEmployeeId: actorId(ctx),
            decidedAt: now,
            updatedAt: now,
          })
          .where(eq(leaveRequest.leaveRequestId, input.id))
          .returning();
        await tx.insert(auditEvent).values({
          actorEmployeeId: actorId(ctx),
          action: `leave.request.${input.decision}`,
          entityType: "leave_request",
          entityId: input.id,
          before: request,
          after: saved!,
          reason: input.note || null,
        });
        return saved!;
      });
    }),

  cancel: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const db = database();
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(leaveRequest)
          .where(eq(leaveRequest.leaveRequestId, input.id))
          .limit(1)
          .for("update");
        if (!request) throw new TRPCError({ code: "NOT_FOUND" });
        if (
          request.employeeId !== actorId(ctx) &&
          !isHrAdministrator(ctx.roles)
        ) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        if (request.status !== "pending") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Only pending requests can be cancelled",
          });
        }
        const [saved] = await tx
          .update(leaveRequest)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(leaveRequest.leaveRequestId, input.id))
          .returning();
        await tx.insert(auditEvent).values({
          actorEmployeeId: actorId(ctx),
          action: "leave.request.cancel",
          entityType: "leave_request",
          entityId: input.id,
          before: request,
          after: saved!,
        });
        return saved!;
      });
    }),
});

const attendanceRouter = router({
  list: staffProcedure
    .input(
      z
        .object({
          employeeId: z.string().uuid().optional(),
          from: date.optional(),
          to: date.optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      if (input?.employeeId) await employeeScope(ctx, input.employeeId, "read");
      const visible = input?.employeeId
        ? eq(attendanceRecord.employeeId, input.employeeId)
        : isHrAdministrator(ctx.roles)
          ? sql<boolean>`true`
          : sql<boolean>`(${attendanceRecord.employeeId} = ${actorId(ctx)} or lower(${employee.reportsToEmail}) = lower(${ctx.user!.email}))`;
      const range = and(
        visible,
        input?.from
          ? sql`${attendanceRecord.workDate} >= ${input.from}::date`
          : undefined,
        input?.to
          ? sql`${attendanceRecord.workDate} <= ${input.to}::date`
          : undefined,
      );
      return database()
        .select({
          attendanceRecordId: attendanceRecord.attendanceRecordId,
          employeeId: attendanceRecord.employeeId,
          employeeName: employee.displayName,
          workDate: attendanceRecord.workDate,
          clockInAt: attendanceRecord.clockInAt,
          clockOutAt: attendanceRecord.clockOutAt,
          source: attendanceRecord.source,
          note: attendanceRecord.note,
        })
        .from(attendanceRecord)
        .innerJoin(
          employee,
          eq(employee.employeeId, attendanceRecord.employeeId),
        )
        .where(range)
        .orderBy(desc(attendanceRecord.workDate));
    }),

  clockIn: staffProcedure.mutation(async ({ ctx }) => {
    const db = database();
    const now = new Date();
    const workDate = dubaiDate(now);
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(attendanceRecord)
        .values({
          employeeId: actorId(ctx),
          workDate,
          clockInAt: now,
          source: "web",
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Already clocked in today",
        });
      }
      await tx.insert(auditEvent).values({
        actorEmployeeId: actorId(ctx),
        action: "attendance.clock_in",
        entityType: "attendance_record",
        entityId: created.attendanceRecordId,
        after: created,
      });
      return created;
    });
  }),

  clockOut: staffProcedure.mutation(async ({ ctx }) => {
    const db = database();
    const workDate = dubaiDate();
    return db.transaction(async (tx) => {
      const [record] = await tx
        .select()
        .from(attendanceRecord)
        .where(
          and(
            eq(attendanceRecord.employeeId, actorId(ctx)),
            eq(attendanceRecord.workDate, workDate),
          ),
        )
        .limit(1)
        .for("update");
      if (!record)
        throw new TRPCError({ code: "NOT_FOUND", message: "Clock in first" });
      if (record.clockOutAt) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Already clocked out",
        });
      }
      const now = new Date();
      try {
        validateAttendanceWindow(
          record.workDate,
          record.clockInAt.toISOString(),
          now.toISOString(),
        );
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid attendance window",
        });
      }
      const [saved] = await tx
        .update(attendanceRecord)
        .set({ clockOutAt: now, updatedAt: now })
        .where(
          eq(attendanceRecord.attendanceRecordId, record.attendanceRecordId),
        )
        .returning();
      await tx.insert(auditEvent).values({
        actorEmployeeId: actorId(ctx),
        action: "attendance.clock_out",
        entityType: "attendance_record",
        entityId: record.attendanceRecordId,
        before: record,
        after: saved!,
      });
      return saved!;
    });
  }),

  corrections: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const visible = isHrAdministrator(ctx.roles)
        ? sql<boolean>`true`
        : sql<boolean>`(${attendanceCorrectionRequest.employeeId} = ${actorId(ctx)} or lower(${employee.reportsToEmail}) = lower(${ctx.user!.email}))`;
      return database()
        .select({
          attendanceCorrectionRequestId:
            attendanceCorrectionRequest.attendanceCorrectionRequestId,
          employeeId: attendanceCorrectionRequest.employeeId,
          employeeName: employee.displayName,
          workDate: attendanceCorrectionRequest.workDate,
          requestedClockInAt: attendanceCorrectionRequest.requestedClockInAt,
          requestedClockOutAt: attendanceCorrectionRequest.requestedClockOutAt,
          reason: attendanceCorrectionRequest.reason,
          status: attendanceCorrectionRequest.status,
          decisionNote: attendanceCorrectionRequest.decisionNote,
          createdAt: attendanceCorrectionRequest.createdAt,
        })
        .from(attendanceCorrectionRequest)
        .innerJoin(
          employee,
          eq(employee.employeeId, attendanceCorrectionRequest.employeeId),
        )
        .where(visible)
        .orderBy(desc(attendanceCorrectionRequest.createdAt));
    }),

    create: staffProcedure
      .input(
        z.object({
          workDate: date,
          clockInAt: z.string().datetime(),
          clockOutAt: z.string().datetime(),
          reason: z.string().trim().min(1).max(1000),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        let window: ReturnType<typeof validateAttendanceWindow>;
        try {
          window = validateAttendanceWindow(
            input.workDate,
            input.clockInAt,
            input.clockOutAt,
          );
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid attendance window",
          });
        }
        const db = database();
        return db.transaction(async (tx) => {
          const [record] = await tx
            .select({ id: attendanceRecord.attendanceRecordId })
            .from(attendanceRecord)
            .where(
              and(
                eq(attendanceRecord.employeeId, actorId(ctx)),
                eq(attendanceRecord.workDate, input.workDate),
              ),
            )
            .limit(1);
          const [created] = await tx
            .insert(attendanceCorrectionRequest)
            .values({
              employeeId: actorId(ctx),
              attendanceRecordId: record?.id ?? null,
              workDate: input.workDate,
              requestedClockInAt: window.clockIn,
              requestedClockOutAt: window.clockOut,
              reason: input.reason,
            })
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: actorId(ctx),
            action: "attendance.correction.create",
            entityType: "attendance_correction_request",
            entityId: created!.attendanceCorrectionRequestId,
            after: created!,
          });
          return created!;
        });
      }),

    decide: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          decision,
          note: z.string().trim().max(1000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = database();
        return db.transaction(async (tx) => {
          const [request] = await tx
            .select()
            .from(attendanceCorrectionRequest)
            .where(
              eq(
                attendanceCorrectionRequest.attendanceCorrectionRequestId,
                input.id,
              ),
            )
            .limit(1)
            .for("update");
          if (!request) throw new TRPCError({ code: "NOT_FOUND" });
          if (request.status !== "pending") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Request already decided",
            });
          }
          await employeeScope(ctx, request.employeeId, "decide");
          let attendanceRecordId = request.attendanceRecordId;
          if (input.decision === "approved") {
            const [record] = await tx
              .insert(attendanceRecord)
              .values({
                employeeId: request.employeeId,
                workDate: request.workDate,
                clockInAt: request.requestedClockInAt,
                clockOutAt: request.requestedClockOutAt,
                source: "correction",
                note: input.note || request.reason,
              })
              .onConflictDoUpdate({
                target: [
                  attendanceRecord.employeeId,
                  attendanceRecord.workDate,
                ],
                set: {
                  clockInAt: request.requestedClockInAt,
                  clockOutAt: request.requestedClockOutAt,
                  source: "correction",
                  note: input.note || request.reason,
                  updatedAt: new Date(),
                },
              })
              .returning();
            attendanceRecordId = record!.attendanceRecordId;
          }
          const now = new Date();
          const [saved] = await tx
            .update(attendanceCorrectionRequest)
            .set({
              attendanceRecordId,
              status: input.decision,
              decisionNote: input.note || null,
              decidedByEmployeeId: actorId(ctx),
              decidedAt: now,
              updatedAt: now,
            })
            .where(
              eq(
                attendanceCorrectionRequest.attendanceCorrectionRequestId,
                input.id,
              ),
            )
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: actorId(ctx),
            action: `attendance.correction.${input.decision}`,
            entityType: "attendance_correction_request",
            entityId: input.id,
            before: request,
            after: saved!,
            reason: input.note || null,
          });
          return saved!;
        });
      }),
  }),
});

export const hrOperationsRouter = router({
  policies: policiesRouter,
  balances: balancesRouter,
  requests: requestsRouter,
  attendance: attendanceRouter,
});
