import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  bootstrapGateRegistry,
  transition,
  type ActorContext,
  type EntitySnapshot,
} from "@hrmny/gate";
import { getDemoStore } from "../demo-store";
import {
  protectedProcedure,
  publicProcedure,
  requireMarginView,
  router,
} from "./trpc";

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

/** Partners + finance only — AM gets FORBIDDEN (network-tab safe). */
export const marginDashboardsRouter = router({
  list: protectedProcedure.use(requireMarginView()).query(({ ctx }) => {
    const store = getDemoStore();
    const rows = store.computeClientMargins();
    store.appendAudit({
      actorEmployeeId: ctx.employeeId!,
      action: "dashboards.margin.list",
      entityType: "v_client_margin",
      entityId: "all",
      before: null,
      after: { count: rows.length },
      reason: null,
    });
    return {
      rows,
      overServicingCount: rows.filter((r) => r.overServicing).length,
    };
  }),

  get: protectedProcedure
    .use(requireMarginView())
    .input(z.object({ clientId: z.string().uuid() }))
    .query(({ input }) => {
      const row = getDemoStore()
        .computeClientMargins()
        .find((r) => r.clientId === input.clientId);
      return row ?? null;
    }),
});

export const vatRouter = router({
  docs: router({
    list: protectedProcedure
      .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }))
      .query(({ input }) => {
        const docs = [...getDemoStore().vatDocs.values()];
        if (!input.period) return docs;
        return docs.filter((d) => d.period === input.period);
      }),

    markRead: protectedProcedure
      .input(z.object({ docId: z.string().min(1) }))
      .mutation(({ input, ctx }) => {
        const store = getDemoStore();
        const doc = store.markVatDocRead(input.docId);
        if (!doc) throw new Error("NOT_FOUND");
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "vat.docs.markRead",
          entityType: "vat_doc",
          entityId: doc.docId,
          before: { unread: true },
          after: { unread: false },
          reason: null,
        });
        return doc;
      }),
  }),

  close: protectedProcedure
    .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }))
    .mutation(async ({ input, ctx }) => {
      const store = getDemoStore();
      if (store.vatCloses.has(input.period)) {
        return {
          closed: true as const,
          period: input.period,
          unreadDocs: [] as string[],
          alreadyClosed: true as const,
        };
      }
      const unreadDocIds = store.unreadVatDocIds(input.period);
      const entity: EntitySnapshot = {
        entityType: "vat_period",
        entityId: input.period,
        state: "open",
        data: { unreadDocIds },
      };
      const result = await transition(
        actorFromCtx(ctx),
        entity,
        { to: "closed" },
        {
          authorize: async (a) =>
            a.roles.some((r) => ["finance", "partner", "director"].includes(r)),
          apply: async () => ({ ...entity, state: "closed" }),
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
        },
      );
      if (!result.ok) {
        return {
          closed: false as const,
          period: input.period,
          unreadDocs: unreadDocIds,
          result,
        };
      }
      store.vatCloses.set(input.period, {
        period: input.period,
        closedAt: new Date().toISOString(),
      });
      return {
        closed: true as const,
        period: input.period,
        unreadDocs: [] as string[],
        result,
      };
    }),

  return: router({
    prepare: protectedProcedure
      .input(z.object({ quarter: z.string().min(4) }))
      .mutation(({ input, ctx }) => {
        const store = getDemoStore();
        const returnId = randomUUID();
        const issued = [...store.invoices.values()].filter(
          (i) => i.status === "issued" || i.status === "paid",
        );
        const outputVat = issued.reduce(
          (s, i) => s + Number(i.vatAmount),
          0,
        );
        const row = {
          returnId,
          quarter: input.quarter,
          status: "prepared" as const,
          boxImpacts: {
            box1_standard_rated: outputVat.toFixed(2),
            box4_input_vat: "0.00",
            box5_net: outputVat.toFixed(2),
          },
          preparedByEmployeeId: ctx.employeeId,
          signedByEmployeeId: null as string | null,
          createdAt: new Date().toISOString(),
        };
        store.vatReturns.set(returnId, row);
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "vat.return.prepare",
          entityType: "vat_return",
          entityId: returnId,
          before: null,
          after: { ...row },
          reason: null,
        });
        return row;
      }),

    sign: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ input, ctx }) => {
        const store = getDemoStore();
        const row = store.vatReturns.get(input.id);
        if (!row) throw new Error("NOT_FOUND");
        const isDirector = ctx.roles.some((r) =>
          ["director", "partner"].includes(r),
        );
        if (!isDirector) {
          throw new Error("FORBIDDEN: only Director/partner may sign VAT return");
        }
        row.status = "signed";
        row.signedByEmployeeId = ctx.employeeId;
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "vat.return.sign",
          entityType: "vat_return",
          entityId: row.returnId,
          before: { status: "prepared" },
          after: { ...row },
          reason: null,
        });
        return { signed: true as const, return: row };
      }),
  }),
});

export const m5DemoRouter = router({
  reset: publicProcedure.mutation(() => {
    getDemoStore().resetM5Demo();
    return {
      ok: true as const,
      clientId: [...getDemoStore().clients.keys()][0] ?? null,
      bayzatMirror: getDemoStore().bayzatMirror.length,
    };
  }),
});
