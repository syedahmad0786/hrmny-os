import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DEMO_CLIENT_ID,
  getDemoStore,
} from "../demo-store";
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

/** Strip any finance-shaped keys before portal responses leave the server. */
function assertNoFinanceKeys(row: Record<string, unknown>): void {
  const banned = [
    "marginPct",
    "margin",
    "internalCost",
    "fee",
    "contractValue",
    "deliveryCost",
    "payroll",
    "grossAmount",
    "xeroInvoiceId",
    "revenueToDate",
  ];
  for (const key of banned) {
    if (key in row) {
      throw new Error(`PORTAL_FINANCE_LEAK: ${key}`);
    }
  }
}

export const portalRouter = router({
  auth: router({
    magicLink: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(({ input }) => {
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
          stubToken: process.env.AUTH_MODE === "supabase" ? undefined : token,
        };
      }),
    /** Consume magic-link token (dev) or rely on x-dev-role persona. */
    verify: publicProcedure
      .input(z.object({ token: z.string().optional() }).optional())
      .mutation(({ input, ctx }) => {
        const store = getDemoStore();
        if (input?.token) {
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
    session: portalProcedure.query(({ ctx }) => {
      const clientId = requireClientId(ctx);
      const client = getDemoStore().clients.get(clientId);
      return {
        clientId,
        displayName: ctx.user.displayName,
        email: ctx.user.email,
        clientName: client?.name ?? "Client",
        actorType: "portal" as const,
        canViewMargin: false as const,
      };
    }),
  }),

  briefs: router({
    list: portalProcedure.query(({ ctx }) => {
      const clientId = requireClientId(ctx);
      const store = getDemoStore();
      const taskIds = new Set(
        [...store.tasks.values()]
          .filter((t) => t.clientId === clientId)
          .map((t) => t.taskId),
      );
      return [...store.briefs.values()]
        .filter((b) => taskIds.has(b.taskId))
        .map((b) => {
          const row = {
            briefId: b.briefId,
            taskId: b.taskId,
            lockedAt: b.lockedAt,
            dorComplete: b.dorComplete,
            missingRequiredCount: b.missingRequiredCount,
          };
          assertNoFinanceKeys(row);
          return row;
        });
    }),
  }),

  tasks: router({
    list: portalProcedure.query(({ ctx }) => {
      const clientId = requireClientId(ctx);
      return [...getDemoStore().tasks.values()]
        .filter((t) => t.clientId === clientId)
        .map((t) => {
          const row = {
            taskId: t.taskId,
            title: t.title,
            status: t.status,
            taskType: t.taskType,
            deadline: t.deadline,
            priority: t.priority,
          };
          assertNoFinanceKeys(row);
          return row;
        });
    }),
  }),

  assets: router({
    list: portalProcedure.query(({ ctx }) => {
      const clientId = requireClientId(ctx);
      return [...getDemoStore().assets.values()]
        .filter((a) => a.clientId === clientId)
        .map((a) => {
          const row = {
            assetId: a.assetId,
            title: a.title,
            status: a.status,
            versionCount: a.versions.length,
          };
          assertNoFinanceKeys(row);
          return row;
        });
    }),
    signedUrl: portalProcedure
      .input(
        z.object({
          assetId: z.string().uuid(),
          versionId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const clientId = requireClientId(ctx);
        const store = getDemoStore();
        const asset = store.assets.get(input.assetId);
        if (!asset || asset.clientId !== clientId) {
          throw new Error("NOT_FOUND");
        }
        const allowed = ["client_review", "approved", "qc_passed", "delivered"];
        if (!allowed.includes(asset.status) && !asset.qcPassed) {
          return {
            ok: false as const,
            reason: "Asset not yet client-visible",
          };
        }
        const version =
          asset.versions.find((v) => v.assetVersionId === input.versionId) ??
          asset.versions[asset.versions.length - 1];
        if (!version) {
          return { ok: false as const, reason: "No versions uploaded" };
        }
        const ttl = Number(process.env.DAM_SIGNED_URL_TTL_SECONDS ?? 300);
        const signed = await store.objectStore.signedUrl(version.storagePath, ttl);
        return { ok: true as const, ...signed };
      }),
  }),

  deliveries: router({
    list: portalProcedure.query(({ ctx }) => {
      const clientId = requireClientId(ctx);
      const store = getDemoStore();
      const status = store.clientDeliveryStatus.get(clientId);
      const tasks = [...store.tasks.values()].filter(
        (t) => t.clientId === clientId,
      );
      const row = {
        clientId,
        deliveryStatus: status?.status ?? "unknown",
        lastSeam: status?.lastSeam ?? null,
        updatedAt: status?.updatedAt ?? null,
        deliverables: tasks.map((t) => ({
          taskId: t.taskId,
          title: t.title,
          status: t.status,
        })),
      };
      assertNoFinanceKeys(row as unknown as Record<string, unknown>);
      return [row];
    }),
  }),

  approvals: router({
    list: portalProcedure.query(({ ctx }) => {
      const clientId = requireClientId(ctx);
      return [...getDemoStore().portalApprovals.values()]
        .filter((a) => a.clientId === clientId)
        .map((a) => ({
          approvalId: a.approvalId,
          title: a.title,
          kind: a.kind,
          status: a.status,
          slaHours: a.slaHours,
          entityId: a.entityId,
          createdAt: a.createdAt,
        }));
    }),
    act: portalProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          action: z.enum(["approve", "reject"]),
          feedback: z.string().optional(),
        }),
      )
      .mutation(({ input, ctx }) => {
        const clientId = requireClientId(ctx);
        const store = getDemoStore();
        const item = store.portalApprovals.get(input.id);
        if (!item || item.clientId !== clientId) {
          throw new Error("NOT_FOUND");
        }
        item.status = input.action === "approve" ? "approved" : "rejected";
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "portal.approvals.act",
          entityType: "portal_approval",
          entityId: item.approvalId,
          before: null,
          after: { status: item.status, feedback: input.feedback ?? null },
          reason: input.feedback ?? null,
        });
        return { ok: true as const, item };
      }),
  }),

  reports: router({
    get: portalProcedure
      .input(z.object({ month: z.string().optional() }).optional())
      .query(({ input, ctx }) => {
        const clientId = requireClientId(ctx);
        const store = getDemoStore();
        const tasks = [...store.tasks.values()].filter(
          (t) => t.clientId === clientId,
        );
        const month = input?.month ?? new Date().toISOString().slice(0, 7);
        const report = {
          month,
          clientId,
          tasksCompleted: tasks.filter((t) =>
            ["delivered", "client_review", "approved"].includes(t.status),
          ).length,
          tasksOpen: tasks.filter(
            (t) => !["delivered", "cancelled"].includes(t.status),
          ).length,
          assetsVisible: [...store.assets.values()].filter(
            (a) => a.clientId === clientId,
          ).length,
          note: "Campaign activity only — no revenue, cost, or margin",
        };
        assertNoFinanceKeys(report);
        return report;
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

export const m6DemoRouter = router({
  reset: publicProcedure.mutation(() => {
    getDemoStore().resetM6Demo();
    return {
      ok: true as const,
      clientId: DEMO_CLIENT_ID,
      note: "M6 seeded: Demo Co + Other Co; portal personas portal_a / portal_b",
    };
  }),
});
