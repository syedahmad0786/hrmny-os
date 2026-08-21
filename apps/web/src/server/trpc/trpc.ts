import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import {
  getAuthMode,
  resolveDevUser,
  resolveSupabaseUser,
  sessionCanViewMargin,
  sessionHas,
  type SessionUser,
} from "../auth/session";
import { resolvePortalSessionGrant } from "../auth/portal-magic-link";
import { emitHealthSignal } from "../m1-persistence";
import { featureForTrpcPath } from "@/features/catalog";
import { featureEnabled } from "../features";
import { isWorkViewOnlyMember } from "../work-governance";

export type TrpcContext = {
  user: SessionUser | null;
  employeeId: string | null;
  roles: string[];
  canViewMargin: boolean;
  /** Set when actorType is portal (app-layer RLS). */
  clientId?: string | null;
  /** Internal-only context used to propagate a published bundle. */
  workBundleRollout?: { bundleId: string };
  /** Feature selected from the current tRPC path for resource-scope checks. */
  requestedFeatureKey?: string | null;
};

export async function createContext(
  opts?: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const headers = opts?.req.headers;
  const mode = getAuthMode();

  const portalGrant = headers?.get("x-portal-grant")?.trim();
  if (portalGrant) {
    const granted = await resolvePortalSessionGrant(portalGrant);
    if (granted) {
      return {
        user: granted,
        employeeId: granted.employeeId,
        roles: granted.roles,
        canViewMargin: false,
        clientId: granted.clientId,
      };
    }
  }

  if (mode === "dev") {
    const role =
      headers?.get("x-dev-role") ?? headers?.get("x-hrmny-role") ?? "partner";
    const user = resolveDevUser(role);
    return {
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
      clientId: user.clientId,
    };
  }

  const authHeader = headers?.get("authorization");
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader?.trim() ?? "");
  if (!match) {
    return { user: null, employeeId: null, roles: [], canViewMargin: false };
  }
  const user = await resolveSupabaseUser(match[1]!);
  if (!user) {
    return { user: null, employeeId: null, roles: [], canViewMargin: false };
  }
  return {
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  };
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;

async function recordAuthDenied(
  path: string,
  reason: string,
  employeeId: string | null,
) {
  try {
    await emitHealthSignal("auth_denied", "warn", {
      path,
      reason,
      employeeId,
    });
  } catch {
    // Authorization must still fail closed if the alert channel is unavailable.
  }
}

const isAuthed = t.middleware(async ({ ctx, next, path }) => {
  if (!ctx.user) {
    await recordAuthDenied(path, "unauthenticated", null);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "UNAUTHENTICATED" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      employeeId: ctx.user.employeeId,
      clientId: ctx.user.clientId,
    },
  });
});

/** Portal sessions may only call portal.* (no finance/staff leakage). */
const portalStaffBoundary = t.middleware(async ({ ctx, next, path }) => {
  if (ctx.user?.actorType === "portal" && !path.startsWith("portal.")) {
    await recordAuthDenied(path, "portal_staff_boundary", ctx.employeeId);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: portal cannot access staff APIs",
    });
  }
  return next({ ctx });
});

const requireEnabledFeature = t.middleware(async ({ ctx, next, path }) => {
  const featureKey = featureForTrpcPath(path);
  if (
    featureKey &&
    ctx.user &&
    !(await featureEnabled(featureKey, {
      userId: ctx.user.employeeId,
      clientId: ctx.user.clientId,
      roles: ctx.user.roles,
    }))
  ) {
    await recordAuthDenied(path, `feature:${featureKey}`, ctx.employeeId);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `FEATURE_DISABLED:${featureKey}`,
    });
  }
  return next({ ctx: { ...ctx, requestedFeatureKey: featureKey } });
});

export const protectedProcedure = t.procedure
  .use(isAuthed)
  .use(portalStaffBoundary)
  .use(requireEnabledFeature);

/** Staff-only — portal actors cannot call finance / margin / payroll APIs. */
const requireStaff = t.middleware(async ({ ctx, next, path }) => {
  if (!ctx.user || ctx.user.actorType === "portal") {
    await recordAuthDenied(path, "staff_only", ctx.employeeId);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: portal cannot access staff APIs",
    });
  }
  return next({ ctx });
});

const requireWorkWriteLicense = t.middleware(
  async ({ ctx, next, path, type }) => {
    if (
      type === "mutation" &&
      path.startsWith("work.") &&
      (await isWorkViewOnlyMember(ctx.employeeId))
    ) {
      await recordAuthDenied(path, "work_view_only", ctx.employeeId);
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "FORBIDDEN: Work access is view-only",
      });
    }
    return next({ ctx });
  },
);

export const staffProcedure = protectedProcedure
  .use(requireStaff)
  .use(requireWorkWriteLicense);

/** Portal-only — requires bound clientId (app-layer RLS scope). */
const requirePortal = t.middleware(async ({ ctx, next, path }) => {
  if (!ctx.user || ctx.user.actorType !== "portal" || !ctx.user.clientId) {
    await recordAuthDenied(path, "portal_only", ctx.employeeId);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: portal session with client_id required",
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      clientId: ctx.user.clientId,
    },
  });
});

export const portalProcedure = protectedProcedure.use(requirePortal);

export function requirePermission(resource: string, action: string) {
  return t.middleware(async ({ ctx, next, path }) => {
    if (!ctx.user || !sessionHas(ctx.user, resource, action)) {
      await recordAuthDenied(
        path,
        `permission:${resource}:${action}`,
        ctx.employeeId,
      );
      throw new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN" });
    }
    return next({ ctx });
  });
}

export function requireMarginView() {
  return t.middleware(async ({ ctx, next, path }) => {
    if (!ctx.user || ctx.user.actorType === "portal" || !ctx.canViewMargin) {
      await recordAuthDenied(path, "margin_view", ctx.employeeId);
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "FORBIDDEN: margin_view denied for role",
      });
    }
    return next({ ctx });
  });
}
