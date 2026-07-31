import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  and,
  asset,
  assetVersion,
  auditEvent,
  convention,
  desc,
  eq,
  permissionPolicy,
  role,
  scheduledJob,
  sql,
} from "@hrmny/db";
import { randomUUID } from "node:crypto";
import { bootstrapGateRegistry } from "@hrmny/gate";
import { getDemoStore } from "../demo-store";
import { getDb } from "../db";
import { DEV_USERS, getAuthMode, sessionHas } from "../auth/session";
import {
  emitHealthSignal,
  listAudit,
  listHealthSignals,
  writeAudit,
} from "../m1-persistence";
import {
  createCallerFactory,
  protectedProcedure,
  mergeRouters,
  publicProcedure,
  requirePermission,
  router,
  staffProcedure,
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
import { aiAdminRouter } from "./ai-admin-router";
import { campaignsRouter } from "./campaigns-router";
import { analyticsRouter } from "./analytics-router";
import { portalApprovalsRouter } from "./portal-approvals-router";
import { leadgenRouter } from "./leadgen-router";
import { scorecardsRouter } from "./scorecards-router";
import { aiPolicyRouter } from "./ai-policy-router";
import { peopleReconRouter } from "./people-recon-router";
import { reportsRouter } from "./reports-router";
import { connectionsRouter } from "./connections-router";
import { featureRequestsRouter } from "./feature-requests-router";
import { coreHrRouter } from "./core-hr-router";
import { hrOperationsRouter } from "./hr-operations-router";
import { talentRouter } from "./talent-router";
import { payrollV2Router } from "./payroll-v2-router";
import { workplaceRouter } from "./workplace-router";
import { shiftsTimesheetsRouter } from "./shifts-timesheets-router";
import { benefitsReportingRouter } from "./benefits-reporting-router";
import { aiCustomAppsRouter } from "./ai-custom-apps-router";
import { digitalCardsRouter } from "./digital-cards-router";
import { featureLabRouter } from "./feature-lab-router";
import { listFeatureOverrides, resolveFeatureCatalog } from "../features";
import {
  getDemoWork,
  requireProjectAccess,
  workManagementRouter,
} from "./work-management-router";
import { workAdminRouter } from "./work-admin-router";
import { workAiRouter } from "./work-ai-router";
import { workAiStudioRouter } from "./work-ai-studio-router";
import { workAiTeammatesRouter } from "./work-ai-teammates-router";
import { asanaMigrationRouter } from "./asana-migration-router";
import { clientPreviewRouter } from "./client-preview-router";
import { opsRouter } from "./ops-router";
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
import type { TrpcContext } from "./trpc";

bootstrapGateRegistry();

export const authRouter = router({
  session: publicProcedure.query(async ({ ctx }) => {
    const resolved = ctx.user
      ? resolveFeatureCatalog(await listFeatureOverrides(), {
          userId: ctx.user.employeeId,
          clientId: ctx.user.clientId,
          roles: ctx.user.roles,
        })
      : [];
    return {
      employeeId: ctx.employeeId,
      roles: ctx.roles,
      displayName: ctx.user?.displayName ?? "Anonymous",
      email: ctx.user?.email ?? null,
      canViewMargin: ctx.canViewMargin,
      actorType: ctx.user?.actorType ?? null,
      clientId: ctx.user?.clientId ?? null,
      authMode: getAuthMode(),
      canManageRoles: ctx.user ? sessionHas(ctx.user, "role", "manage") : false,
      canEditConventions: ctx.user
        ? sessionHas(ctx.user, "convention", "edit")
        : false,
      canManageHealth: ctx.user
        ? sessionHas(ctx.user, "health", "manage")
        : false,
      enabledFeatureKeys: resolved
        .filter((item) => item.enabled)
        .map((item) => item.key),
    };
  }),
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
  features: featureLabRouter,
  roles: router({
    list: staffProcedure
      .use(requirePermission("role", "view"))
      .query(async () => {
        const db = getDb();
        if (!db) return getDemoStore().roles;
        return db.select().from(role).orderBy(role.displayName);
      }),
    assignments: staffProcedure
      .use(requirePermission("role", "view"))
      .query(async () => {
        const db = getDb();
        if (!db) {
          const roleIdByKey = new Map(
            getDemoStore().roles.map((item) => [item.key, item.roleId]),
          );
          return Object.values(DEV_USERS)
            .filter((user) => user.actorType === "staff")
            .map((user) => ({
              employeeId: user.employeeId,
              displayName: user.displayName,
              email: user.email,
              isActive: true,
              roles: user.roles.flatMap((key) => {
                const roleId = roleIdByKey.get(key);
                return roleId ? [{ roleId, key }] : [];
              }),
            }));
        }
        const employees = await db.execute<{
          employeeId: string;
          displayName: string;
          email: string;
          isActive: boolean;
        }>(sql`
          select employee_id as "employeeId", display_name as "displayName",
            email, is_active as "isActive"
          from public.employee
          order by is_active desc, lower(display_name)
        `);
        const memberships = await db.execute<{
          employeeId: string;
          roleId: string;
          key: string;
        }>(sql`
          select membership.employee_id as "employeeId",
            membership.role_id as "roleId", role.key
          from public.employee_role membership
          join public.role role on role.role_id = membership.role_id
        `);
        return employees.map((person) => ({
          ...person,
          roles: memberships
            .filter((membership) => membership.employeeId === person.employeeId)
            .map(({ roleId, key }) => ({ roleId, key })),
        }));
      }),
    assignEmployee: staffProcedure
      .use(requirePermission("role", "manage"))
      .input(
        z.object({
          employeeId: z.string().uuid(),
          roleId: z.string().uuid(),
          reason: z.string().trim().min(5).max(500),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        if (!db) {
          const target = Object.values(DEV_USERS).find(
            (user) =>
              user.actorType === "staff" &&
              user.employeeId === input.employeeId,
          );
          const targetRole = getDemoStore().roles.find(
            (item) => item.roleId === input.roleId,
          );
          if (!target || !targetRole)
            throw new TRPCError({ code: "NOT_FOUND" });
          const before = [...target.roles];
          if (target.roles.includes(targetRole.key))
            return { ok: true as const, unchanged: true as const };
          target.roles.push(targetRole.key);
          getDemoStore().appendAudit({
            actorEmployeeId: ctx.employeeId!,
            action: "admin.roles.assignEmployee",
            entityType: "employee",
            entityId: input.employeeId,
            before: { roles: before },
            after: { roles: target.roles },
            reason: input.reason,
          });
          return { ok: true as const };
        }
        return db.transaction(async (tx) => {
          await tx.execute(sql`
            select pg_advisory_xact_lock(
              hashtext(${`${input.employeeId}:${input.roleId}`})
            )
          `);
          const [target] = await tx.execute<{ isActive: boolean }>(sql`
            select is_active as "isActive" from public.employee
            where employee_id = ${input.employeeId}::uuid
          `);
          const [targetRole] = await tx.execute<{ key: string }>(sql`
            select key from public.role where role_id = ${input.roleId}::uuid
          `);
          if (!target || !targetRole)
            throw new TRPCError({ code: "NOT_FOUND" });
          if (!target.isActive)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Roles cannot be assigned to an inactive employee",
            });
          const inserted = await tx.execute(sql`
            insert into public.employee_role (employee_id, role_id)
            values (${input.employeeId}::uuid, ${input.roleId}::uuid)
            on conflict (employee_id, role_id) do nothing
            returning employee_role_id
          `);
          if (!inserted[0])
            return { ok: true as const, unchanged: true as const };
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "admin.roles.assignEmployee",
            entityType: "employee",
            entityId: input.employeeId,
            before: null,
            after: { roleId: input.roleId, roleKey: targetRole.key },
            reason: input.reason,
          });
          return { ok: true as const };
        });
      }),
    revokeEmployee: staffProcedure
      .use(requirePermission("role", "manage"))
      .input(
        z.object({
          employeeId: z.string().uuid(),
          roleId: z.string().uuid(),
          reason: z.string().trim().min(5).max(500),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        if (!db) {
          const target = Object.values(DEV_USERS).find(
            (user) =>
              user.actorType === "staff" &&
              user.employeeId === input.employeeId,
          );
          const targetRole = getDemoStore().roles.find(
            (item) => item.roleId === input.roleId,
          );
          if (!target || !targetRole)
            throw new TRPCError({ code: "NOT_FOUND" });
          if (!target.roles.includes(targetRole.key))
            throw new TRPCError({ code: "NOT_FOUND" });
          const activePartners = Object.values(DEV_USERS).filter(
            (user) =>
              user.actorType === "staff" && user.roles.includes("partner"),
          ).length;
          if (targetRole.key === "partner" && activePartners <= 1)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "The final active Partner role cannot be removed",
            });
          const before = [...target.roles];
          target.roles = target.roles.filter((key) => key !== targetRole.key);
          getDemoStore().appendAudit({
            actorEmployeeId: ctx.employeeId!,
            action: "admin.roles.revokeEmployee",
            entityType: "employee",
            entityId: input.employeeId,
            before: { roles: before },
            after: { roles: target.roles },
            reason: input.reason,
          });
          return { ok: true as const };
        }
        return db.transaction(async (tx) => {
          const [targetRole] = await tx.execute<{ key: string }>(sql`
            select key from public.role where role_id = ${input.roleId}::uuid
          `);
          if (!targetRole) throw new TRPCError({ code: "NOT_FOUND" });
          const [membership] = await tx.execute<{ employeeRoleId: string }>(sql`
            select employee_role_id as "employeeRoleId"
            from public.employee_role
            where employee_id = ${input.employeeId}::uuid
              and role_id = ${input.roleId}::uuid
            for update
          `);
          if (!membership) throw new TRPCError({ code: "NOT_FOUND" });
          if (targetRole.key === "partner") {
            await tx.execute(sql`
              select pg_advisory_xact_lock(hashtext('employee_role:partner'))
            `);
            const [partners] = await tx.execute<{ count: number }>(sql`
              select count(distinct membership.employee_id)::int as count
              from public.employee_role membership
              join public.role role on role.role_id = membership.role_id
              join public.employee employee on employee.employee_id = membership.employee_id
              where role.key = 'partner' and employee.is_active = true
            `);
            if (Number(partners?.count ?? 0) <= 1)
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "The final active Partner role cannot be removed",
              });
          }
          const removed = await tx.execute(sql`
            delete from public.employee_role
            where employee_id = ${input.employeeId}::uuid
              and role_id = ${input.roleId}::uuid
            returning employee_role_id
          `);
          if (!removed[0]) throw new TRPCError({ code: "NOT_FOUND" });
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "admin.roles.revokeEmployee",
            entityType: "employee",
            entityId: input.employeeId,
            before: { roleId: input.roleId, roleKey: targetRole.key },
            after: null,
            reason: input.reason,
          });
          return { ok: true as const };
        });
      }),
  }),
  permissions: router({
    list: staffProcedure
      .use(requirePermission("role", "view"))
      .query(async ({ ctx }) => {
        const db = getDb();
        const policies = db
          ? await db
              .select({
                role: role.key,
                resource: permissionPolicy.resource,
                action: permissionPolicy.action,
                effect: permissionPolicy.effect,
              })
              .from(permissionPolicy)
              .innerJoin(role, eq(permissionPolicy.roleId, role.roleId))
          : [
              {
                role: "am",
                resource: "margin",
                action: "view",
                effect: "deny",
              },
              {
                role: "partner",
                resource: "margin",
                action: "view",
                effect: "allow",
              },
              {
                role: "finance",
                resource: "margin",
                action: "view",
                effect: "allow",
              },
              {
                role: "am",
                resource: "deal",
                action: "transition",
                effect: "allow",
              },
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
      .input(
        z
          .object({
            limit: z.number().min(1).max(100).optional(),
            action: z.string().trim().max(120).optional(),
            entityType: z.string().trim().max(120).optional(),
          })
          .optional(),
      )
      .query(({ input }) =>
        listAudit({
          limit: input?.limit ?? 25,
          action: input?.action || undefined,
          entityType: input?.entityType || undefined,
        }),
      ),
  }),
  health: router({
    get: staffProcedure
      .use(requirePermission("health", "view"))
      .query(async () => {
        const db = getDb();
        const [cap] = db
          ? await db
              .select({ payload: convention.payload })
              .from(convention)
              .where(
                and(
                  eq(convention.ruleKey, "llm.spend_cap"),
                  eq(convention.isActive, true),
                ),
              )
              .limit(1)
          : [];
        return {
          ok: true as const,
          signals: await listHealthSignals(10),
          spendCaps: {
            llmMonthlyAed:
              cap?.payload.monthlyAed ??
              (Number(process.env.LLM_MONTHLY_CAP_AED ?? 0) || null),
          },
          chatWebhookConfigured: Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL),
        };
      }),
    sendTest: staffProcedure
      .use(requirePermission("health", "manage"))
      .input(
        z.object({
          signalKey: z
            .enum([
              "gate_blocked",
              "auth_denied",
              "dam_upload",
              "spend_cap",
              "job_lag",
              "m1_test",
            ])
            .default("m1_test"),
          severity: z.enum(["info", "warn", "critical"]).default("info"),
        }),
      )
      .mutation(async ({ input }) => {
        const row = await emitHealthSignal(input.signalKey, input.severity, {
          source: "admin.health.sendTest",
        });
        const webhookConfigured = Boolean(
          process.env.GOOGLE_CHAT_WEBHOOK_URL?.trim(),
        );
        return {
          ...row,
          chat: row.deliveryStatus,
          webhookConfigured,
        };
      }),
  }),
  jobs: router({
    list: staffProcedure
      .use(requirePermission("health", "view"))
      .query(async () => {
        const db = getDb();
        if (!db) return [];
        const rows = await db
          .select({
            scheduledJobId: scheduledJob.scheduledJobId,
            kind: scheduledJob.kind,
            runAt: scheduledJob.runAt,
            status: scheduledJob.status,
            attempts: scheduledJob.attempts,
            lockedAt: scheduledJob.lockedAt,
            completedAt: scheduledJob.completedAt,
            createdAt: scheduledJob.createdAt,
            updatedAt: scheduledJob.updatedAt,
          })
          .from(scheduledJob)
          .orderBy(desc(scheduledJob.createdAt))
          .limit(20);
        return rows.map((row) => ({
          ...row,
          runAt: row.runAt.toISOString(),
          lockedAt: row.lockedAt?.toISOString() ?? null,
          completedAt: row.completedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }));
      }),
    scheduleHealth: staffProcedure
      .use(requirePermission("health", "manage"))
      .input(
        z.object({
          delayMinutes: z.number().int().min(1).max(10_080),
          signalKey: z.string().min(1).max(120),
          severity: z.enum(["info", "warn", "critical"]).default("info"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        if (!db) throw new Error("DATABASE_URL is required for scheduled jobs");
        const runAt = new Date(Date.now() + input.delayMinutes * 60_000);
        return db.transaction(async (tx) => {
          const [job] = await tx
            .insert(scheduledJob)
            .values({
              jobKey: randomUUID(),
              kind: "health_signal",
              runAt,
              payload: {
                signalKey: input.signalKey,
                severity: input.severity,
                payload: { source: "admin.jobs.scheduleHealth" },
              },
            })
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "scheduledJob.create",
            entityType: "scheduled_job",
            entityId: job!.scheduledJobId,
            after: { kind: job!.kind, runAt: runAt.toISOString() },
          });
          return job!;
        });
      }),
  }),
});

const healthSignalKey = z.enum([
  "gate_blocked",
  "auth_denied",
  "dam_upload",
  "spend_cap",
  "job_lag",
]);

const conventionRuleKey = z.enum([
  "health.signals",
  "margin.floor",
  "llm.spend_cap",
  "portal.allowed_contacts",
]);

function validateConventionPayload(
  ruleKey: z.infer<typeof conventionRuleKey>,
  payload: Record<string, unknown>,
) {
  try {
    if (ruleKey === "health.signals")
      return z
        .object({ signals: z.array(healthSignalKey).min(1) })
        .strict()
        .parse(payload);
    if (ruleKey === "margin.floor")
      return z
        .object({
          floorPct: z.number().min(0).max(100),
          targetPct: z.number().min(0).max(100),
        })
        .strict()
        .refine((value) => value.targetPct >= value.floorPct, {
          message: "targetPct must be greater than or equal to floorPct",
        })
        .parse(payload);
    if (ruleKey === "llm.spend_cap")
      return z
        .object({ monthlyAed: z.number().positive().max(1_000_000_000) })
        .strict()
        .parse(payload);
    if (ruleKey === "portal.allowed_contacts")
      return z
        .object({ contacts: z.record(z.string().email(), z.string().uuid()) })
        .strict()
        .parse(payload);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unsupported convention rule: ${ruleKey}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.issues.map((issue) => issue.message).join("; "),
      });
    throw error;
  }
}

export const conventionsRouter = router({
  list: staffProcedure
    .input(z.object({ ruleKey: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      if (db) {
        return db
          .select()
          .from(convention)
          .where(
            input?.ruleKey
              ? and(
                  eq(convention.isActive, true),
                  eq(convention.ruleKey, input.ruleKey),
                )
              : eq(convention.isActive, true),
          )
          .orderBy(convention.ruleKey);
      }
      const rows = [...getDemoStore().conventions.values()];
      if (input?.ruleKey)
        return rows.filter((r) => r.ruleKey === input.ruleKey);
      return rows.sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
    }),
  upsert: protectedProcedure
    .use(requirePermission("convention", "edit"))
    .input(
      z.object({
        ruleKey: conventionRuleKey,
        payload: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const payload = validateConventionPayload(input.ruleKey, input.payload);
      const db = getDb();
      if (db) {
        return db.transaction(async (tx) => {
          const [previous] = await tx
            .select()
            .from(convention)
            .where(eq(convention.ruleKey, input.ruleKey))
            .orderBy(desc(convention.version))
            .limit(1);
          await tx
            .update(convention)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
              and(
                eq(convention.ruleKey, input.ruleKey),
                eq(convention.isActive, true),
              ),
            );
          const [next] = await tx
            .insert(convention)
            .values({
              ruleKey: input.ruleKey,
              version: String(Number(previous?.version ?? 0) + 1),
              payload,
            })
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "convention.upsert",
            entityType: "convention",
            entityId: next!.conventionId,
            before: previous
              ? { version: previous.version, payload: previous.payload }
              : null,
            after: { version: next!.version, payload: next!.payload },
          });
          return next!;
        });
      }
      const store = getDemoStore();
      const prev = store.conventions.get(input.ruleKey);
      const next = {
        ruleKey: input.ruleKey,
        version: (prev?.version ?? 0) + 1,
        payload,
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

const ASSET_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const safeAssetFileName = (fileName: string) =>
  fileName.replace(/[^a-zA-Z0-9._-]/g, "-");

type AssetProjectScope = { projectId: string; clientId: string | null };

export function selectAssetProjectScopes(
  scopes: AssetProjectScope[],
  selection: {
    projectId?: string;
    clientScope?: { clientId: string | null };
    requireSingleClient?: boolean;
  } = {},
) {
  if (selection.projectId) {
    const selected = scopes.filter(
      (scope) => scope.projectId === selection.projectId,
    );
    if (!selected.length) throw new TRPCError({ code: "NOT_FOUND" });
    return selected;
  }
  if (selection.clientScope) {
    const selected = scopes.filter(
      (scope) => scope.clientId === selection.clientScope!.clientId,
    );
    if (!selected.length) throw new TRPCError({ code: "NOT_FOUND" });
    return selected;
  }
  if (
    selection.requireSingleClient &&
    new Set(scopes.map((scope) => scope.clientId ?? "organization")).size > 1
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Select a project before using assets on a task shared across client scopes",
    });
  if (!scopes.length) throw new TRPCError({ code: "NOT_FOUND" });
  return scopes;
}

async function requireAssetWorkScope(
  ctx: TrpcContext,
  workItemId: string,
  minimum: "viewer" | "editor" = "viewer",
  selection: {
    projectId?: string;
    clientScope?: { clientId: string | null };
    requireSingleClient?: boolean;
  } = {},
) {
  const db = getDb();
  const scopes: AssetProjectScope[] = db
    ? await db.execute<AssetProjectScope>(sql`
        select membership.work_project_id as "projectId",
          project.client_id as "clientId"
        from public.work_project_item membership
        join public.work_project project
          on project.work_project_id = membership.work_project_id
        where membership.work_item_id = ${workItemId}::uuid
          and project.archived_at is null
      `)
    : (() => {
        const item = getDemoWork().items.get(workItemId);
        const project = item
          ? getDemoWork().projects.get(item.projectId)
          : undefined;
        return item && project
          ? [{ projectId: project.projectId, clientId: project.clientId }]
          : [];
      })();
  const candidates = selectAssetProjectScopes(scopes, selection);
  for (const candidate of candidates) {
    try {
      await requireProjectAccess(ctx, candidate.projectId, minimum);
      return candidate;
    } catch (error) {
      if (
        error instanceof TRPCError &&
        (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
      )
        continue;
      throw error;
    }
  }
  throw new TRPCError({ code: "NOT_FOUND" });
}

function decodeAssetBody(contentBase64: string, contentType: string) {
  if (contentBase64.length % 4 !== 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Asset content is not valid Base64",
    });
  const padding = contentBase64.endsWith("==")
    ? 2
    : contentBase64.endsWith("=")
      ? 1
      : 0;
  if ((contentBase64.length / 4) * 3 - padding > 10_000_000)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Asset versions are limited to 10 MB",
    });
  const raw = Buffer.from(contentBase64, "base64");
  if (raw.toString("base64") !== contentBase64)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Asset content is not valid Base64",
    });
  const ascii = (start: number, end: number) =>
    raw.subarray(start, end).toString("ascii");
  const signatureMatches =
    (contentType === "application/pdf" && ascii(0, 5) === "%PDF-") ||
    (contentType === "image/gif" &&
      ["GIF87a", "GIF89a"].includes(ascii(0, 6))) ||
    (contentType === "image/jpeg" &&
      raw[0] === 0xff &&
      raw[1] === 0xd8 &&
      raw[2] === 0xff) ||
    (contentType === "image/png" &&
      raw.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
    (contentType === "image/webp" &&
      ascii(0, 4) === "RIFF" &&
      ascii(8, 12) === "WEBP");
  if (!signatureMatches)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Asset bytes do not match the declared file type",
    });
  return raw;
}

async function requireAssetAccess(
  ctx: TrpcContext,
  assetId: string,
  minimum: "viewer" | "editor" = "viewer",
) {
  const db = getDb();
  if (!db) {
    const row = getDemoStore().assets.get(assetId);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (!row.workItemId) throw new TRPCError({ code: "NOT_FOUND" });
    await requireAssetWorkScope(ctx, row.workItemId, minimum, {
      clientScope: { clientId: row.clientId },
    });
    return row;
  }
  const [row] = await db
    .select({
      assetId: asset.assetId,
      workItemId: asset.workItemId,
      clientId: asset.clientId,
    })
    .from(asset)
    .where(eq(asset.assetId, assetId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  if (!row.workItemId) throw new TRPCError({ code: "NOT_FOUND" });
  await requireAssetWorkScope(ctx, row.workItemId, minimum, {
    clientScope: { clientId: row.clientId },
  });
  return row;
}

export const assetsRouter = router({
  create: staffProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        workItemId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const scope = await requireAssetWorkScope(
        ctx,
        input.workItemId,
        "editor",
        input.projectId
          ? { projectId: input.projectId }
          : { requireSingleClient: true },
      );
      const db = getDb();
      if (db) {
        return db.transaction(async (tx) => {
          const [created] = await tx
            .insert(asset)
            .values({
              title: input.title,
              workItemId: input.workItemId,
              clientId: scope?.clientId ?? null,
            })
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "assets.create",
            entityType: "asset",
            entityId: created!.assetId,
            after: {
              title: created!.title,
              workItemId: created!.workItemId,
              clientId: created!.clientId,
            },
          });
          return { ...created!, versions: [] };
        });
      }
      const store = getDemoStore();
      const demoAsset = store.createAsset(
        input.title,
        scope.clientId,
        null,
        input.workItemId,
      );
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "assets.create",
        entityType: "asset",
        entityId: demoAsset.assetId,
        before: null,
        after: {
          title: demoAsset.title,
          workItemId: demoAsset.workItemId,
          clientId: demoAsset.clientId,
        },
        reason: null,
      });
      return demoAsset;
    }),
  uploadVersion: staffProcedure
    .input(
      z.object({
        assetId: z.string().uuid(),
        fileName: z.string().trim().min(1).max(180),
        contentType: z
          .string()
          .refine((value) => ASSET_CONTENT_TYPES.has(value), {
            message: "Only PNG, JPEG, WebP, GIF and PDF assets are supported",
          }),
        contentBase64: z.string().min(1).max(15_000_000),
        isClientRevision: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireAssetAccess(ctx, input.assetId, "editor");
      const raw = decodeAssetBody(input.contentBase64, input.contentType);
      const fileName = safeAssetFileName(input.fileName);
      const db = getDb();
      if (db) {
        let storagePath: string | null = null;
        let versionNumber = 0;
        let version: typeof assetVersion.$inferSelect | null = null;
        try {
          version = await db.transaction(async (tx) => {
            const [locked] = await tx.execute<{
              status: string;
              approvedVersionId: string | null;
            }>(sql`
              select status, approved_version_id as "approvedVersionId"
              from public.asset
              where asset_id = ${input.assetId}::uuid
              for update
            `);
            if (!locked) throw new TRPCError({ code: "NOT_FOUND" });
            const [latest] = await tx
              .select({
                version: sql<number>`coalesce(max(${assetVersion.versionNumber}), 0)::int`,
              })
              .from(assetVersion)
              .where(eq(assetVersion.assetId, input.assetId));
            versionNumber = Number(latest?.version ?? 0) + 1;
            storagePath = `dam/${input.assetId}/v${versionNumber}-${fileName}`;
            await getDemoStore().objectStore.put({
              path: storagePath,
              body: new Uint8Array(raw),
              contentType: input.contentType,
            });
            const [created] = await tx
              .insert(assetVersion)
              .values({
                assetId: input.assetId,
                storagePath: storagePath!,
                versionNumber: String(versionNumber),
                isClientRevision: input.isClientRevision ?? false,
                uploadedByEmployeeId: ctx.employeeId,
              })
              .returning();
            await tx
              .update(asset)
              .set({
                status: "draft",
                approvedVersionId: null,
                updatedAt: new Date(),
              })
              .where(eq(asset.assetId, input.assetId));
            await tx.insert(auditEvent).values({
              actorEmployeeId: ctx.employeeId,
              action: "assets.uploadVersion",
              entityType: "asset",
              entityId: input.assetId,
              before: {
                status: locked.status,
                approvedVersionId: locked.approvedVersionId,
              },
              after: {
                assetVersionId: created!.assetVersionId,
                storagePath,
                versionNumber,
                status: "draft",
                approvedVersionId: null,
              },
            });
            return created!;
          });
        } catch (error) {
          if (storagePath)
            await getDemoStore().objectStore.remove?.(storagePath);
          throw error;
        }
        await emitHealthSignal("dam_upload", "info", {
          assetId: input.assetId,
          versionNumber,
        });
        return { ...version!, versionNumber };
      }
      const version = await getDemoStore().uploadVersion({
        assetId: input.assetId,
        contentBase64: input.contentBase64,
        contentType: input.contentType,
        fileName,
        employeeId: ctx.employeeId,
        isClientRevision: input.isClientRevision,
      });
      getDemoStore().pushHealth("dam_upload", "info", {
        assetId: input.assetId,
        versionNumber: version.versionNumber,
      });
      return version;
    }),
  get: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await requireAssetAccess(ctx, input.id);
      const db = getDb();
      if (!db) return getDemoStore().assets.get(input.id) ?? null;
      const [row] = await db
        .select()
        .from(asset)
        .where(eq(asset.assetId, input.id))
        .limit(1);
      if (!row) return null;
      const versions = await db
        .select()
        .from(assetVersion)
        .where(eq(assetVersion.assetId, input.id))
        .orderBy(assetVersion.versionNumber);
      return {
        ...row,
        versions: versions.map((version) => ({
          ...version,
          versionNumber: Number(version.versionNumber),
        })),
      };
    }),
  signedUrl: staffProcedure
    .input(
      z.object({
        assetId: z.string().uuid(),
        versionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireAssetAccess(ctx, input.assetId);
      const db = getDb();
      if (db) {
        const [version] = await db
          .select()
          .from(assetVersion)
          .where(
            and(
              eq(assetVersion.assetId, input.assetId),
              eq(assetVersion.assetVersionId, input.versionId),
            ),
          )
          .limit(1);
        if (!version) return null;
        const ttl = 300;
        const signed = await getDemoStore().objectStore.signedUrl(
          version.storagePath,
          ttl,
        );
        await writeAudit({
          actorEmployeeId: ctx.employeeId,
          action: "assets.signedUrl",
          entityType: "asset_version",
          entityId: version.assetVersionId,
          before: null,
          after: { path: version.storagePath, expiresAt: signed.expiresAt },
          reason: null,
        });
        return signed;
      }
      const asset = getDemoStore().assets.get(input.assetId);
      if (!asset) return null;
      const version = asset.versions.find(
        (v) => v.assetVersionId === input.versionId,
      );
      if (!version) return null;
      const ttl = 300;
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
  list: staffProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const scope = await requireAssetWorkScope(
        ctx,
        input.workItemId,
        "viewer",
        input.projectId
          ? { projectId: input.projectId }
          : { requireSingleClient: true },
      );
      const db = getDb();
      if (!db)
        return [...getDemoStore().assets.values()].filter(
          (row) =>
            row.workItemId === input.workItemId &&
            row.clientId === scope.clientId,
        );
      const [assets, versions] = await Promise.all([
        db
          .select()
          .from(asset)
          .where(
            and(
              eq(asset.workItemId, input.workItemId),
              sql`${asset.clientId} is not distinct from ${scope.clientId}`,
            ),
          )
          .orderBy(desc(asset.createdAt)),
        db.select().from(assetVersion).orderBy(assetVersion.versionNumber),
      ]);
      return assets.map((row) => ({
        ...row,
        versions: versions
          .filter((version) => version.assetId === row.assetId)
          .map((version) => ({
            ...version,
            versionNumber: Number(version.versionNumber),
          })),
      }));
    }),
  qc: staffProcedure
    .input(
      z
        .object({
          id: z.string().uuid(),
          decision: z.enum(["pass", "fail", "waive"]),
          notes: z.string().trim().max(1_000).optional(),
        })
        .superRefine((input, ctx) => {
          if (
            (input.decision === "fail" || input.decision === "waive") &&
            !input.notes
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["notes"],
              message: "Notes are required when QC fails or is waived",
            });
        }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireAssetAccess(ctx, input.id, "editor");
      const isCd =
        ctx.roles.includes("creative_director") ||
        ctx.roles.includes("partner") ||
        ctx.roles.includes("director");
      if (!isCd) {
        await writeAudit({
          actorEmployeeId: ctx.employeeId,
          action: "assets.qc.blocked",
          entityType: "asset",
          entityId: input.id,
          before: null,
          after: { decision: input.decision },
          reason: "Only Creative Director, Director or Partner may QC assets",
        });
        await emitHealthSignal("gate_blocked", "warn", {
          gate: "asset.qc_role",
          assetId: input.id,
          actorEmployeeId: ctx.employeeId,
        });
        return {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          reason: "Only Creative Director may QC assets",
        };
      }
      const db = getDb();
      const hasVersion = db
        ? Boolean(
            (
              await db
                .select({ assetVersionId: assetVersion.assetVersionId })
                .from(assetVersion)
                .where(eq(assetVersion.assetId, input.id))
                .limit(1)
            )[0],
          )
        : Boolean(getDemoStore().assets.get(input.id)?.versions.length);
      if (!hasVersion) {
        await writeAudit({
          actorEmployeeId: ctx.employeeId,
          action: "assets.qc.blocked",
          entityType: "asset",
          entityId: input.id,
          before: null,
          after: { decision: input.decision },
          reason: "At least one asset version is required before QC",
        });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Upload an asset version before QC",
        });
      }
      if (db) {
        return db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(asset)
            .where(eq(asset.assetId, input.id))
            .limit(1);
          if (!existing) throw new Error("NOT_FOUND");
          const [latest] = await tx
            .select({ assetVersionId: assetVersion.assetVersionId })
            .from(assetVersion)
            .where(eq(assetVersion.assetId, input.id))
            .orderBy(desc(assetVersion.createdAt))
            .limit(1);
          const qcPassed =
            input.decision === "pass" || input.decision === "waive";
          const [updated] = await tx
            .update(asset)
            .set({
              status:
                input.decision === "fail" ? "internal_review" : "qc_passed",
              approvedVersionId: qcPassed
                ? (latest?.assetVersionId ?? null)
                : null,
              updatedAt: new Date(),
            })
            .where(eq(asset.assetId, input.id))
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "assets.qc",
            entityType: "asset",
            entityId: input.id,
            before: {
              status: existing.status,
              approvedVersionId: existing.approvedVersionId,
            },
            after: {
              decision: input.decision,
              qcPassed,
              status: updated!.status,
              approvedVersionId: updated!.approvedVersionId,
            },
            reason: input.notes ?? null,
          });
          return { ok: true as const, asset: updated! };
        });
      }
      const store = getDemoStore();
      const demoAsset = store.assets.get(input.id);
      if (!demoAsset) throw new Error("NOT_FOUND");
      const before = {
        status: demoAsset.status,
        qcPassed: demoAsset.qcPassed,
      };
      demoAsset.qcPassed =
        input.decision === "pass" || input.decision === "waive";
      demoAsset.approvedVersionId = demoAsset.qcPassed
        ? (demoAsset.versions.at(-1)?.assetVersionId ?? null)
        : null;
      demoAsset.status =
        input.decision === "fail"
          ? "internal_review"
          : input.decision === "pass" || input.decision === "waive"
            ? "qc_passed"
            : demoAsset.status;
      if (demoAsset.taskId) {
        const task = store.tasks.get(demoAsset.taskId);
        if (task) {
          task.qcPassed = demoAsset.qcPassed;
          if (demoAsset.qcPassed) task.status = "qc";
        }
      }
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "assets.qc",
        entityType: "asset",
        entityId: demoAsset.assetId,
        before,
        after: { decision: input.decision, qcPassed: demoAsset.qcPassed },
        reason: input.notes ?? null,
      });
      return { ok: true as const, asset: demoAsset };
    }),
});

export {
  dealsRouter,
  scopesRouter,
  clientsRouter,
  outreachRouter,
  leadsRouter,
};

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

/** Portal actors can only reach `portal.*` paths (portalStaffBoundary), so
 * client-facing routers must merge into this namespace, never top-level. */
export const portalRouter = mergeRouters(
  m6PortalRouter,
  router({ campaignApprovals: portalApprovalsRouter }),
);

export const appRouter = router({
  auth: authRouter,
  admin: adminRouter,
  conventions: conventionsRouter,
  connections: connectionsRouter,
  featureRequests: featureRequestsRouter,
  coreHr: coreHrRouter,
  hrOperations: hrOperationsRouter,
  talent: talentRouter,
  workforcePayroll: payrollV2Router,
  workplace: workplaceRouter,
  shiftsTimesheets: shiftsTimesheetsRouter,
  benefits: benefitsReportingRouter,
  aiCustomApps: aiCustomAppsRouter,
  digitalCards: digitalCardsRouter,
  work: workManagementRouter,
  workAdmin: workAdminRouter,
  workAi: workAiRouter,
  workAiStudio: workAiStudioRouter,
  workAiTeammates: workAiTeammatesRouter,
  asanaMigration: asanaMigrationRouter,
  clientPreview: clientPreviewRouter,
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
  aiAdmin: aiAdminRouter,
  campaigns: campaignsRouter,
  analytics: analyticsRouter,
  leadgen: leadgenRouter,
  scorecards: scorecardsRouter,
  aiPolicy: aiPolicyRouter,
  peopleRecon: peopleReconRouter,
  reports: reportsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
