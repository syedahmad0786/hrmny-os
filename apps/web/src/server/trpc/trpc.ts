import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import {
  getAuthMode,
  resolveDevUser,
  sessionCanViewMargin,
  sessionHas,
  type SessionUser,
} from "../auth/session";

export type TrpcContext = {
  user: SessionUser | null;
  employeeId: string | null;
  roles: string[];
  canViewMargin: boolean;
  /** Set when actorType is portal (app-layer RLS). */
  clientId?: string | null;
};

export async function createContext(
  opts?: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const headers = opts?.req.headers;
  const mode = getAuthMode();

  if (mode === "dev") {
    const role =
      headers?.get("x-dev-role") ??
      headers?.get("x-hrmny-role") ??
      "partner";
    const user = resolveDevUser(role);
    return {
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
      clientId: user.clientId,
    };
  }

  // Supabase mode: expect Authorization Bearer; full session resolve lands with live project.
  // Until wired, fall back to anonymous (forces protectedProcedure to fail closed).
  const authHeader = headers?.get("authorization");
  if (!authHeader) {
    return { user: null, employeeId: null, roles: [], canViewMargin: false };
  }

  // Placeholder: JWT verification via @supabase/ssr in follow-up when project exists
  const role = headers?.get("x-dev-role");
  if (role) {
    const user = resolveDevUser(role);
    return {
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    };
  }

  return { user: null, employeeId: null, roles: [], canViewMargin: false };
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
export const middleware = t.middleware;

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
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
const portalStaffBoundary = t.middleware(({ ctx, next, path }) => {
  if (ctx.user?.actorType === "portal" && !path.startsWith("portal.")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: portal cannot access staff APIs",
    });
  }
  return next({ ctx });
});

export const protectedProcedure = t.procedure
  .use(isAuthed)
  .use(portalStaffBoundary);

/** Staff-only — portal actors cannot call finance / margin / payroll APIs. */
const requireStaff = t.middleware(({ ctx, next }) => {
  if (!ctx.user || ctx.user.actorType === "portal") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: portal cannot access staff APIs",
    });
  }
  return next({ ctx });
});

export const staffProcedure = protectedProcedure.use(requireStaff);

/** Portal-only — requires bound clientId (app-layer RLS scope). */
const requirePortal = t.middleware(({ ctx, next }) => {
  if (!ctx.user || ctx.user.actorType !== "portal" || !ctx.user.clientId) {
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
  return t.middleware(({ ctx, next }) => {
    if (!ctx.user || !sessionHas(ctx.user, resource, action)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN" });
    }
    return next({ ctx });
  });
}

export function requireMarginView() {
  return t.middleware(({ ctx, next }) => {
    if (!ctx.user || ctx.user.actorType === "portal" || !ctx.canViewMargin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "FORBIDDEN: margin_view denied for role",
      });
    }
    return next({ ctx });
  });
}
