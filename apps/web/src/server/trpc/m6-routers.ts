import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDemoStore } from "../demo-store";
import { getAuthMode } from "../auth/session";
import {
  portalMagicLinkEnabled,
  requestPortalMagicLink,
  verifyPortalMagicToken,
} from "../auth/portal-magic-link";
import { getSupabasePublicConfig } from "@/lib/supabase-config";
import { getDb } from "../db";
import {
  featureEnabled,
  listFeatureOverrides,
  resolveFeatureCatalog,
} from "../features";
import {
  actOnPortalApproval,
  portalAssetStoragePath,
  portalClientName,
  readPortalWorkspace,
} from "../portal-data";
import { driveSeam, listSeams, type SeamName } from "../seams";
import { getDemoGuestShare } from "../work-governance";
import { getDemoWork } from "./work-management-router";
import {
  portalProcedure,
  protectedProcedure,
  publicProcedure,
  router,
  staffProcedure,
} from "./trpc";

function requireClientId(ctx: {
  clientId?: string | null;
  user: { clientId: string | null } | null;
}): string {
  const id = ctx.clientId ?? ctx.user?.clientId;
  if (!id) throw new Error("FORBIDDEN: missing client_id");
  return id;
}

async function requirePortalWorkFeature(
  ctx: {
    employeeId: string | null;
    clientId?: string | null;
    user: { roles: string[]; clientId: string | null } | null;
  },
  featureKey: string,
) {
  if (
    !(await featureEnabled(featureKey, {
      userId: ctx.employeeId,
      clientId: ctx.clientId ?? ctx.user?.clientId,
      roles: ctx.user?.roles ?? [],
    }))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `FEATURE_DISABLED:${featureKey}`,
    });
  }
}

async function requireGuestProject(
  portalUserId: string,
  projectId: string,
  minimum: "viewer" | "commenter" = "viewer",
) {
  const db = getDb();
  if (!db) {
    const share = getDemoGuestShare(projectId, portalUserId);
    if (!share) throw new TRPCError({ code: "NOT_FOUND" });
    if (minimum === "commenter" && share.accessLevel !== "commenter") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Comment access required",
      });
    }
    return share;
  }
  const rows = await db.execute<{
    projectId: string;
    name: string;
    description: string;
    color: string;
    accessLevel: "viewer" | "commenter";
  }>(sql`
    select project.work_project_id as "projectId", project.name,
      project.description, project.color, guest.access_level as "accessLevel"
    from public.work_project_guest guest
    join public.work_project project on project.work_project_id = guest.work_project_id
    where guest.portal_user_id = ${portalUserId}::uuid
      and project.work_project_id = ${projectId}::uuid
      and project.archived_at is null
    limit 1
  `);
  const project = rows[0];
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  if (minimum === "commenter" && project.accessLevel !== "commenter") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Comment access required",
    });
  }
  return project;
}

async function requireGuestItem(
  portalUserId: string,
  itemId: string,
  minimum: "viewer" | "commenter" = "viewer",
) {
  const db = getDb();
  if (!db) {
    const item = getDemoWork().items.get(itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND" });
    await requireGuestProject(portalUserId, item.projectId, minimum);
    return item;
  }
  const rows = await db.execute<{ projectId: string }>(sql`
    select membership.work_project_id as "projectId"
    from public.work_project_item membership
    join public.work_project_guest guest
      on guest.work_project_id = membership.work_project_id
    where membership.work_item_id = ${itemId}::uuid
      and guest.portal_user_id = ${portalUserId}::uuid
      and (${minimum} = 'viewer' or guest.access_level = 'commenter')
    limit 1
  `);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
  return rows[0];
}

export const portalRouter = router({
  auth: router({
    /** Pre-auth config so the login page picks the right sign-in path. */
    config: publicProcedure.query(async () => ({
      magicLinkEnabled: await portalMagicLinkEnabled(),
      supabaseConfigured: Boolean(getSupabasePublicConfig()),
    })),
    magicLink: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          redirectTo: z.string().url().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        // Flag on: enumeration-safe allowlist path (identical response for any
        // email; only invited contacts get an OTP / mock token).
        if (await portalMagicLinkEnabled()) {
          await requestPortalMagicLink(input.email, {
            redirectTo: input.redirectTo,
          });
          return {
            sent: true as const,
            stubToken: undefined,
            reason: undefined,
          };
        }
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
        if (
          email.includes("other") ||
          email.includes("portal_b") ||
          email.includes("b@")
        ) {
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
      .mutation(async ({ input, ctx }) => {
        // Flag on: single-use allowlist-bound token verification.
        if (input?.token && (await portalMagicLinkEnabled())) {
          const result = verifyPortalMagicToken(input.token);
          return result.ok
            ? { ...result, displayName: result.email || "Portal contact" }
            : result;
        }
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
            return {
              ok: false as const,
              reason: "Invalid or expired magic link",
            };
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
        if (
          !ctx.user ||
          ctx.user.actorType !== "portal" ||
          !ctx.user.clientId
        ) {
          return {
            ok: false as const,
            reason:
              "Switch Dev role to portal_a or portal_b, or pass a stubToken",
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
      const resolved = resolveFeatureCatalog(await listFeatureOverrides(), {
        userId: ctx.employeeId,
        clientId,
        roles: ctx.roles,
      });
      return {
        clientId,
        displayName: ctx.user.displayName,
        email: ctx.user.email,
        clientName: await portalClientName(clientId),
        actorType: "portal" as const,
        canViewMargin: false as const,
        enabledFeatureKeys: resolved
          .filter((feature) => feature.enabled)
          .map((feature) => feature.key),
      };
    }),
  }),

  work: router({
    projects: router({
      list: portalProcedure.query(async ({ ctx }) => {
        await requirePortalWorkFeature(ctx, "work.projects");
        const portalUserId = ctx.employeeId;
        if (!portalUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
        const db = getDb();
        if (!db) {
          return [...getDemoWork().projects.values()].flatMap((project) => {
            const share = getDemoGuestShare(project.projectId, portalUserId);
            return share
              ? [{ ...project, accessLevel: share.accessLevel }]
              : [];
          });
        }
        return db.execute<{
          projectId: string;
          name: string;
          description: string;
          color: string;
          accessLevel: "viewer" | "commenter";
        }>(sql`
          select project.work_project_id as "projectId", project.name,
            project.description, project.color, guest.access_level as "accessLevel"
          from public.work_project_guest guest
          join public.work_project project on project.work_project_id = guest.work_project_id
          where guest.portal_user_id = ${portalUserId}::uuid
            and project.archived_at is null
          order by lower(project.name)
        `);
      }),

      get: portalProcedure
        .input(z.object({ projectId: z.string().uuid() }))
        .query(async ({ input, ctx }) => {
          const portalUserId = ctx.employeeId;
          if (!portalUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
          const project = await requireGuestProject(
            portalUserId,
            input.projectId,
          );
          const [showSections, showTasks] = await Promise.all([
            featureEnabled("work.sections", {
              userId: portalUserId,
              clientId: ctx.clientId,
              roles: ctx.roles,
            }),
            featureEnabled("work.tasks", {
              userId: portalUserId,
              clientId: ctx.clientId,
              roles: ctx.roles,
            }),
          ]);
          const db = getDb();
          if (!db) {
            const work = getDemoWork();
            return {
              project,
              sections: showSections
                ? [...work.sections.values()].filter(
                    (section) => section.projectId === input.projectId,
                  )
                : [],
              items: showTasks
                ? [...work.items.values()].filter(
                    (item) => item.projectId === input.projectId,
                  )
                : [],
            };
          }
          const [sections, items] = await Promise.all([
            showSections
              ? db.execute(sql`
                  select work_section_id as "sectionId", name, position
                  from public.work_section
                  where work_project_id = ${input.projectId}::uuid
                  order by position, created_at
                `)
              : [],
            showTasks
              ? db.execute(sql`
                  select item.work_item_id as "itemId",
                    item.parent_work_item_id as "parentItemId", item.title,
                    item.description, item.item_type as "itemType", item.priority,
                    item.start_date as "startDate", item.due_at as "dueAt",
                    item.completed_at as "completedAt",
                    membership.work_section_id as "sectionId", membership.position
                  from public.work_project_item membership
                  join public.work_item item on item.work_item_id = membership.work_item_id
                  where membership.work_project_id = ${input.projectId}::uuid
                    and item.archived_at is null
                  order by membership.position, item.created_at
                `)
              : [],
          ]);
          return { project, sections, items };
        }),
    }),

    comments: router({
      list: portalProcedure
        .input(z.object({ itemId: z.string().uuid() }))
        .query(async ({ input, ctx }) => {
          await requirePortalWorkFeature(ctx, "work.comments");
          const portalUserId = ctx.employeeId;
          if (!portalUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
          await requireGuestItem(portalUserId, input.itemId);
          const db = getDb();
          if (!db) {
            return [...getDemoWork().comments.values()].filter(
              (comment) => comment.itemId === input.itemId,
            );
          }
          return db.execute(sql`
            select comment.work_comment_id as "commentId", comment.body,
              coalesce(employee.display_name, portal.display_name, 'Unknown') as "authorName",
              comment.created_at as "createdAt"
            from public.work_comment comment
            left join public.employee employee
              on employee.employee_id = comment.author_employee_id
            left join public.client_portal_user portal
              on portal.client_portal_user_id = comment.author_portal_user_id
            where comment.work_item_id = ${input.itemId}::uuid
              and comment.deleted_at is null
            order by comment.created_at
          `);
        }),

      create: portalProcedure
        .input(
          z.object({
            itemId: z.string().uuid(),
            body: z.string().trim().min(1).max(20_000),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          await requirePortalWorkFeature(ctx, "work.comments");
          const portalUserId = ctx.employeeId;
          if (!portalUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
          await requireGuestItem(portalUserId, input.itemId, "commenter");
          const db = getDb();
          if (!db) {
            const comment = {
              commentId: randomUUID(),
              itemId: input.itemId,
              authorEmployeeId: null,
              authorPortalUserId: portalUserId,
              authorName: ctx.user.displayName,
              body: input.body,
              createdAt: new Date().toISOString(),
            };
            getDemoWork().comments.set(comment.commentId, comment);
            getDemoStore().appendAudit({
              actorEmployeeId: portalUserId,
              action: "portal.work.comment.create",
              entityType: "work_comment",
              entityId: comment.commentId,
              before: null,
              after: { itemId: input.itemId },
              reason: null,
            });
            return comment;
          }
          const comment = await db.transaction(async (tx) => {
            const rows = await tx.execute(sql`
              insert into public.work_comment (
                work_item_id, author_portal_user_id, body
              ) values (${input.itemId}::uuid, ${portalUserId}::uuid, ${input.body})
              returning work_comment_id as "commentId", work_item_id as "itemId",
                body, created_at as "createdAt"
            `);
            const saved = rows[0]!;
            await tx.execute(sql`
              insert into public.audit_event (
                actor_portal_user_id, action, entity_type, entity_id, after
              ) values (
                ${portalUserId}::uuid, 'portal.work.comment.create', 'work_comment',
                ${String(saved.commentId)}::uuid,
                jsonb_build_object('itemId', ${input.itemId})
              )
            `);
            await tx.execute(sql`
              insert into public.work_notification (
                recipient_employee_id, work_item_id, work_project_id,
                event_type, message
              )
              select follower.employee_id, ${input.itemId}::uuid,
                min(project_item.work_project_id::text)::uuid, 'commented',
                'New guest comment on a followed task'
              from public.work_item_follower follower
              left join public.work_project_item project_item
                on project_item.work_item_id = follower.work_item_id
              where follower.work_item_id = ${input.itemId}::uuid
              group by follower.employee_id
            `);
            return saved;
          });
          return { ...comment, authorName: ctx.user.displayName };
        }),
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
    .input(
      z.object({ limit: z.number().min(1).max(100).optional() }).optional(),
    )
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
