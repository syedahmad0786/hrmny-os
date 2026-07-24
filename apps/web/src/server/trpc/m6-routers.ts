import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDemoStore } from "../demo-store";
import { getAuthMode } from "../auth/session";
import {
  actOnPortalApproval,
  portalAssetStoragePath,
  portalClientName,
  readPortalWorkspace,
} from "../portal-data";
import { driveSeam, listSeams, type SeamName } from "../seams";
import {
  portalProcedure,
  protectedProcedure,
  publicProcedure,
  router,
  staffProcedure,
} from "./trpc";

function requireClientId(ctx: { clientId?: string | null; user: { clientId: string | null } | null }): string {
  const id = ctx.clientId ?? ctx.user?.clientId;
  if (!id) throw new Error("FORBIDDEN: missing client_id");
  return id;
}

export const portalRouter = router({
  auth: router({
    magicLink: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(({ input }) => {
        if (getAuthMode() === "supabase") {
          return {
            sent: false as const,
            stubToken: undefined,
            reason: "Use Supabase Auth for production magic links",
          };
        }
        const store = getDemoStore();
        // Map known demo emails → portal clients; unknown emails still get a token
        // but verify will fail isolation unless clientId is known.
        const email = input.email.toLowerCase();
        let clientId = "00000000-0000-4000-8000-0000000000a1";
        if (email.includes("other") || email.includes("portal_b") || email.includes("b@")) {
          clientId = "00000000-0000-4000-8000-0000000000b1";
        }
        const token = `ml_${randomUUID().replace(/-/g, "")}`;
        store.portalMagicTokens.set(token, {
          token,
          clientId,
          expiresAt: Date.now() + 15 * 60 * 1000,
        });
        store.appendAudit({
          actorEmployeeId: "00000000-0000-4000-8000-000000000000",
          action: "portal.auth.magicLink",
          entityType: "client_portal_user",
          entityId: clientId,
          before: null,
          after: { email: input.email, sent: true, stub: true },
          reason: null,
        });
        // Dev stub: return token so UI/tests can complete without email delivery.
        return {
          sent: true as const,
          stubToken: token,
          reason: undefined,
        };
      }),
    /** Consume magic-link token (dev) or rely on x-dev-role persona. */
    verify: publicProcedure
      .input(z.object({ token: z.string().optional() }).optional())
      .mutation(({ input, ctx }) => {
        const store = getDemoStore();
        if (input?.token) {
          if (getAuthMode() === "supabase") {
            return {
              ok: false as const,
              reason: "Dev magic-link tokens are disabled in production",
            };
          }
          const row = store.portalMagicTokens.get(input.token);
          if (!row || row.expiresAt < Date.now()) {
            return { ok: false as const, reason: "Invalid or expired magic link" };
          }
          store.portalMagicTokens.delete(input.token);
          store.appendAudit({
            actorEmployeeId: "00000000-0000-4000-8000-000000000000",
            action: "portal.auth.verify",
            entityType: "client_portal_user",
            entityId: row.clientId,
            before: null,
            after: { clientId: row.clientId, via: "magic_link" },
            reason: null,
          });
          return {
            ok: true as const,
            clientId: row.clientId,
            displayName: "Portal Magic User",
            email: "magic@link.local",
            via: "magic_link" as const,
          };
        }
        if (!ctx.user || ctx.user.actorType !== "portal" || !ctx.user.clientId) {
          return {
            ok: false as const,
            reason: "Switch Dev role to portal_a or portal_b, or pass a stubToken",
          };
        }
        return {
          ok: true as const,
          clientId: ctx.user.clientId,
          displayName: ctx.user.displayName,
          email: ctx.user.email,
          via: "dev_persona" as const,
        };
      }),
    session: portalProcedure.query(async ({ ctx }) => {
      const clientId = requireClientId(ctx);
      return {
        clientId,
        displayName: ctx.user.displayName,
        email: ctx.user.email,
        clientName: await portalClientName(clientId),
        actorType: "portal" as const,
        canViewMargin: false as const,
      };
    }),
  }),

  briefs: router({
    list: portalProcedure.query(async ({ ctx }) =>
      (await readPortalWorkspace(requireClientId(ctx))).briefs,
    ),
  }),

  tasks: router({
    list: portalProcedure.query(async ({ ctx }) =>
      (await readPortalWorkspace(requireClientId(ctx))).tasks,
    ),
  }),

  assets: router({
    list: portalProcedure.query(async ({ ctx }) =>
      (await readPortalWorkspace(requireClientId(ctx))).assets,
    ),
    signedUrl: portalProcedure
      .input(
        z.object({
          assetId: z.string().uuid(),
          versionId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const clientId = requireClientId(ctx);
        const storagePath = await portalAssetStoragePath(
          clientId,
          input.assetId,
          input.versionId,
        );
        if (!storagePath) {
          return { ok: false as const, reason: "No versions uploaded" };
        }
        const ttl = Number(process.env.DAM_SIGNED_URL_TTL_SECONDS ?? 300);
        const signed = await getDemoStore().objectStore.signedUrl(storagePath, ttl);
        return { ok: true as const, ...signed };
      }),
  }),

  deliveries: router({
    list: portalProcedure.query(async ({ ctx }) => [
      (await readPortalWorkspace(requireClientId(ctx))).delivery,
    ]),
  }),

  approvals: router({
    list: portalProcedure.query(async ({ ctx }) =>
      (await readPortalWorkspace(requireClientId(ctx))).approvals,
    ),
    act: portalProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          action: z.enum(["approve", "reject"]),
          feedback: z.string().optional(),
        }),
      )
      .mutation(({ input, ctx }) =>
        actOnPortalApproval({
          clientId: requireClientId(ctx),
          approvalId: input.id,
          action: input.action,
          feedback: input.feedback,
          actorPortalUserId: ctx.employeeId,
        }),
      ),
  }),

  reports: router({
    get: portalProcedure
      .input(z.object({ month: z.string().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const workspace = await readPortalWorkspace(requireClientId(ctx));
        const month = input?.month ?? new Date().toISOString().slice(0, 7);
        return {
          month,
          clientId: workspace.clientId,
          tasksCompleted: workspace.tasks.filter((t) =>
            ["delivered", "client_review", "approved"].includes(t.status),
          ).length,
          tasksOpen: workspace.tasks.filter(
            (t) => !["delivered", "archived"].includes(t.status),
          ).length,
          assetsVisible: workspace.assets.length,
          note: "Campaign activity only — no revenue, cost, or margin",
        };
      }),
  }),

  /** Explicit deny surface for demo: portal must never reach finance. */
  financeProbe: portalProcedure.query(() => {
    throw new Error("FORBIDDEN: portal finance excluded");
  }),
});

export const seamsRouter = router({
  list: staffProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(({ input }) => listSeams(input?.limit ?? 25)),

  drive: staffProcedure
    .input(
      z.object({
        name: z.enum([
          "deal.won",
          "brief.lock",
          "creative.approved",
          "hire.packet_complete",
        ]),
        idempotencyKey: z.string().min(1),
        payload: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(({ input, ctx }) =>
      driveSeam(input.name as SeamName, input.idempotencyKey, {
        ...input.payload,
        actorEmployeeId: ctx.employeeId,
      }),
    ),
});

export const dashboardsHubRouter = router({
  /** Summary cards for the 5 system views. */
  hub: protectedProcedure.query(({ ctx }) => {
    if (ctx.user?.actorType === "portal") {
      throw new Error("FORBIDDEN: portal cannot access staff dashboards hub");
    }
    const store = getDemoStore();
    return {
      systems: [
        {
          key: "commercial",
          title: "Commercial",
          href: "/sales",
          summary: `${store.deals.size} deals · ${store.clients.size} clients`,
        },
        {
          key: "delivery",
          title: "Delivery / Creative",
          href: "/delivery",
          summary: `${store.tasks.size} tasks · ${store.briefs.size} briefs`,
        },
        {
          key: "traffic",
          title: "Traffic / Capacity",
          href: "/traffic",
          summary: `${store.calendars.size} calendars`,
        },
        {
          key: "people",
          title: "People / HR",
          href: "/hr",
          summary: `${store.employees.size} employees · ${store.bayzatMirror.length} Bayzat mirror`,
        },
        {
          key: "money",
          title: "Money",
          href: "/billing",
          summary: ctx.canViewMargin
            ? `${store.invoices.size} invoices · margin OK`
            : `${store.invoices.size} invoices · margin hidden`,
          marginHref: ctx.canViewMargin ? "/margin" : null,
        },
      ],
      seamsQueued: store.seamOutbox.length,
      portalClients: [...store.clients.values()].map((c) => ({
        clientId: c.clientId,
        name: c.name,
        delivery: store.clientDeliveryStatus.get(c.clientId)?.status ?? null,
      })),
    };
  }),
});

export const m6DemoRouter = router({});
