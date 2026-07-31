import { TRPCError } from "@trpc/server";
import { client, clientPortalUser, employee, role, sql } from "@hrmny/db";
import { z } from "zod";
import { FEATURE_BY_KEY, FEATURE_CATALOG } from "@/features/catalog";
import { DEV_USERS } from "../auth/session";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import {
  listFeatureOverrides,
  removeFeatureOverride,
  resolveFeatureCatalog,
  setFeatureOverride,
  type FeatureScope,
} from "../features";
import { requirePermission, router, staffProcedure } from "./trpc";

const featureAdminProcedure = staffProcedure.use(
  requirePermission("admin", "features"),
);
const scopeSchema = z.enum(["global", "client", "role", "user"]);
const overrideInput = z.object({
  featureKey: z.string().trim().min(1).max(160),
  scopeType: scopeSchema,
  scopeKey: z.string().trim().min(1).max(160),
});

async function assertTarget(scopeType: FeatureScope, scopeKey: string) {
  if (scopeType === "global") {
    if (scopeKey !== "global") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid global scope",
      });
    }
    return;
  }

  const db = getDb();
  if (!db) return;
  if (scopeType === "client") {
    const rows = await db.execute(sql`
      select 1 from public.client where client_id = ${scopeKey}::uuid limit 1
    `);
    if (!rows[0])
      throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
    return;
  }
  if (scopeType === "role") {
    const rows = await db.execute(sql`
      select 1 from public.role where key = ${scopeKey} limit 1
    `);
    if (!rows[0])
      throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });
    return;
  }
  const rows = await db.execute(sql`
    select 1 from public.employee where employee_id = ${scopeKey}::uuid
    union all
    select 1 from public.client_portal_user
      where client_portal_user_id = ${scopeKey}::uuid
    limit 1
  `);
  if (!rows[0])
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
}

async function targets() {
  const db = getDb();
  if (!db) {
    return {
      clients: [...getDemoStore().clients.values()].map((item) => ({
        key: item.clientId,
        label: item.name,
      })),
      roles: getDemoStore().roles.map((item) => ({
        key: item.key,
        label: item.displayName,
      })),
      users: Object.values(DEV_USERS).map((item) => ({
        key: item.employeeId,
        label: `${item.displayName} · ${item.email}`,
      })),
    };
  }

  const [clients, roles, staff, portal] = await Promise.all([
    db.select({ key: client.clientId, label: client.name }).from(client),
    db.select({ key: role.key, label: role.displayName }).from(role),
    db
      .select({ key: employee.employeeId, label: employee.displayName })
      .from(employee),
    db
      .select({
        key: clientPortalUser.clientPortalUserId,
        label: clientPortalUser.displayName,
      })
      .from(clientPortalUser),
  ]);
  return {
    clients,
    roles,
    users: [
      ...staff.map((item) => ({ ...item, label: `${item.label} · staff` })),
      ...portal.map((item) => ({ ...item, label: `${item.label} · portal` })),
    ],
  };
}

async function subjectForTarget(scopeType: FeatureScope, scopeKey: string) {
  await assertTarget(scopeType, scopeKey);
  if (scopeType === "global") return {};
  if (scopeType === "client") return { clientId: scopeKey };
  if (scopeType === "role") return { roles: [scopeKey] };

  const db = getDb();
  if (!db) {
    const user = Object.values(DEV_USERS).find(
      (candidate) => candidate.employeeId === scopeKey,
    );
    return {
      userId: scopeKey,
      clientId: user?.clientId ?? null,
      roles: user?.roles ?? [],
    };
  }
  const [roles, portal] = await Promise.all([
    db.execute<{ role_key: string }>(sql`
      select role.key as role_key
      from public.employee_role membership
      join public.role role on role.role_id = membership.role_id
      where membership.employee_id = ${scopeKey}::uuid
    `),
    db.execute<{ client_id: string }>(sql`
      select client_id
      from public.client_portal_user
      where client_portal_user_id = ${scopeKey}::uuid
      limit 1
    `),
  ]);
  return {
    userId: scopeKey,
    clientId: portal[0]?.client_id ?? null,
    roles: roles.map((item) => item.role_key),
  };
}

export const featureLabRouter = router({
  list: featureAdminProcedure.query(async ({ ctx }) => {
    const overrides = await listFeatureOverrides();
    return {
      catalog: FEATURE_CATALOG,
      overrides,
      resolvedForViewer: resolveFeatureCatalog(overrides, {
        userId: ctx.employeeId,
        clientId: ctx.clientId,
        roles: ctx.roles,
      }),
      targets: await targets(),
    };
  }),

  resolve: featureAdminProcedure
    .input(
      z.object({
        scopeType: scopeSchema,
        scopeKey: z.string().min(1).max(160),
      }),
    )
    .query(async ({ input }) =>
      resolveFeatureCatalog(
        await listFeatureOverrides(),
        await subjectForTarget(input.scopeType, input.scopeKey),
      ),
    ),

  setOverride: featureAdminProcedure
    .input(
      overrideInput.extend({
        enabled: z.boolean(),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const definition = FEATURE_BY_KEY.get(input.featureKey);
      if (!definition) throw new TRPCError({ code: "NOT_FOUND" });
      await assertTarget(input.scopeType, input.scopeKey);
      try {
        return await setFeatureOverride({
          ...input,
          updatedByEmployeeId: ctx.employeeId,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Feature override failed",
        });
      }
    }),

  removeOverride: featureAdminProcedure
    .input(overrideInput)
    .mutation(async ({ input, ctx }) => {
      await assertTarget(input.scopeType, input.scopeKey);
      await removeFeatureOverride({
        ...input,
        updatedByEmployeeId: ctx.employeeId!,
        reason: "Return to inherited access",
      });
      return { ok: true as const };
    }),
});
