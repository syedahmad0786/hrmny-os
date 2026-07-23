import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bootstrapGateRegistry } from "@hrmny/gate";
import { createComposioStub } from "@hrmny/integrations";
import { getDemoStore } from "../demo-store";
import { getBuildStatus } from "../build-status";
import { DEV_USERS, getAuthMode } from "../auth/session";
import {
  createCallerFactory,
  protectedProcedure,
  publicProcedure,
  requirePermission,
  router,
} from "./trpc";
import {
  dashboardsHrRouter,
  employeesRouter,
  invoicesRouter,
  payrollRouter,
  requisitionsRouter,
} from "./m2-routers";
import {
  clientsRouter,
  dealsRouter,
  leadsRouter,
  outreachRouter,
  scopesRouter,
} from "./m3-routers";
import { crmRouter } from "./crm-routers";
import { ticketsRouter } from "./tickets-router";
import { automationRouter } from "./automation-router";
import {
  briefsRouter as m4BriefsRouter,
  calendarsRouter as m4CalendarsRouter,
  deliveryDashboardsRouter,
  m4DemoRouter,
  tasksRouter as m4TasksRouter,
} from "./m4-routers";
import {
  m5DemoRouter,
  marginDashboardsRouter,
  vatRouter as m5VatRouter,
} from "./m5-routers";
import {
  dashboardsHubRouter,
  m6DemoRouter,
  portalRouter as m6PortalRouter,
  seamsRouter,
} from "./m6-routers";

bootstrapGateRegistry();

const composio = createComposioStub();

export const authRouter = router({
  session: publicProcedure.query(({ ctx }) => ({
    employeeId: ctx.employeeId,
    roles: ctx.roles,
    displayName: ctx.user?.displayName ?? "Anonymous",
    email: ctx.user?.email ?? null,
    canViewMargin: ctx.canViewMargin,
    actorType: ctx.user?.actorType ?? null,
    clientId: ctx.user?.clientId ?? null,
    authMode: getAuthMode(),
  })),
  /** Dev-only: list switchable personas for M1–M6 demo. */
  devUsers: publicProcedure.query(() =>
    getAuthMode() === "dev"
      ? Object.entries(DEV_USERS).map(([key, u]) => ({
          key,
          displayName: u.displayName,
          email: u.email,
          roles: u.roles,
          actorType: u.actorType,
          clientId: u.clientId,
        }))
      : [],
  ),
  logout: publicProcedure.mutation(() => undefined),
});

export const adminRouter = router({
  roles: router({
    list: protectedProcedure.query(() => getDemoStore().roles),
  }),
  permissions: router({
    list: protectedProcedure.query(({ ctx }) => {
      const policies = [
        { role: "am", resource: "margin", action: "view", effect: "deny" },
        { role: "partner", resource: "margin", action: "view", effect: "allow" },
        { role: "finance", resource: "margin", action: "view", effect: "allow" },
        { role: "am", resource: "deal", action: "transition", effect: "allow" },
      ];
      return {
        policies,
        viewerCanSeeMargin: ctx.canViewMargin,
        viewerRoles: ctx.roles,
      };
    }),
  }),
  audit: router({
    list: protectedProcedure
      .use(requirePermission("audit", "view"))
      .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
      .query(({ input }) => {
        const limit = input?.limit ?? 25;
        return getDemoStore().audits.slice(0, limit);
      }),
  }),
  health: router({
    get: protectedProcedure.query(() => {
      const store = getDemoStore();
      return {
        ok: true as const,
        signals: store.healthSignals.slice(0, 10),
        spendCaps: { llmMonthlyAed: process.env.LLM_MONTHLY_CAP_AED ?? null },
        chatWebhookConfigured: Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL),
      };
    }),
    emitStub: protectedProcedure
      .input(
        z.object({
          signalKey: z.string(),
          severity: z.enum(["info", "warn", "critical"]).default("info"),
        }),
      )
      .mutation(({ input }) => {
        const row = getDemoStore().pushHealth(input.signalKey, input.severity, {
          source: "admin.health.emitStub",
        });
        const webhookConfigured = Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL);
        return {
          ...row,
          chat: webhookConfigured ? ("posted" as const) : ("stubbed" as const),
          webhookConfigured,
        };
      }),
  }),
});

export const conventionsRouter = router({
  list: protectedProcedure
    .input(z.object({ ruleKey: z.string().optional() }).optional())
    .query(({ input }) => {
      const rows = [...getDemoStore().conventions.values()];
      if (input?.ruleKey) return rows.filter((r) => r.ruleKey === input.ruleKey);
      return rows.sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
    }),
  upsert: protectedProcedure
    .use(requirePermission("convention", "edit"))
    .input(
      z.object({
        ruleKey: z.string().min(1),
        payload: z.record(z.unknown()),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const prev = store.conventions.get(input.ruleKey);
      const next = {
        ruleKey: input.ruleKey,
        version: (prev?.version ?? 0) + 1,
        payload: input.payload,
        updatedAt: new Date().toISOString(),
        updatedByEmployeeId: ctx.employeeId,
      };
      store.conventions.set(input.ruleKey, next);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "convention.upsert",
        entityType: "convention",
        entityId: "00000000-0000-4000-8000-000000000000",
        before: prev ? { ...prev } : null,
        after: { ...next },
        reason: null,
      });
      return next;
    }),
});

export const connectionsRouter = router({
  list: protectedProcedure
    .input(z.object({ scope: z.enum(["staff", "portal"]).optional() }).optional())
    .query(async ({ input }) => {
      const toolkits = await composio.listToolkits();
      const store = getDemoStore();
      const existing = store.connections.filter(
        (c) => !input?.scope || c.scope === input.scope,
      );
      if (existing.length > 0) return existing;
      return toolkits.map((toolkit) => ({
        connectionAccountId: `stub-${toolkit}`,
        toolkit,
        scope: (input?.scope ?? "staff") as "staff" | "portal",
        status: "disconnected",
        externalConnectionId: null as string | null,
      }));
    }),
  startOAuth: protectedProcedure
    .input(
      z.object({
        toolkit: z.enum(["gmail", "linkedin", "canva", "calendar"]),
        redirectUri: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const redirectUri =
        input.redirectUri ??
        `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/settings/connections/callback`;
      const { redirectUrl } = await composio.startOAuth(input.toolkit, redirectUri);
      getDemoStore().connections.push({
        connectionAccountId: randomUUID(),
        toolkit: input.toolkit,
        scope: "staff",
        status: "pending",
        externalConnectionId: null,
      });
      getDemoStore().appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "connections.startOAuth",
        entityType: "connection_account",
        entityId: "00000000-0000-4000-8000-000000000000",
        before: null,
        after: { toolkit: input.toolkit, status: "pending" },
        reason: null,
      });
      return { redirectUrl };
    }),
  disconnect: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await composio.disconnect(input.id);
      const store = getDemoStore();
      store.connections = store.connections.filter(
        (c) => c.connectionAccountId !== input.id,
      );
      return { ok: true as const };
    }),
  status: protectedProcedure
    .input(z.object({ toolkit: z.string() }))
    .query(async ({ input, ctx }) =>
      composio.status(input.toolkit, ctx.employeeId!),
    ),
  /** Dev/stub: complete OAuth callback and mark toolkit connected. */
  completeOAuth: protectedProcedure
    .input(
      z.object({
        toolkit: z.enum(["gmail", "linkedin", "canva", "calendar"]),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      let row = store.connections.find(
        (c) => c.toolkit === input.toolkit && c.scope === "staff",
      );
      if (!row) {
        row = {
          connectionAccountId: randomUUID(),
          toolkit: input.toolkit,
          scope: "staff",
          status: "connected",
          externalConnectionId: `stub-${input.toolkit}-${Date.now()}`,
        };
        store.connections.push(row);
      } else {
        row.status = "connected";
        row.externalConnectionId = `stub-${input.toolkit}-${Date.now()}`;
      }
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "connections.completeOAuth",
        entityType: "connection_account",
        entityId: row.connectionAccountId,
        before: null,
        after: { toolkit: input.toolkit, status: "connected" },
        reason: null,
      });
      return row;
    }),
  /** Canva connect-only smoke: list stub designs when connected. */
  canvaListDesigns: protectedProcedure.query(({ ctx }) => {
    const store = getDemoStore();
    const canva = store.connections.find(
      (c) => c.toolkit === "canva" && c.status === "connected",
    );
    if (!canva) {
      return {
        ok: false as const,
        reason: "Canva not connected — use Connections → Connect canva",
        designs: [] as { id: string; title: string }[],
      };
    }
    store.appendAudit({
      actorEmployeeId: ctx.employeeId!,
      action: "connections.canvaListDesigns",
      entityType: "connection_account",
      entityId: canva.connectionAccountId,
      before: null,
      after: { smoke: true },
      reason: null,
    });
    return {
      ok: true as const,
      designs: [
        { id: "stub-design-1", title: "Brand kit cover (Canva stub)" },
        { id: "stub-design-2", title: "Social template pack (Canva stub)" },
      ],
    };
  }),
});

export const assetsRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        clientId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const asset = getDemoStore().createAsset(input.title, input.clientId ?? null);
      return asset;
    }),
  uploadVersion: protectedProcedure
    .input(
      z.object({
        assetId: z.string().uuid(),
        fileName: z.string().min(1),
        contentType: z.string().default("application/octet-stream"),
        contentBase64: z.string().min(1),
        isClientRevision: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const version = await getDemoStore().uploadVersion({
        assetId: input.assetId,
        contentBase64: input.contentBase64,
        contentType: input.contentType,
        fileName: input.fileName,
        employeeId: ctx.employeeId,
        isClientRevision: input.isClientRevision,
      });
      getDemoStore().pushHealth("dam_upload", "info", {
        assetId: input.assetId,
        versionNumber: version.versionNumber,
      });
      return version;
    }),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getDemoStore().assets.get(input.id) ?? null),
  signedUrl: protectedProcedure
    .input(
      z.object({
        assetId: z.string().uuid(),
        versionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const asset = getDemoStore().assets.get(input.assetId);
      if (!asset) return null;
      const version = asset.versions.find((v) => v.assetVersionId === input.versionId);
      if (!version) return null;
      const ttl = Number(process.env.DAM_SIGNED_URL_TTL_SECONDS ?? 300);
      const signed = await getDemoStore().objectStore.signedUrl(
        version.storagePath,
        ttl,
      );
      getDemoStore().appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "assets.signedUrl",
        entityType: "asset_version",
        entityId: version.assetVersionId,
        before: null,
        after: { path: version.storagePath, expiresAt: signed.expiresAt },
        reason: null,
      });
      return signed;
    }),
  list: protectedProcedure.query(() => [...getDemoStore().assets.values()]),
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
      const asset = store.assets.get(input.id);
      if (!asset) throw new Error("NOT_FOUND");
      const isCd =
        ctx.roles.includes("creative_director") ||
        ctx.roles.includes("partner") ||
        ctx.roles.includes("director");
      if (!isCd) {
        return {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          reason: "Only Creative Director may QC assets",
        };
      }
      asset.qcPassed = input.decision === "pass" || input.decision === "waive";
      asset.status =
        input.decision === "fail"
          ? "internal_review"
          : input.decision === "pass" || input.decision === "waive"
            ? "qc_passed"
            : asset.status;
      if (asset.taskId) {
        const task = store.tasks.get(asset.taskId);
        if (task) {
          task.qcPassed = asset.qcPassed;
          if (asset.qcPassed) task.status = "qc";
        }
      }
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "assets.qc",
        entityType: "asset",
        entityId: asset.assetId,
        before: null,
        after: { decision: input.decision, qcPassed: asset.qcPassed },
        reason: input.notes ?? null,
      });
      return { ok: true as const, asset };
    }),
});

export { dealsRouter, scopesRouter, clientsRouter, outreachRouter, leadsRouter };

export const calendarsRouter = m4CalendarsRouter;
export const briefsRouter = m4BriefsRouter;
export const tasksRouter = m4TasksRouter;

export const dashboardsRouter = router({
  capacity: deliveryDashboardsRouter.capacity,
  delivery: deliveryDashboardsRouter.delivery,
  hrLifecycle: dashboardsHrRouter.hrLifecycle,
  margin: marginDashboardsRouter,
  hub: dashboardsHubRouter.hub,
});

export { invoicesRouter, payrollRouter, employeesRouter, requisitionsRouter };

export const vatRouter = m5VatRouter;

export const portalRouter = m6PortalRouter;

export const opsRouter = router({
  buildStatus: publicProcedure.query(() => getBuildStatus()),
});

export const appRouter = router({
  auth: authRouter,
  admin: adminRouter,
  conventions: conventionsRouter,
  connections: connectionsRouter,
  assets: assetsRouter,
  /** Legacy M3 demo-store deals (gates, BUAF, HITL). Prefer `crm.*` for durable CRM. */
  deals: dealsRouter,
  /** Durable CRM: companies, contacts, deals, activities, notes, tasks → Postgres or memory. */
  crm: crmRouter,
  /** Support tickets (team + portal requester) — memory stub until 0004_tickets applied. */
  tickets: ticketsRouter,
  /** n8n automation — health / list / propose / HITL trigger (automation-orchestrator). */
  automation: automationRouter,
  scopes: scopesRouter,
  clients: clientsRouter,
  calendars: calendarsRouter,
  briefs: briefsRouter,
  tasks: tasksRouter,
  dashboards: dashboardsRouter,
  invoices: invoicesRouter,
  payroll: payrollRouter,
  vat: vatRouter,
  employees: employeesRouter,
  requisitions: requisitionsRouter,
  outreach: outreachRouter,
  leads: leadsRouter,
  portal: portalRouter,
  seams: seamsRouter,
  m4: m4DemoRouter,
  m5: m5DemoRouter,
  m6: m6DemoRouter,
  ops: opsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
