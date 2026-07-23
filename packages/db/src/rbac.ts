/**
 * Application-level RBAC helpers.
 * Mirror of RLS intent: AM + portal never see margin/cost fields.
 */

export const MARGIN_FIELDS = [
  "marginPct",
  "margin_pct",
  "internalCost",
  "internal_cost",
  "marginAtSalePct",
  "margin_at_sale_pct",
  "deliveryCost",
  "revenueToDate",
  "overServicing",
  "dealMarginPct",
  "scopeVsActualPct",
] as const;

export const ROLES_WITH_MARGIN = new Set(["partner", "finance"]);

/** Roles that may never see margin (explicit deny). */
export const ROLES_DENY_MARGIN = new Set(["am", "account_manager", "portal"]);

export function canViewMargin(roles: string[]): boolean {
  if (roles.some((r) => ROLES_DENY_MARGIN.has(r))) return false;
  return roles.some((r) => ROLES_WITH_MARGIN.has(r));
}

export function stripMarginFields<T extends Record<string, unknown>>(
  row: T,
  roles: string[],
): T {
  if (canViewMargin(roles)) return row;
  const next = { ...row };
  for (const key of MARGIN_FIELDS) {
    if (key in next) delete next[key];
  }
  return next;
}

export function hasPermission(
  permissions: string[],
  resource: string,
  action: string,
): boolean {
  const denyKey = `deny:${resource}:${action}`;
  const allowKey = `allow:${resource}:${action}`;
  const wildAllow = `allow:${resource}:*`;
  if (permissions.includes(denyKey)) return false;
  return (
    permissions.includes(allowKey) ||
    permissions.includes(wildAllow) ||
    permissions.includes(`allow:*:*`)
  );
}

/** Seed role keys used in M1 demo. */
export const SEED_ROLE_KEYS = [
  "partner",
  "finance",
  "am",
  "director",
  "creative",
  "developer",
  "creative_director",
  "hr",
  "staff",
  "traffic",
] as const;

export type SeedRoleKey = (typeof SEED_ROLE_KEYS)[number];
