import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  dorLockBlockedReason,
  evaluateShootLock,
  transition,
  validateDor,
  type ActorContext,
  type EntitySnapshot,
} from "@hrmny/gate";
import {
  DEMO_BRIEF_ID,
  DEMO_CALENDAR_ID,
  DEMO_CLIENT_ID,
  DEMO_CREATIVE_TASK_ID,
  DEMO_TASK_ID,
  getDemoStore,
  type DemoBrief,
  type DemoCalendar,
  type DemoTask,
} from "../demo-store";
import { driveSeam } from "../seams";
import { protectedProcedure, publicProcedure, router } from "./trpc";

function actorFrom(ctx: {
  employeeId: string | null;
  roles: string[];
  user: { permissions?: string[] } | null;
}): ActorContext {
  return {
    employeeId: ctx.employeeId ?? "00000000-0000-4000-8000-000000000000",
    roles: ctx.roles,
    permissions: ctx.user?.permissions ?? [],
  };
}

function taskSnapshot(task: DemoTask): EntitySnapshot {
  const waived = Boolean(
    (task as DemoTask & { qcWaived?: boolean }).qcWaived,
  );
  return {
    entityType: "task",
    entityId: task.taskId,
    state: task.status,
    data: {
      qcPassed: task.qcPassed,
      qcWaived: waived,
      clientRevisionCount: task.clientRevisionCount,
      revisionBoundaryAck: task.revisionBoundaryAck,
      missingRequiredCount: task.briefId
        ? (getDemoStore().briefs.get(task.briefId)?.missingRequiredCount ?? 0)
        : 0,
    },
  };
}

async function applyTaskTransition(
  ctx: {
    employeeId: string | null;
    roles: string[];
    user: { permissions?: string[] } | null;
  },
  task: DemoTask,
  to: string,
  payload?: Record<string, unknown>,
  overrideReason?: string | null,
) {
  const store = getDemoStore();
  return transition(actorFrom(ctx), taskSnapshot(task), {
    to,
    from: task.status,
    payload,
    overrideReason,
  }, {
    authorize: async () => true,
    apply: async ({ request }) => {
      task.status = request.to;
      if (request.payload?.qcPassed === true) task.qcPassed = true;
      store.tasks.set(task.taskId, task);
      return taskSnapshot(task);
    },
    audit: async (event) => {
      const row = store.appendAudit({
        actorEmployeeId: event.actorEmployeeId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? task.taskId,
        before: event.before,
        after: event.after,
        reason: event.reason ?? null,
      });
      return { auditId: row.auditEventId };
    },
  });
}

export const m4DemoRouter = router({
  reset: publicProcedure.mutation(() => {
    getDemoStore().resetM4Demo();
    return {
      ok: true as const,
      clientId: DEMO_CLIENT_ID,
      calendarId: DEMO_CALENDAR_ID,
      taskId: DEMO_TASK_ID,
      briefId: DEMO_BRIEF_ID,
      creativeTaskId: DEMO_CREATIVE_TASK_ID,
    };
  }),
  seedIds: publicProcedure.query(() => {
    const store = getDemoStore();
    if (store.calendars.size === 0) store.seedM4Demo();
    return {
      clientId: DEMO_CLIENT_ID,
      calendarId: DEMO_CALENDAR_ID,
      taskId: DEMO_TASK_ID,
      briefId: DEMO_BRIEF_ID,
      creativeTaskId: DEMO_CREATIVE_TASK_ID,
    };
  }),
});

export const calendarsRouter = router({
  listByClient: protectedProcedure
    .input(z.object({ clientId: z.string(), month: z.string().optional() }))
    .query(({ input }) => {
      let rows = [...getDemoStore().calendars.values()].filter(
        (c) => c.clientId === input.clientId,
      );
      if (input.month) rows = rows.filter((c) => c.month === input.month);
      return rows.map((c) => ({
        ...c,
        shootLock: evaluateShootLock({
          shootDate: c.shootDate,
          refApprovalState: c.refApprovalState,
        }),
      }));
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => {
      const c = getDemoStore().calendars.get(input.id);
      if (!c) return null;
      return {
        ...c,
        shootLock: evaluateShootLock({
          shootDate: c.shootDate,
          refApprovalState: c.refApprovalState,
        }),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
        focusPoints: z.array(z.unknown()).default([]),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      if (!store.clients.has(input.clientId)) throw new Error("NOT_FOUND");
      const calendar: DemoCalendar = {
        calendarId: randomUUID(),
        clientId: input.clientId,
        month: input.month,
        focusPoints: input.focusPoints,
        refApprovalState: null,
        finalApprovalState: null,
        shootDate: null,
        state: "draft",
        slots: [],
      };
      store.calendars.set(calendar.calendarId, calendar);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "calendars.create",
        entityType: "calendar",
        entityId: calendar.calendarId,
        before: null,
        after: { month: calendar.month },
        reason: null,
      });
      return calendar;
    }),

  addSlot: protectedProcedure
    .input(
      z.object({
        calendarId: z.string().uuid(),
        slotDate: z.string(),
        slotLabel: z.string().optional(),
        taskId: z.string().uuid().optional(),
        position: z.number().default(0),
      }),
    )
    .mutation(({ input }) => {
      const cal = getDemoStore().calendars.get(input.calendarId);
      if (!cal) throw new Error("NOT_FOUND");
      const slot = {
        calendarSlotId: randomUUID(),
        calendarId: input.calendarId,
        slotDate: input.slotDate,
        slotLabel: input.slotLabel ?? null,
        taskId: input.taskId ?? null,
        position: input.position,
      };
      cal.slots = [...cal.slots, slot];
      return slot;
    }),

  refApprove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const cal = store.calendars.get(input.id);
      if (!cal) throw new Error("NOT_FOUND");
      cal.refApprovalState = "approved";
      cal.state = "ref_approved";
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "calendars.refApprove",
        entityType: "calendar",
        entityId: cal.calendarId,
        before: null,
        after: { refApprovalState: "approved" },
        reason: null,
      });
      return cal;
    }),

  shoot: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        shootDate: z.string(),
        rescheduleEdge: z.boolean().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const cal = store.calendars.get(input.id);
      if (!cal) throw new Error("NOT_FOUND");

      const changing =
        cal.shootDate !== null && cal.shootDate !== input.shootDate;
      const currentLock = evaluateShootLock({
        shootDate: cal.shootDate,
        refApprovalState: cal.refApprovalState,
      });

      if (changing && currentLock.locked && !input.rescheduleEdge) {
        const result = {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          blockedBy: [
            {
              gate: "calendar.t48_shoot_lock",
              reason:
                currentLock.reason ??
                "T-48h shoot lock — late calendar/shoot changes blocked",
            },
          ],
          calendar: cal,
          shootLock: currentLock,
        };
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "calendars.shoot.blocked",
          entityType: "calendar",
          entityId: cal.calendarId,
          before: { shootDate: cal.shootDate },
          after: { attempted: input.shootDate },
          reason: result.blockedBy[0]?.reason ?? null,
        });
        return result;
      }

      if (changing && input.rescheduleEdge) {
        cal.state = "reschedule";
      }
      cal.shootDate = input.shootDate;

      const lock = evaluateShootLock({
        shootDate: cal.shootDate,
        refApprovalState: cal.refApprovalState,
      });
      if (lock.locked && cal.state !== "reschedule") {
        cal.state = "shoot_locked";
      }
      if (lock.escalateT24) {
        store.deliveryEscalations.unshift({
          id: randomUUID(),
          kind: "t24_shoot",
          calendarId: cal.calendarId,
          message:
            lock.reason ??
            "T-24h escalate — unapproved calendar → cancel/reschedule edge",
          createdAt: new Date().toISOString(),
        });
        store.pushHealth("t24_shoot_escalate", "warn", {
          calendarId: cal.calendarId,
        });
      }

      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "calendars.shoot",
        entityType: "calendar",
        entityId: cal.calendarId,
        before: null,
        after: { shootDate: cal.shootDate, state: cal.state },
        reason: input.rescheduleEdge ? "reschedule edge" : null,
      });

      return {
        ok: true as const,
        calendar: cal,
        shootLock: lock,
        escalations: store.deliveryEscalations.filter(
          (e) => e.calendarId === cal.calendarId,
        ),
      };
    }),

  finalApprove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) => {
      const cal = getDemoStore().calendars.get(input.id);
      if (!cal) throw new Error("NOT_FOUND");
      cal.finalApprovalState = "approved";
      cal.state = "final_approved";
      getDemoStore().appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "calendars.finalApprove",
        entityType: "calendar",
        entityId: cal.calendarId,
        before: null,
        after: { finalApprovalState: "approved" },
        reason: null,
      });
      return cal;
    }),

  evaluateLock: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => {
      const cal = getDemoStore().calendars.get(input.id);
      if (!cal) return null;
      return evaluateShootLock({
        shootDate: cal.shootDate,
        refApprovalState: cal.refApprovalState,
      });
    }),

  escalations: protectedProcedure.query(() =>
    getDemoStore().deliveryEscalations.slice(0, 20),
  ),
});

export const briefsRouter = router({
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getDemoStore().briefs.get(input.id) ?? null),

  createForTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        body: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const task = store.tasks.get(input.taskId);
      if (!task) throw new Error("NOT_FOUND");
      const dor = validateDor(input.body);
      const brief: DemoBrief = {
        briefId: randomUUID(),
        taskId: input.taskId,
        body: input.body,
        dorComplete: dor.dorComplete,
        missingRequiredCount: dor.missingRequiredCount,
        missing: [...dor.missing],
        lockedAt: null,
      };
      store.briefs.set(brief.briefId, brief);
      task.briefId = brief.briefId;
      task.status = "briefing";
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "briefs.createForTask",
        entityType: "brief",
        entityId: brief.briefId,
        before: null,
        after: { missingRequiredCount: brief.missingRequiredCount },
        reason: null,
      });
      return brief;
    }),

  updateBody: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        body: z.record(z.unknown()),
      }),
    )
    .mutation(({ input }) => {
      const brief = getDemoStore().briefs.get(input.id);
      if (!brief) throw new Error("NOT_FOUND");
      if (brief.lockedAt) throw new Error("BRIEF_LOCKED");
      const dor = validateDor(input.body);
      brief.body = input.body;
      brief.dorComplete = dor.dorComplete;
      brief.missingRequiredCount = dor.missingRequiredCount;
      brief.missing = [...dor.missing];
      return brief;
    }),

  validateDor: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => {
      const brief = getDemoStore().briefs.get(input.id);
      if (!brief) throw new Error("NOT_FOUND");
      const dor = validateDor(brief.body);
      brief.dorComplete = dor.dorComplete;
      brief.missingRequiredCount = dor.missingRequiredCount;
      brief.missing = [...dor.missing];
      return {
        missingRequiredCount: dor.missingRequiredCount,
        dorComplete: dor.dorComplete,
        missing: dor.missing,
        canLock: dor.canLock,
      };
    }),

  lock: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const brief = store.briefs.get(input.id);
      if (!brief) throw new Error("NOT_FOUND");
      const dor = validateDor(brief.body);
      brief.missingRequiredCount = dor.missingRequiredCount;
      brief.missing = [...dor.missing];
      brief.dorComplete = dor.dorComplete;
      const blocked = dorLockBlockedReason(dor);
      if (blocked) {
        return {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          status: 423 as const,
          reason: blocked,
          missingRequiredCount: dor.missingRequiredCount,
          missing: dor.missing,
        };
      }
      brief.lockedAt = new Date().toISOString();
      const task = store.tasks.get(brief.taskId);
      if (task) {
        task.status = "brief_ready";
        store.pushHealth("brief.dor_complete", "info", {
          briefId: brief.briefId,
          taskId: task.taskId,
        });
      }
      const seam = driveSeam("brief.lock", `brief.lock:${brief.briefId}`, {
        briefId: brief.briefId,
        taskId: brief.taskId,
        clientId: task?.clientId ?? null,
        actorEmployeeId: ctx.employeeId,
      });
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "briefs.lock",
        entityType: "brief",
        entityId: brief.briefId,
        before: null,
        after: {
          lockedAt: brief.lockedAt,
          taskStatus: "brief_ready",
          seamEventId: seam.event.eventId,
          seamDuplicate: seam.duplicate,
        },
        reason: null,
      });
      return {
        ok: true as const,
        taskStatus: "brief_ready" as const,
        brief,
        seam,
      };
    }),
});

export const tasksRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          clientId: z.string().uuid().optional(),
          status: z.string().optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      let rows = [...getDemoStore().tasks.values()];
      if (input?.clientId) {
        rows = rows.filter((t) => t.clientId === input.clientId);
      }
      if (input?.status) {
        rows = rows.filter((t) => t.status === input.status);
      }
      return rows;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getDemoStore().tasks.get(input.id) ?? null),

  create: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        calendarId: z.string().uuid().optional(),
        month: z.string().optional(),
        taskType: z.string().min(1),
        title: z.string().min(1).optional(),
        deadline: z.string().optional(),
        priority: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      if (!store.clients.has(input.clientId)) throw new Error("NOT_FOUND");
      const task: DemoTask = {
        taskId: randomUUID(),
        clientId: input.clientId,
        calendarId: input.calendarId ?? null,
        month: input.month ?? null,
        taskType: input.taskType,
        title: input.title ?? input.taskType,
        status: "backlog",
        situationalState: null,
        ownerEmployeeId: null,
        deadline: input.deadline ?? null,
        priority: input.priority ?? null,
        qcPassed: false,
        qcNotes: null,
        clientRevisionCount: 0,
        revisionBoundaryAck: false,
        briefId: null,
      };
      store.tasks.set(task.taskId, task);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "tasks.create",
        entityType: "task",
        entityId: task.taskId,
        before: null,
        after: { status: task.status },
        reason: null,
      });
      return task;
    }),

  assign: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        ownerEmployeeId: z.string().uuid(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const task = store.tasks.get(input.id);
      if (!task) throw new Error("NOT_FOUND");
      if (task.briefId) {
        const brief = store.briefs.get(task.briefId);
        if (brief && brief.missingRequiredCount > 2) {
          return {
            ok: false as const,
            code: "GATE_BLOCKED" as const,
            reason: "DoR incomplete — cannot assign until ≤2 missing",
            task,
          };
        }
      }
      task.ownerEmployeeId = input.ownerEmployeeId;
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "tasks.assign",
        entityType: "task",
        entityId: task.taskId,
        before: null,
        after: { ownerEmployeeId: input.ownerEmployeeId },
        reason: null,
      });
      return { ok: true as const, task };
    }),

  transition: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        to: z.string().min(1),
        from: z.string().optional(),
        payload: z.record(z.unknown()).optional(),
        overrideReason: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const task = getDemoStore().tasks.get(input.id);
      if (!task) throw new Error("NOT_FOUND");
      return applyTaskTransition(
        ctx,
        task,
        input.to,
        input.payload,
        input.overrideReason,
      );
    }),

  setSituational: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        situationalState: z.string().nullable(),
      }),
    )
    .mutation(({ input }) => {
      const task = getDemoStore().tasks.get(input.id);
      if (!task) throw new Error("NOT_FOUND");
      task.situationalState = input.situationalState;
      return task;
    }),

  qc: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(["pass", "fail", "waive"]),
        notes: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const task = store.tasks.get(input.id);
      if (!task) throw new Error("NOT_FOUND");
      const isCd =
        ctx.roles.includes("creative_director") ||
        ctx.roles.includes("partner") ||
        ctx.roles.includes("director");
      if (!isCd) {
        return {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          reason: "Only Creative Director / partner may QC",
        };
      }
      task.qcPassed = input.decision === "pass" || input.decision === "waive";
      task.qcNotes = input.notes ?? null;
      if (input.decision === "waive") {
        (task as DemoTask & { qcWaived?: boolean }).qcWaived = true;
      }
      let seam = null as ReturnType<typeof driveSeam> | null;
      if (task.qcPassed) {
        const asset = [...store.assets.values()].find(
          (a) => a.taskId === task.taskId,
        );
        seam = driveSeam(
          "creative.approved",
          `creative.approved:${task.taskId}`,
          {
            taskId: task.taskId,
            assetId: asset?.assetId ?? null,
            clientId: task.clientId,
            actorEmployeeId: ctx.employeeId,
          },
        );
      }
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "tasks.qc",
        entityType: "task",
        entityId: task.taskId,
        before: null,
        after: {
          decision: input.decision,
          qcPassed: task.qcPassed,
          seamEventId: seam?.event.eventId ?? null,
        },
        reason: input.notes ?? null,
      });
      return { ok: true as const, task, seam };
    }),
});

export const deliveryDashboardsRouter = router({
  capacity: protectedProcedure.query(() => {
    const tasks = [...getDemoStore().tasks.values()];
    const weeks = [0, 1, 2].map((offset) => {
      const start = new Date();
      start.setDate(start.getDate() + offset * 7);
      return {
        weekStart: start.toISOString().slice(0, 10),
        assigned: tasks.filter((t) => t.ownerEmployeeId).length,
        unassigned: tasks.filter((t) => !t.ownerEmployeeId).length,
        inProduction: tasks.filter((t) =>
          ["in_production", "internal_review", "qc"].includes(t.status),
        ).length,
      };
    });
    return { weeks };
  }),

  delivery: protectedProcedure.query(() => {
    const tasks = [...getDemoStore().tasks.values()];
    const columns = [
      "backlog",
      "briefing",
      "brief_ready",
      "in_production",
      "internal_review",
      "qc",
      "client_review",
      "revisions",
      "approved",
      "delivered",
    ] as const;
    const board = columns.map((status) => ({
      status,
      tasks: tasks.filter((t) => t.status === status),
    }));
    const bottleneck =
      board.reduce(
        (max, col) => (col.tasks.length > max.count ? { status: col.status, count: col.tasks.length } : max),
        { status: "none", count: 0 },
      );
    return {
      board,
      bottleneck,
      ratio:
        tasks.length === 0
          ? 0
          : Number((bottleneck.count / tasks.length).toFixed(2)),
    };
  }),
});

export const month1Router = router({
  get: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(({ input }) => getDemoStore().month1.get(input.clientId) ?? []),

  transition: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        toPhase: z.number().int().min(0).max(6),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const phases = store.month1.get(input.clientId);
      if (!phases) throw new Error("NOT_FOUND");
      const active = phases.find((p) => p.status === "active");
      if (!active) throw new Error("NO_ACTIVE_PHASE");
      if (input.toPhase !== active.phaseIndex + 1 && input.toPhase !== active.phaseIndex) {
        return {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          reason: `Month-1 gate: advance only to next phase (active P${active.phaseIndex})`,
        };
      }
      if (input.toPhase === active.phaseIndex + 1) {
        active.status = "done";
        const next = phases.find((p) => p.phaseIndex === input.toPhase);
        if (next) next.status = "active";
      }
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "clients.month1.transition",
        entityType: "client",
        entityId: input.clientId,
        before: null,
        after: { toPhase: input.toPhase },
        reason: null,
      });
      return { ok: true as const, phases };
    }),
});
