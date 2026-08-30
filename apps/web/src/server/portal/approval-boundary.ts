import {
  DEMO_CLIENT_B_ID,
  DEMO_CLIENT_B_PORTAL_USER_ID,
  DEMO_CLIENT_ID,
  DEMO_PORTAL_USER_ID,
  getDemoStore,
} from "../demo-store";
import { hasPermission, sql } from "@hrmny/db";
import { getDb } from "../db";

export const CLIENT_PORTAL_ACTOR_REQUIRED = "CLIENT_PORTAL_ACTOR_REQUIRED";
export const PORTAL_IDENTITY_NOT_BOUND = "PORTAL_IDENTITY_NOT_BOUND";

export type PortalApprovalActor = {
  actorType: "staff" | "portal";
  employeeId: string;
  clientId: string | null;
  roles: string[];
  permissions: string[];
};

export type PortalApprovalPrincipalRecord = {
  portalUserId: string;
  clientId: string;
  isActive: boolean;
};

export function portalApprovalSyntheticRuntimeEnabled(): boolean {
  return (
    process.env.AUTH_MODE?.trim().toLowerCase() === "dev" &&
    process.env.ALLOW_DEV_AUTH === "true" &&
    process.env.DATABASE_MODE?.trim().toLowerCase() === "memory" &&
    process.env.WORK_ENVIRONMENT_KIND?.trim().toLowerCase() === "sandbox"
  );
}

export function portalApprovalPrincipalMatches(
  expected: { portalUserId: string; clientId: string },
  candidate: PortalApprovalPrincipalRecord | null | undefined,
): candidate is PortalApprovalPrincipalRecord {
  return Boolean(
    candidate?.isActive &&
      candidate.portalUserId === expected.portalUserId &&
      candidate.clientId === expected.clientId,
  );
}

export function requirePortalApprovalActor(input: {
  actor: PortalApprovalActor | null | undefined;
  clientId: string;
}): PortalApprovalActor {
  if (
    !input.actor ||
    input.actor.actorType !== "portal" ||
    input.actor.clientId !== input.clientId ||
    !hasPermission(input.actor.permissions, "portal", "approve")
  ) {
    throw new Error(CLIENT_PORTAL_ACTOR_REQUIRED);
  }
  return input.actor;
}

export function syntheticPortalApprovalPrincipal(
  portalUserId: string,
): PortalApprovalPrincipalRecord | null {
  if (!portalApprovalSyntheticRuntimeEnabled()) return null;
  if (
    portalUserId !== DEMO_PORTAL_USER_ID &&
    portalUserId !== DEMO_CLIENT_B_PORTAL_USER_ID
  ) {
    return null;
  }
  const candidate = getDemoStore().portalUsers.get(portalUserId);
  if (!candidate) return null;
  if (
    candidate.clientId !== DEMO_CLIENT_ID &&
    candidate.clientId !== DEMO_CLIENT_B_ID
  ) {
    return null;
  }
  return {
    portalUserId: candidate.portalUserId,
    clientId: candidate.clientId,
    isActive: candidate.isActive,
  };
}

export function requireSyntheticPortalApprovalPrincipal(input: {
  portalUserId: string;
  clientId: string;
}): PortalApprovalPrincipalRecord {
  const candidate = syntheticPortalApprovalPrincipal(input.portalUserId);
  if (!portalApprovalPrincipalMatches(input, candidate)) {
    throw new Error(PORTAL_IDENTITY_NOT_BOUND);
  }
  return candidate;
}

/**
 * Revalidate a portal decision principal against current server authority.
 * Database-backed approval transactions repeat this check under their own row
 * lock; other portal mutations use this immediately before their domain gate.
 */
export async function requireBoundPortalApprovalActor(input: {
  actor: PortalApprovalActor | null | undefined;
  clientId: string;
}): Promise<PortalApprovalActor> {
  const actor = requirePortalApprovalActor(input);
  const db = getDb();
  if (!db) {
    requireSyntheticPortalApprovalPrincipal({
      portalUserId: actor.employeeId,
      clientId: input.clientId,
    });
    return actor;
  }
  const rows = await db.execute<PortalApprovalPrincipalRecord>(sql`
    select
      client_portal_user_id as "portalUserId",
      client_id as "clientId",
      is_active as "isActive"
    from public.client_portal_user
    where client_portal_user_id = ${actor.employeeId}::uuid
    limit 1
  `);
  if (
    !portalApprovalPrincipalMatches(
      { portalUserId: actor.employeeId, clientId: input.clientId },
      rows[0],
    )
  ) {
    throw new Error(PORTAL_IDENTITY_NOT_BOUND);
  }
  return actor;
}
