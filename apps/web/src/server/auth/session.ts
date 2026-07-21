import { canViewMargin, hasPermission } from "@hrmny/db";

export type AuthMode = "dev" | "supabase";

export type SessionUser = {
  employeeId: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  actorType: "staff" | "portal";
  clientId: string | null;
};

export const DEV_USERS: Record<string, SessionUser> = {
  partner: {
    employeeId: "c0000000-0000-4000-8000-000000000001",
    email: "partner@hrmny.local",
    displayName: "Dev Partner",
    roles: ["partner"],
    permissions: [
      "allow:margin:view",
      "allow:deal:transition",
      "allow:audit:view",
      "allow:admin:roles",
      "allow:*:*",
    ],
    actorType: "staff",
    clientId: null,
  },
  am: {
    employeeId: "c0000000-0000-4000-8000-000000000002",
    email: "am@hrmny.local",
    displayName: "Dev AM",
    roles: ["am"],
    permissions: [
      "deny:margin:view",
      "allow:deal:transition",
      "allow:deal:read",
      "allow:assets:upload",
    ],
    actorType: "staff",
    clientId: null,
  },
  finance: {
    employeeId: "c0000000-0000-4000-8000-000000000003",
    email: "finance@hrmny.local",
    displayName: "Dev Finance",
    roles: ["finance"],
    permissions: [
      "allow:margin:view",
      "allow:deal:read",
      "allow:audit:view",
      "allow:deal:transition",
      "allow:invoice:*",
    ],
    actorType: "staff",
    clientId: null,
  },
  hr: {
    employeeId: "c0000000-0000-4000-8000-000000000010",
    email: "hr@hrmny.local",
    displayName: "Dev HR",
    roles: ["hr"],
    permissions: [
      "allow:employee:*",
      "allow:requisition:*",
      "allow:payroll:confirm",
      "deny:payroll:approve",
      "allow:audit:view",
    ],
    actorType: "staff",
    clientId: null,
  },
  director: {
    employeeId: "c0000000-0000-4000-8000-000000000011",
    email: "director@hrmny.local",
    displayName: "Dev Director",
    roles: ["director"],
    permissions: [
      "allow:payroll:approve",
      "allow:margin:view",
      "allow:audit:view",
      "allow:invoice:*",
      "allow:convention:edit",
      "allow:convention:view",
    ],
    actorType: "staff",
    clientId: null,
  },
  traffic: {
    employeeId: "c0000000-0000-4000-8000-000000000012",
    email: "traffic@hrmny.local",
    displayName: "Dev Traffic",
    roles: ["traffic"],
    permissions: [
      "allow:task:*",
      "allow:brief:*",
      "allow:calendar:read",
      "allow:audit:view",
    ],
    actorType: "staff",
    clientId: null,
  },
  creative_director: {
    employeeId: "c0000000-0000-4000-8000-000000000013",
    email: "cd@hrmny.local",
    displayName: "Dev Creative Director",
    roles: ["creative_director"],
    permissions: [
      "allow:task:*",
      "allow:asset:qc",
      "allow:calendar:*",
      "allow:audit:view",
    ],
    actorType: "staff",
    clientId: null,
  },
  /** Portal persona bound to Demo Co (DEMO_CLIENT_ID). */
  portal_a: {
    employeeId: "c0000000-0000-4000-8000-0000000000a1",
    email: "alex@democo.example",
    displayName: "Portal · Demo Co",
    roles: ["portal_client"],
    permissions: [
      "allow:portal:read",
      "allow:portal:approve",
      "deny:margin:view",
      "deny:invoice:*",
      "deny:payroll:*",
    ],
    actorType: "portal",
    clientId: "c1000000-0000-4000-8000-0000000000a4",
  },
  /** Portal persona bound to Other Co (must not see Demo Co data). */
  portal_b: {
    employeeId: "c0000000-0000-4000-8000-0000000000b1",
    email: "ops@otherco.example",
    displayName: "Portal · Other Co",
    roles: ["portal_client"],
    permissions: [
      "allow:portal:read",
      "allow:portal:approve",
      "deny:margin:view",
      "deny:invoice:*",
      "deny:payroll:*",
    ],
    actorType: "portal",
    clientId: "c1000000-0000-4000-8000-0000000000b4",
  },
};

export function getAuthMode(): AuthMode {
  const mode = process.env.AUTH_MODE?.toLowerCase();
  if (mode === "supabase") return "supabase";
  // Default to dev when no Supabase URL — keeps local demo runnable
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return "dev";
  return (mode as AuthMode) || "dev";
}

export function resolveDevUser(roleKey: string | null | undefined): SessionUser {
  const key = (roleKey ?? "partner").toLowerCase();
  return DEV_USERS[key] ?? DEV_USERS.partner!;
}

export function sessionCanViewMargin(user: SessionUser): boolean {
  if (!canViewMargin(user.roles)) return false;
  return hasPermission(user.permissions, "margin", "view");
}

export function sessionHas(
  user: SessionUser,
  resource: string,
  action: string,
): boolean {
  return hasPermission(user.permissions, resource, action);
}
