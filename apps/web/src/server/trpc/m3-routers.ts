import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createApolloLive, createHunterLive } from "@hrmny/integrations";
import {
  bootstrapGateRegistry,
  computeQuoteMetrics,
  discountAuthorityTier,
  scoreBuaf,
  transition,
  type ActorContext,
  type EntitySnapshot,
} from "@hrmny/gate";
import {
  DEMO_DEAL_ID,
  getDemoStore,
  type DemoDeal,
  type DemoQuoteLine,
} from "../demo-store";
import {
  protectedProcedure,
  publicProcedure,
  requireMarginView,
  router,
} from "./trpc";
import { month1Router } from "./m4-routers";
import { getEmployeeIntegrationSecret } from "./connections-router";

bootstrapGateRegistry();

async function apolloFor(employeeId: string) {
  const apiKey = await getEmployeeIntegrationSecret(employeeId, "apollo");
  return {
    client: apiKey
      ? createApolloLive({ mode: "live", apiKey })
      : getDemoStore().apollo,
    live: Boolean(apiKey),
  };
}

async function hunterFor(employeeId: string) {
  const apiKey = await getEmployeeIntegrationSecret(employeeId, "hunter");
  return {
    client: apiKey
      ? createHunterLive({ mode: "live", apiKey })
      : getDemoStore().hunter,
    live: Boolean(apiKey),
  };
}

const leadSourceLaneSchema = z.enum([
  "industry_scanning",
  "apollo_intent",
  "relationship_led",
  "tejari",
  "inbound",
]);

const quoteLineSchema = z.object({
  label: z.string().min(1),
  unitSell: z.number().nonnegative(),
  unitCost: z.number().nonnegative(),
  qty: z.number().positive().default(1),
  isVendor: z.boolean().default(false),
});

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

function dealEntity(deal: DemoDeal): EntitySnapshot {
  return {
    entityType: "deal",
    entityId: deal.dealId,
    state: deal.stage,
    data: { ...deal },
  };
}

async function runDealTransition(
  deal: DemoDeal,
  input: {
    to: string;
    from?: string;
    payload?: Record<string, unknown>;
    overrideReason?: string | null;
  },
  ctx: {
    employeeId: string | null;
    roles: string[];
    user: { permissions: string[] } | null;
  },
) {
  const store = getDemoStore();
  return transition(actorFromCtx(ctx), dealEntity(deal), input, {
    authorize: async (a) =>
      a.roles.some((r) => ["partner", "am", "finance", "director"].includes(r)),
    apply: async ({ request }) => {
      const next = {
        ...deal,
        stage: request.to,
        ...(request.payload as Partial<DemoDeal>),
      };
      store.deals.set(deal.dealId, next);
      return {
        entityType: "deal",
        entityId: deal.dealId,
        state: request.to,
        data: { ...next },
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
      store.pushHealth("deal_transition", "info", event.payload);
    },
  });
}

export const dealsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          stage: z.string().optional(),
          lane: z.string().optional(),
          temperature: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      let rows = getDemoStore().listDealsForRoles(ctx.roles);
      if (input?.stage) {
        rows = rows.filter((d) => d.stage === input.stage);
      }
      if (input?.lane) {
        rows = rows.filter((d) => d.leadSourceLane === input.lane);
      }
      if (input?.temperature) {
        rows = rows.filter((d) => d.buafTemperature === input.temperature);
      }
      return rows;
    }),

  create: protectedProcedure
    .input(
      z.object({
        companyName: z.string().min(1),
        sector: z.string().optional(),
        leadSourceLane: leadSourceLaneSchema.default("relationship_led"),
        contactEmail: z.string().email().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const deal: DemoDeal = {
        dealId: randomUUID(),
        companyName: input.companyName,
        sector: input.sector ?? null,
        stage: "discover",
        closeOutcome: null,
        lostReason: null,
        leadSourceLane: input.leadSourceLane,
        buafBudget: false,
        buafUrgency: false,
        buafAccess: false,
        buafFit: false,
        buafTemperature: null,
        noGoFlags: [],
        emailVerified: false,
        contactEmail: input.contactEmail ?? null,
        voiceCheckPassed: false,
        quoteValue: "0.00",
        internalCost: "0.00",
        marginPct: "0.00",
        discountPct: "0.00",
        discountApprovalTier: null,
        vendorHandlingFeePct: "20.00",
        quoteLines: [],
        ownerEmployeeId: ctx.employeeId,
        enrichment: null,
        commercialMode: "project",
      };
      store.deals.set(deal.dealId, deal);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "deals.create",
        entityType: "deal",
        entityId: deal.dealId,
        before: null,
        after: { companyName: deal.companyName, stage: deal.stage },
        reason: null,
      });
      return store.getDealForRoles(deal.dealId, ctx.roles);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input, ctx }) =>
      getDemoStore().getDealForRoles(input.id, ctx.roles),
    ),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        companyName: z.string().optional(),
        sector: z.string().nullable().optional(),
        contactEmail: z.string().email().nullable().optional(),
        commercialMode: z
          .enum(["project", "retainer", "lean_package"])
          .optional(),
        vendorHandlingFeePct: z.number().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.id);
      if (!deal) return null;
      const next: DemoDeal = {
        ...deal,
        companyName: input.companyName ?? deal.companyName,
        sector: input.sector === undefined ? deal.sector : input.sector,
        contactEmail:
          input.contactEmail === undefined
            ? deal.contactEmail
            : input.contactEmail,
        commercialMode: input.commercialMode ?? deal.commercialMode,
        vendorHandlingFeePct:
          input.vendorHandlingFeePct !== undefined
            ? input.vendorHandlingFeePct.toFixed(2)
            : deal.vendorHandlingFeePct,
      };
      store.deals.set(deal.dealId, next);
      return store.getDealForRoles(deal.dealId, ctx.roles);
    }),

  margin: protectedProcedure
    .use(requireMarginView())
    .input(z.object({ id: z.string().uuid() }).optional())
    .query(({ input, ctx }) => {
      const deal =
        getDemoStore().deals.get(input?.id ?? DEMO_DEAL_ID) ??
        getDemoStore().deal;
      return {
        dealId: deal.dealId,
        marginPct: deal.marginPct,
        internalCost: deal.internalCost,
        quoteValue: deal.quoteValue,
        viewerRoles: ctx.roles,
      };
    }),

  resetDemo: protectedProcedure.mutation(() => {
    getDemoStore().resetM3Demo();
    return getDemoStore().deal;
  }),

  buaf: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        budget: z.boolean(),
        urgency: z.boolean(),
        access: z.boolean(),
        fit: z.boolean(),
        noGoFlags: z.array(z.string()).default([]),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.id);
      if (!deal) throw new Error("NOT_FOUND");
      const scored = scoreBuaf({
        budget: input.budget,
        urgency: input.urgency,
        access: input.access,
        fit: input.fit,
      });
      const next: DemoDeal = {
        ...deal,
        buafBudget: input.budget,
        buafUrgency: input.urgency,
        buafAccess: input.access,
        buafFit: input.fit,
        buafTemperature: scored.temperature,
        noGoFlags: input.noGoFlags,
      };
      store.deals.set(deal.dealId, next);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "deals.buaf",
        entityType: "deal",
        entityId: deal.dealId,
        before: null,
        after: { temperature: scored.temperature, hot: scored.hot },
        reason: null,
      });
      return {
        temperature: scored.temperature,
        hot: scored.hot,
        score: scored.score,
      };
    }),

  verifyEmail: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        email: z.string().email(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.id);
      if (!deal) throw new Error("NOT_FOUND");

      // Apollo → Hunter waterfall
      const apollo = await apolloFor(ctx.employeeId!);
      const apolloPerson = await apollo.client.enrichPerson(input.email);
      const apolloOk =
        apolloPerson &&
        (apolloPerson.emailStatus === "verified" ||
          apolloPerson.source === "apollo_mock");
      let provider: "apollo" | "hunter" = "apollo";
      let emailVerified = Boolean(apolloOk);
      let liveProviders = apollo.live;
      let verdict = apolloOk
        ? `apollo-verified:${input.email}`
        : `apollo-miss:${input.email}`;

      if (!emailVerified) {
        const hunter = await hunterFor(ctx.employeeId!);
        liveProviders = liveProviders && hunter.live;
        const result = await hunter.client.verifyEmail(input.email);
        provider = "hunter";
        emailVerified = result.emailVerified;
        verdict = result.verdict;
      }

      const next: DemoDeal = {
        ...deal,
        contactEmail: input.email,
        emailVerified,
        enrichment: {
          ...(deal.enrichment ?? {}),
          apollo: apolloPerson,
          verifyProvider: provider,
          verdict,
          mockWaiver: liveProviders
            ? null
            : "mock adapters used — connect Apollo/Hunter in Settings",
        },
      };
      store.deals.set(deal.dealId, next);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "deals.verifyEmail",
        entityType: "deal",
        entityId: deal.dealId,
        before: { emailVerified: deal.emailVerified },
        after: { emailVerified, provider, verdict },
        reason: null,
      });
      return { emailVerified, provider, verdict };
    }),

  voiceCheck: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        copy: z.string().min(1),
        register: z.enum(["cold-intro", "client-warm"]).default("cold-intro"),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.id);
      if (!deal) throw new Error("NOT_FOUND");
      const violations: string[] = [];
      if (/guaranteed results/i.test(input.copy)) {
        violations.push("no-guarantee-claims");
      }
      if (input.copy.length < 40) {
        violations.push("too-short");
      }
      const pass = violations.length === 0;
      store.deals.set(deal.dealId, { ...deal, voiceCheckPassed: pass });
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "deals.voiceCheck",
        entityType: "deal",
        entityId: deal.dealId,
        before: null,
        after: { pass, register: input.register, violations },
        reason: null,
      });
      return { pass, violations };
    }),

  transition: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid().default(DEMO_DEAL_ID),
        to: z.string().min(1),
        from: z.string().optional(),
        payload: z.record(z.unknown()).optional(),
        overrideReason: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.id);
      if (!deal) {
        return {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          blockedBy: [{ gate: "not_found", reason: "Deal not found" }],
        };
      }
      const result = await runDealTransition(deal, input, ctx);
      if (!result.ok) {
        store.pushHealth("gate_blocked", "warn", {
          code: result.code,
          blockedBy: result.blockedBy,
        });
      }
      return result;
    }),

  close: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        outcome: z.enum(["won", "lost", "postponed_on_hold"]),
        lostReason: z.string().optional(),
        overrideReason: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.id);
      if (!deal) {
        return {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          blockedBy: [{ gate: "not_found", reason: "Deal not found" }],
        };
      }
      if (input.outcome === "lost" && !input.lostReason) {
        return {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          blockedBy: [
            {
              gate: "deal.lost_reason",
              reason: "lostReason required when lost",
            },
          ],
        };
      }
      // Move to close if not already there
      let current = deal;
      if (current.stage === "price_cost") {
        const toClose = await runDealTransition(
          current,
          {
            to: "close",
            overrideReason: input.overrideReason,
            payload: {
              closeOutcome: input.outcome,
              lostReason: input.lostReason ?? null,
            },
          },
          ctx,
        );
        if (!toClose.ok) return toClose;
        current = store.deals.get(input.id)!;
      }
      store.deals.set(input.id, {
        ...current,
        closeOutcome: input.outcome,
        lostReason: input.lostReason ?? null,
        stage: current.stage === "price_cost" ? "close" : current.stage,
      });
      const updated = store.deals.get(input.id)!;
      if (updated.stage !== "close") {
        // Force stage close for won path when already past price_cost in demos
        if (
          ["propose", "scope", "engage", "qualify", "discover"].includes(
            updated.stage,
          )
        ) {
          return {
            ok: false as const,
            code: "GATE_BLOCKED" as const,
            blockedBy: [
              {
                gate: "deal.close_stage",
                reason: `Deal must be in price_cost or close (now ${updated.stage})`,
              },
            ],
          };
        }
      }
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "deals.close",
        entityType: "deal",
        entityId: input.id,
        before: { stage: deal.stage },
        after: { stage: "close", closeOutcome: input.outcome },
        reason: input.lostReason ?? null,
      });
      return {
        ok: true as const,
        newState: "close",
        auditId: store.audits[0]!.auditEventId,
      };
    }),

  quote: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        lines: z.array(quoteLineSchema).min(1),
        commercialMode: z
          .enum(["project", "retainer", "lean_package"])
          .optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.id);
      if (!deal) throw new Error("NOT_FOUND");
      const metrics = computeQuoteMetrics(input.lines);
      const lines: DemoQuoteLine[] = input.lines.map((l) => ({
        label: l.label,
        unitSell: l.unitSell,
        unitCost: l.unitCost,
        qty: l.qty,
        isVendor: l.isVendor,
      }));
      const next: DemoDeal = {
        ...deal,
        quoteLines: lines,
        quoteValue: metrics.quoteValue.toFixed(2),
        internalCost: metrics.internalCost.toFixed(2),
        marginPct: metrics.marginPct.toFixed(2),
        commercialMode: input.commercialMode ?? deal.commercialMode,
        vendorHandlingFeePct: "20.00",
      };
      store.deals.set(deal.dealId, next);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "deals.quote",
        entityType: "deal",
        entityId: deal.dealId,
        before: null,
        after: {
          quoteValue: next.quoteValue,
          marginPct: next.marginPct,
          vendorFeeTotal: metrics.vendorFeeTotal,
        },
        reason: null,
      });
      return {
        quoteValue: next.quoteValue,
        internalCost: next.internalCost,
        marginPct: next.marginPct,
        vendorFeeTotal: metrics.vendorFeeTotal.toFixed(2),
        vatAmount: metrics.vatAmount.toFixed(2),
        lines,
        floorPct: 25,
        targetPct: 40,
      };
    }),

  discount: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        discountPct: z.number().min(0).max(100),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.id);
      if (!deal) throw new Error("NOT_FOUND");
      const tier = discountAuthorityTier(input.discountPct);
      const next: DemoDeal = {
        ...deal,
        discountPct: input.discountPct.toFixed(2),
        discountApprovalTier: tier,
      };
      store.deals.set(deal.dealId, next);
      const escalatedTo =
        tier === "partner" && !ctx.roles.includes("partner")
          ? "partner"
          : tier === "md" &&
              !ctx.roles.some((r) => ["md", "director", "partner"].includes(r))
            ? "md"
            : undefined;
      return { approvalTier: tier, escalatedTo, discountPct: next.discountPct };
    }),

  handoverPack: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.id);
      if (!deal) throw new Error("NOT_FOUND");

      if (deal.stage === "close" && deal.closeOutcome === "won") {
        const moved = await runDealTransition(
          deal,
          { to: "handover_pack" },
          ctx,
        );
        if (!moved.ok) return { ok: false as const, result: moved };
      } else if (deal.stage !== "handover_pack") {
        return {
          ok: false as const,
          result: {
            ok: false as const,
            code: "GATE_BLOCKED" as const,
            blockedBy: [
              {
                gate: "deal.handover",
                reason: "Deal must be close/won before Handover Pack",
              },
            ],
          },
        };
      }

      const wonDeal = store.deals.get(input.id)!;
      const existing = [...store.clients.values()].find(
        (c) => c.dealId === wonDeal.dealId,
      );
      const client = existing ?? store.createClientFromWonDeal(wonDeal);

      const fired: string[] = ["client.create", "onboarding.seed"];
      let xeroInvoiceId: string | null = null;
      try {
        const posted = await store.xero.createInvoice({
          invoiceId: randomUUID(),
          contactName: client.name,
          amount: client.contractValue,
          vatAmount: (Number(client.contractValue) * 0.05).toFixed(2),
          currency: "AED",
          reference: `Handover ${wonDeal.dealId.slice(0, 8)}`,
          sourceAttached: { seam: "deal.won", dealId: wonDeal.dealId },
        });
        xeroInvoiceId = posted.xeroInvoiceId;
        fired.push("invoice.draft_xero");
      } catch {
        fired.push("invoice.skipped");
      }

      const pack = {
        packId: randomUUID(),
        dealId: wonDeal.dealId,
        clientId: client.clientId,
        fired,
        createdAt: new Date().toISOString(),
        xeroInvoiceId,
      };
      store.handoverPacks.set(pack.packId, pack);
      store.pushHealth("deal.won", "info", {
        dealId: wonDeal.dealId,
        clientId: client.clientId,
        fired,
      });
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "deals.handoverPack",
        entityType: "deal",
        entityId: wonDeal.dealId,
        before: null,
        after: pack,
        reason: null,
      });
      return {
        ok: true as const,
        pack,
        client,
        onboarding: store.onboarding.get(client.clientId) ?? [],
        fired,
      };
    }),
});

export const scopesRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        dealId: z.string().uuid().optional(),
        title: z.string().min(1),
        value: z.number().nonnegative(),
        periodStart: z.string(),
        periodEnd: z.string().optional(),
        terms: z.string().optional(),
        lines: z.array(quoteLineSchema).default([]),
      }),
    )
    .mutation(({ input }) => {
      const store = getDemoStore();
      const scope = {
        scopeId: randomUUID(),
        clientId: input.clientId,
        dealId: input.dealId ?? null,
        title: input.title,
        value: input.value.toFixed(2),
        terms: input.terms ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd ?? null,
        status: "draft",
        marginAtSalePct: null as string | null,
        lines: input.lines.map((l) => ({
          label: l.label,
          unitSell: l.unitSell,
          unitCost: l.unitCost,
          qty: l.qty,
          isVendor: l.isVendor,
        })),
      };
      store.scopes.set(scope.scopeId, scope);
      return scope;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getDemoStore().scopes.get(input.id) ?? null),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().optional(),
        value: z.number().optional(),
        status: z.string().optional(),
        terms: z.string().nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const store = getDemoStore();
      const scope = store.scopes.get(input.id);
      if (!scope) return null;
      const next = {
        ...scope,
        title: input.title ?? scope.title,
        value: input.value !== undefined ? input.value.toFixed(2) : scope.value,
        status: input.status ?? scope.status,
        terms: input.terms === undefined ? scope.terms : input.terms,
      };
      store.scopes.set(scope.scopeId, next);
      return next;
    }),

  listByClient: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .query(({ input }) =>
      [...getDemoStore().scopes.values()].filter(
        (s) => s.clientId === input.clientId,
      ),
    ),
});

export const clientsRouter = router({
  month1: month1Router,
  list: protectedProcedure
    .input(
      z
        .object({
          lifecycle: z.string().optional(),
          market: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      let rows = [...getDemoStore().clients.values()];
      if (input?.lifecycle) {
        rows = rows.filter((c) => c.lifecycleStatus === input.lifecycle);
      }
      if (input?.market) {
        rows = rows.filter((c) => c.market === input.market);
      }
      return rows.map((c) =>
        ctx.canViewMargin
          ? c
          : { ...c, fee: undefined, contractValue: c.contractValue },
      );
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input, ctx }) => {
      const c = getDemoStore().clients.get(input.id);
      if (!c) return null;
      if (ctx.canViewMargin) return c;
      const { fee: _fee, ...rest } = c;
      return rest;
    }),

  create: protectedProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        name: z.string().min(1),
        market: z.string().default("UAE"),
        engagementType: z.string().default("project"),
        contractValue: z.string().default("0"),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const deal = store.deals.get(input.dealId);
      if (!deal) throw new Error("NOT_FOUND");
      const client = store.createClientFromWonDeal({
        ...deal,
        companyName: input.name,
        quoteValue: input.contractValue,
        commercialMode: input.engagementType as DemoDeal["commercialMode"],
      });
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "clients.create",
        entityType: "client",
        entityId: client.clientId,
        before: null,
        after: { name: client.name, dealId: client.dealId },
        reason: null,
      });
      return client;
    }),

  immersion: router({
    upsert: protectedProcedure
      .input(
        z.object({
          clientId: z.string().uuid(),
          swot: z.record(z.unknown()).optional(),
          usp: z.string().optional(),
          audience: z.string().optional(),
          socialAccounts: z.record(z.unknown()).optional(),
          competitors: z.array(z.unknown()).optional(),
          objectivePriority: z.string().optional(),
          brandAssets: z.record(z.unknown()).optional(),
          approvers: z.record(z.unknown()).optional(),
          complete: z.boolean().default(false),
        }),
      )
      .mutation(({ input, ctx }) => {
        const store = getDemoStore();
        if (!store.clients.has(input.clientId)) throw new Error("NOT_FOUND");
        const existing = [...store.immersions.values()].find(
          (i) => i.clientId === input.clientId,
        );
        const immersion = {
          immersionId: existing?.immersionId ?? randomUUID(),
          clientId: input.clientId,
          swot: input.swot ?? existing?.swot ?? null,
          usp: input.usp ?? existing?.usp ?? null,
          audience: input.audience ?? existing?.audience ?? null,
          socialAccounts:
            input.socialAccounts ?? existing?.socialAccounts ?? null,
          competitors: input.competitors ?? existing?.competitors ?? null,
          objectivePriority:
            input.objectivePriority ?? existing?.objectivePriority ?? null,
          brandAssets: input.brandAssets ?? existing?.brandAssets ?? null,
          approvers: input.approvers ?? existing?.approvers ?? null,
          completedAt: input.complete
            ? new Date().toISOString()
            : (existing?.completedAt ?? null),
        };
        store.immersions.set(immersion.immersionId, immersion);
        if (input.complete) {
          store.pushHealth("immersion.completed", "info", {
            clientId: input.clientId,
            immersionId: immersion.immersionId,
          });
        }
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "clients.immersion.upsert",
          entityType: "immersion",
          entityId: immersion.immersionId,
          before: null,
          after: { completedAt: immersion.completedAt },
          reason: null,
        });
        return immersion;
      }),

    get: protectedProcedure
      .input(z.object({ clientId: z.string().uuid() }))
      .query(({ input }) =>
        [...getDemoStore().immersions.values()].filter(
          (i) => i.clientId === input.clientId,
        ),
      ),
  }),

  onboarding: router({
    get: protectedProcedure
      .input(z.object({ clientId: z.string().uuid() }))
      .query(
        ({ input }) => getDemoStore().onboarding.get(input.clientId) ?? [],
      ),

    signoff: protectedProcedure
      .input(
        z.object({
          clientId: z.string().uuid(),
          phaseIndex: z.number().int().min(0).max(6),
          signoffType: z.string().default("phase"),
        }),
      )
      .mutation(({ input, ctx }) => {
        const store = getDemoStore();
        const phases = store.onboarding.get(input.clientId);
        if (!phases) throw new Error("NOT_FOUND");
        const phase = phases.find((p) => p.phaseIndex === input.phaseIndex);
        if (!phase) throw new Error("NOT_FOUND");
        phase.status = "signed_off";
        phase.signedOffAt = new Date().toISOString();
        phase.steps = phase.steps.map((s) => ({ ...s, done: true }));
        const next = phases.find((p) => p.phaseIndex === input.phaseIndex + 1);
        let advanced = false;
        if (next) {
          next.status = "active";
          advanced = true;
        }
        store.onboarding.set(input.clientId, [...phases]);
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "clients.onboarding.signoff",
          entityType: "onboarding_phase",
          entityId: phase.phaseId,
          before: null,
          after: {
            phaseIndex: input.phaseIndex,
            advanced,
            signoffType: input.signoffType,
          },
          reason: null,
        });
        return { advanced, phases: store.onboarding.get(input.clientId) };
      }),
  }),
});

export const outreachRouter = router({
  queue: router({
    list: protectedProcedure
      .input(
        z
          .object({
            channel: z.enum(["gmail", "linkedin"]).optional(),
            status: z.string().optional(),
          })
          .optional(),
      )
      .query(({ input }) => {
        let rows = [...getDemoStore().approvalQueue.values()];
        if (input?.channel) {
          rows = rows.filter((r) => r.channel === input.channel);
        }
        if (input?.status) {
          rows = rows.filter((r) => r.status === input.status);
        }
        return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }),

    draft: protectedProcedure
      .input(
        z.object({
          dealId: z.string().uuid(),
          channel: z.enum(["gmail", "linkedin"]).default("gmail"),
          toEmail: z.string().email(),
          subject: z.string().min(1),
          body: z.string().min(1),
        }),
      )
      .mutation(({ input, ctx }) => {
        const store = getDemoStore();
        const deal = store.deals.get(input.dealId);
        if (!deal) throw new Error("NOT_FOUND");
        if (
          !deal.buafFit ||
          (deal.buafTemperature !== "hot" && deal.buafTemperature !== "warm")
        ) {
          throw new Error("BUAF_REQUIRED");
        }
        const item = {
          approvalId: randomUUID(),
          dealId: input.dealId,
          channel: input.channel,
          status: "pending" as const,
          subject: input.subject,
          body: input.body,
          toEmail: input.toEmail,
          idempotencyKey: null as string | null,
          externalId: null as string | null,
          sendMode: null as string | null,
          createdAt: new Date().toISOString(),
          decidedAt: null as string | null,
          rejectReason: null as string | null,
        };
        store.approvalQueue.set(item.approvalId, item);
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "outreach.queue.draft",
          entityType: "approval_queue",
          entityId: item.approvalId,
          before: null,
          after: { channel: item.channel, status: "pending" },
          reason: null,
        });
        return item;
      }),

    approve: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          idempotencyKey: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const store = getDemoStore();
        const item = store.approvalQueue.get(input.id);
        if (!item) throw new Error("NOT_FOUND");
        if (store.killSwitches[item.channel]) {
          throw new Error("KILL_SWITCH");
        }
        if (store.sentIdempotency.has(input.idempotencyKey)) {
          return {
            sent: item.status === "sent",
            mode: item.sendMode ?? "duplicate",
            auditId: "idempotent",
            externalId: item.externalId,
          };
        }
        if (item.status !== "pending") {
          throw new Error("NOT_PENDING");
        }

        const send = await store.composio.sendAfterApproval({
          toolkit: item.channel,
          to: item.toEmail,
          subject: item.subject,
          body: item.body,
        });

        const next = {
          ...item,
          status: "sent" as const,
          idempotencyKey: input.idempotencyKey,
          externalId: send.externalId,
          sendMode: send.mode,
          decidedAt: new Date().toISOString(),
        };
        store.approvalQueue.set(item.approvalId, next);
        store.sentIdempotency.add(input.idempotencyKey);
        const audit = store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "outreach.queue.approve",
          entityType: "approval_queue",
          entityId: item.approvalId,
          before: { status: "pending" },
          after: {
            status: "sent",
            mode: send.mode,
            externalId: send.externalId,
          },
          reason: null,
        });
        return {
          sent: send.sent,
          mode: send.mode,
          auditId: audit.auditEventId,
          externalId: send.externalId,
        };
      }),

    reject: protectedProcedure
      .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
      .mutation(({ input, ctx }) => {
        const store = getDemoStore();
        const item = store.approvalQueue.get(input.id);
        if (!item) throw new Error("NOT_FOUND");
        const next = {
          ...item,
          status: "rejected" as const,
          rejectReason: input.reason,
          decidedAt: new Date().toISOString(),
        };
        store.approvalQueue.set(item.approvalId, next);
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "outreach.queue.reject",
          entityType: "approval_queue",
          entityId: item.approvalId,
          before: { status: item.status },
          after: { status: "rejected", reason: input.reason },
          reason: input.reason,
        });
        return { ok: true as const };
      }),
  }),

  killSwitch: router({
    set: protectedProcedure
      .input(
        z.object({
          channel: z.enum(["gmail", "linkedin"]),
          enabled: z.boolean(),
        }),
      )
      .mutation(({ input, ctx }) => {
        if (!ctx.roles.includes("partner")) {
          throw new Error("PARTNER_ONLY");
        }
        getDemoStore().killSwitches[input.channel] = input.enabled;
        return { channel: input.channel, enabled: input.enabled };
      }),
    get: protectedProcedure.query(() => getDemoStore().killSwitches),
  }),

  replies: router({
    classify: protectedProcedure
      .input(z.object({ threadRef: z.string().min(1) }))
      .mutation(({ input }) => {
        const lower = input.threadRef.toLowerCase();
        let intent: "interested" | "not_now" | "unsubscribe" | "unclear" =
          "unclear";
        if (lower.includes("interested") || lower.includes("let's talk")) {
          intent = "interested";
        } else if (lower.includes("not now") || lower.includes("later")) {
          intent = "not_now";
        } else if (lower.includes("unsubscribe") || lower.includes("remove")) {
          intent = "unsubscribe";
        }
        return {
          intent,
          confidence: intent === "unclear" ? 0.4 : 0.85,
          nextAction:
            intent === "interested"
              ? "book_discovery"
              : intent === "not_now"
                ? "nurture_queue"
                : intent === "unsubscribe"
                  ? "suppress"
                  : "human_review",
        };
      }),
  }),
});

export const leadsRouter = router({
  inbound: router({
    create: publicProcedure
      .input(
        z.object({
          companyName: z.string().min(1),
          contactEmail: z.string().email(),
          sector: z.string().optional(),
          message: z.string().optional(),
        }),
      )
      .mutation(({ input }) => {
        const store = getDemoStore();
        const deal: DemoDeal = {
          dealId: randomUUID(),
          companyName: input.companyName,
          sector: input.sector ?? null,
          stage: "discover",
          closeOutcome: null,
          lostReason: null,
          leadSourceLane: "inbound",
          buafBudget: false,
          buafUrgency: false,
          buafAccess: false,
          buafFit: false,
          buafTemperature: null,
          noGoFlags: [],
          emailVerified: false,
          contactEmail: input.contactEmail,
          voiceCheckPassed: false,
          quoteValue: "0.00",
          internalCost: "0.00",
          marginPct: "0.00",
          discountPct: "0.00",
          discountApprovalTier: null,
          vendorHandlingFeePct: "20.00",
          quoteLines: [],
          ownerEmployeeId: null,
          enrichment: input.message ? { inboundMessage: input.message } : null,
          commercialMode: "project",
        };
        store.deals.set(deal.dealId, deal);
        return deal;
      }),
  }),

  apollo: router({
    import: protectedProcedure
      .input(z.object({ query: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const store = getDemoStore();
        const apollo = await apolloFor(ctx.employeeId!);
        const companies = await apollo.client.searchCompanies(input.query);
        const created: DemoDeal[] = [];
        for (const c of companies.slice(0, 5)) {
          const name = String(c.name ?? input.query);
          const deal: DemoDeal = {
            dealId: randomUUID(),
            companyName: name,
            sector: String(c.industry ?? "Unknown"),
            stage: "discover",
            closeOutcome: null,
            lostReason: null,
            leadSourceLane: "apollo_intent",
            buafBudget: false,
            buafUrgency: false,
            buafAccess: false,
            buafFit: false,
            buafTemperature: null,
            noGoFlags: [],
            emailVerified: false,
            contactEmail: null,
            voiceCheckPassed: false,
            quoteValue: "0.00",
            internalCost: "0.00",
            marginPct: "0.00",
            discountPct: "0.00",
            discountApprovalTier: null,
            vendorHandlingFeePct: "20.00",
            quoteLines: [],
            ownerEmployeeId: ctx.employeeId,
            enrichment: { apollo: c },
            commercialMode: "project",
          };
          store.deals.set(deal.dealId, deal);
          created.push(deal);
        }
        return created;
      }),
  }),

  tejari: router({
    scan: protectedProcedure
      .input(z.object({ filter: z.string().optional() }).optional())
      .mutation(({ input }) => {
        return [
          {
            title: `Tejari RFP stub ${input?.filter ?? "open"}`,
            lane: "tejari",
            status: "queued",
          },
        ];
      }),
  }),

  nurture: router({
    enqueue: protectedProcedure
      .input(
        z.object({
          dealId: z.string().uuid(),
          sequenceId: z.string().default("manual-reengage"),
        }),
      )
      .mutation(({ input, ctx }) => {
        getDemoStore().appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "leads.nurture.enqueue",
          entityType: "deal",
          entityId: input.dealId,
          before: null,
          after: { sequenceId: input.sequenceId },
          reason: null,
        });
        return { ok: true as const, sequenceId: input.sequenceId };
      }),
  }),

  ping: publicProcedure.query(() => ({ ok: true as const })),
});
