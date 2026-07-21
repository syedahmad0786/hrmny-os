import { z } from "zod";
import {
  bootstrapGateRegistry,
  transition,
  type ActorContext,
} from "@hrmny/gate";
import {
  createActivity,
  createCompany,
  createContact,
  createCrmTask,
  createDeal,
  createNote,
  crmBackendMode,
  crmHealth,
  getCompany,
  getContact,
  getDeal,
  listActivities,
  listCompanies,
  listContacts,
  listCrmTasks,
  listDeals,
  listNotes,
  moveDealStage,
  pipelineStages,
  updateCompany,
  updateContact,
  updateCrmTask,
  updateDeal,
} from "../crm/repository";
import { getDemoStore } from "../demo-store";
import { redactDealMargin } from "../crm/types";
import { protectedProcedure, publicProcedure, router } from "./trpc";

bootstrapGateRegistry();

function actorFromCtx(ctx: {
  employeeId: string | null;
  roles: string[];
  user: { permissions: string[] } | null;
}): ActorContext {
  return {
    employeeId: ctx.employeeId!,
    roles: ctx.roles,
    permissions: ctx.user?.permissions ?? [],
  };
}

const marketSchema = z.enum(["UAE", "KSA", "Both"]);
const leadLaneSchema = z.enum([
  "industry_scanning",
  "apollo_intent",
  "relationship_led",
  "tejari",
]);
const crmTaskStatusSchema = z.enum(["open", "in_progress", "done", "cancelled"]);
const activityTypeSchema = z.enum([
  "note",
  "call",
  "meeting",
  "email",
  "stage_change",
  "task",
  "outreach",
  "system",
]);

export const crmCompaniesRouter = router({
  list: protectedProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(({ input }) => listCompanies(input)),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getCompany(input.id)),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        sector: z.string().nullable().optional(),
        market: marketSchema.optional(),
        website: z.string().nullable().optional(),
        linkedinUrl: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(({ input }) => createCompany(input)),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        sector: z.string().nullable().optional(),
        market: marketSchema.nullable().optional(),
        website: z.string().nullable().optional(),
        linkedinUrl: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { id, ...patch } = input;
      return updateCompany(id, patch);
    }),
});

export const crmContactsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          companyId: z.string().uuid().optional(),
          search: z.string().optional(),
        })
        .optional(),
    )
    .query(({ input }) => listContacts(input)),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getContact(input.id)),
  create: protectedProcedure
    .input(
      z.object({
        companyId: z.string().uuid().nullable().optional(),
        firstName: z.string().min(1),
        lastName: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        linkedinUrl: z.string().nullable().optional(),
        isPrimary: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => createContact(input)),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        companyId: z.string().uuid().nullable().optional(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        linkedinUrl: z.string().nullable().optional(),
        emailVerified: z.boolean().optional(),
        isPrimary: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { id, ...patch } = input;
      return updateContact(id, patch);
    }),
});

export const crmDealsRouter = router({
  stages: publicProcedure.query(() => pipelineStages()),
  list: protectedProcedure
    .input(
      z
        .object({
          stage: z.string().optional(),
          companyId: z.string().uuid().optional(),
          lane: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const rows = await listDeals(input);
      return rows.map((d) => redactDealMargin(d, ctx.canViewMargin));
    }),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const row = await getDeal(input.id);
      if (!row) return null;
      return redactDealMargin(row, ctx.canViewMargin);
    }),
  create: protectedProcedure
    .input(
      z.object({
        companyName: z.string().min(1),
        companyId: z.string().uuid().nullable().optional(),
        primaryContactId: z.string().uuid().nullable().optional(),
        sector: z.string().nullable().optional(),
        leadSourceLane: leadLaneSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await createDeal({
        ...input,
        ownerEmployeeId: ctx.employeeId,
      });
      await createActivity({
        type: "system",
        subject: "Deal created",
        dealId: row.dealId,
        companyId: row.companyId,
        actorEmployeeId: ctx.employeeId,
      });
      return redactDealMargin(row, ctx.canViewMargin);
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        companyName: z.string().min(1).optional(),
        companyId: z.string().uuid().nullable().optional(),
        primaryContactId: z.string().uuid().nullable().optional(),
        sector: z.string().nullable().optional(),
        ownerEmployeeId: z.string().uuid().nullable().optional(),
        buafBudget: z.boolean().nullable().optional(),
        buafUrgency: z.boolean().nullable().optional(),
        buafAccess: z.boolean().nullable().optional(),
        buafFit: z.boolean().nullable().optional(),
        buafTemperature: z
          .enum(["hot", "warm", "cool", "cold"])
          .nullable()
          .optional(),
        emailVerified: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const row = await updateDeal(id, patch);
      if (!row) return null;
      return redactDealMargin(row, ctx.canViewMargin);
    }),
  moveStage: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        to: z.string().min(1),
        overrideReason: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getDeal(input.id);
      if (!existing) return { ok: false as const, reason: "Deal not found" };

      const store = getDemoStore();
      const gateResult = await transition(
        actorFromCtx(ctx),
        {
          entityType: "deal",
          entityId: existing.dealId,
          state: existing.stage,
          data: { ...existing },
        },
        {
          to: input.to,
          from: existing.stage,
          overrideReason: input.overrideReason,
        },
        {
          authorize: async (a) =>
            a.roles.some((r) =>
              ["partner", "am", "finance", "director"].includes(r),
            ),
          apply: async ({ request }) => {
            const moved = await moveDealStage({
              dealId: existing.dealId,
              to: request.to,
              actorEmployeeId: ctx.employeeId,
            });
            if (!moved.ok) {
              throw new Error(moved.reason);
            }
            return {
              entityType: "deal",
              entityId: moved.deal.dealId,
              state: moved.deal.stage,
              data: { ...moved.deal },
            };
          },
          audit: async (event) => {
            const row = store.appendAudit({
              actorEmployeeId: event.actorEmployeeId,
              action: event.action,
              entityType: event.entityType,
              entityId: event.entityId,
              before: event.before,
              after: event.after,
              reason: event.reason ?? null,
            });
            return { auditId: row.auditEventId };
          },
          emit: async (event) => {
            store.pushHealth("crm_deal_transition", "info", event.payload);
          },
        },
      );

      if (!gateResult.ok) {
        return {
          ok: false as const,
          reason: gateResult.code,
          code: gateResult.code,
          blockedBy: gateResult.blockedBy,
          auditId: gateResult.auditId,
        };
      }

      const deal = await getDeal(input.id);
      if (!deal) return { ok: false as const, reason: "Deal missing after apply" };
      return {
        ok: true as const,
        deal: redactDealMargin(deal, ctx.canViewMargin),
        auditId: gateResult.auditId,
      };
    }),
});

export const crmActivitiesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid().optional(),
          companyId: z.string().uuid().optional(),
          contactId: z.string().uuid().optional(),
          limit: z.number().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ input }) => listActivities(input)),
  create: protectedProcedure
    .input(
      z.object({
        type: activityTypeSchema,
        subject: z.string().nullable().optional(),
        body: z.string().nullable().optional(),
        companyId: z.string().uuid().nullable().optional(),
        contactId: z.string().uuid().nullable().optional(),
        dealId: z.string().uuid().nullable().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      createActivity({
        ...input,
        actorEmployeeId: ctx.employeeId,
      }),
    ),
});

export const crmNotesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid().optional(),
          companyId: z.string().uuid().optional(),
          contactId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(({ input }) => listNotes(input)),
  create: protectedProcedure
    .input(
      z.object({
        body: z.string().min(1),
        companyId: z.string().uuid().nullable().optional(),
        contactId: z.string().uuid().nullable().optional(),
        dealId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      createNote({
        ...input,
        authorEmployeeId: ctx.employeeId,
      }),
    ),
});

export const crmTasksRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid().optional(),
          companyId: z.string().uuid().optional(),
          status: crmTaskStatusSchema.optional(),
          ownerEmployeeId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(({ input }) => listCrmTasks(input)),
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        dueDate: z.string().nullable().optional(),
        companyId: z.string().uuid().nullable().optional(),
        contactId: z.string().uuid().nullable().optional(),
        dealId: z.string().uuid().nullable().optional(),
        ownerEmployeeId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      createCrmTask({
        ...input,
        ownerEmployeeId: input.ownerEmployeeId ?? ctx.employeeId,
      }),
    ),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        status: crmTaskStatusSchema.optional(),
        dueDate: z.string().nullable().optional(),
        ownerEmployeeId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { id, ...patch } = input;
      return updateCrmTask(id, patch);
    }),
});

/** Durable CRM surface — Postgres when DATABASE_URL set, else seeded memory. */
export const crmRouter = router({
  health: publicProcedure.query(async () => ({
    ...(await crmHealth()),
    mode: crmBackendMode(),
  })),
  stages: publicProcedure.query(() => pipelineStages()),
  companies: crmCompaniesRouter,
  contacts: crmContactsRouter,
  deals: crmDealsRouter,
  activities: crmActivitiesRouter,
  notes: crmNotesRouter,
  tasks: crmTasksRouter,
});
