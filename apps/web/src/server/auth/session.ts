import { createClient } from "@supabase/supabase-js";
import {
  canViewMargin,
  clientPortalUser,
  employee,
  employeeAuth,
  employeeRole,
  eq,
  hasPermission,
  permissionPolicy,
  role,
  sql,
} from "@hrmny/db";
import { getDb } from "../db";
import {
  getWorkSsoConfiguration,
  ssoAccessAllowed,
} from "../enterprise-identity";
import { getWorkOrganizationPolicy } from "../work-governance";
import { featureEnabled } from "../features";
import { getSupabasePublicConfig } from "@/lib/supabase-config";

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
      "allow:admin:features",
      "allow:admin:work",
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
  // Never expose dev persona impersonation from a production deployment.
  if (process.env.NODE_ENV === "production") return "supabase";
  if (mode === "supabase") return "supabase";
  return "dev";
}

export function resolveDevUser(
  roleKey: string | null | undefined,
): SessionUser {
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

/** Verify a Supabase access token, then load authorization from Postgres. */
export async function resolveSupabaseUser(
  accessToken: string,
): Promise<SessionUser | null> {
  const config = getSupabasePublicConfig();
  if (!config) {
    throw new Error(
      "AUTH_MODE=supabase requires NEXT_PUBLIC_SUPABASE_URL and a Supabase publishable key",
    );
  }

  const supabase = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;

  const db = getDb();
  if (!db) {
    throw new Error("AUTH_MODE=supabase requires DATABASE_URL");
  }

  const email = data.user.email?.trim().toLowerCase();
  const [sso, workPolicy] = await Promise.all([
    getWorkSsoConfiguration(),
    getWorkOrganizationPolicy(),
  ]);
  const lastSignInAt = Date.parse(data.user.last_sign_in_at ?? "");
  const sessionExpired =
    Number.isFinite(lastSignInAt) &&
    Date.now() - lastSignInAt > workPolicy.sessionTimeoutMinutes * 60_000;
  let [staff] = await db
    .select({
      employeeId: employee.employeeId,
      email: employee.email,
      displayName: employee.displayName,
      isActive: employee.isActive,
    })
    .from(employeeAuth)
    .innerJoin(employee, eq(employeeAuth.employeeId, employee.employeeId))
    .where(eq(employeeAuth.authUserId, data.user.id))
    .limit(1);

  // An approved employee email is enough for the first login. Where provisioned,
  // the optional employee_auth link remains the stronger identifier.
  if (!staff && email && data.user.email_confirmed_at) {
    [staff] = await db
      .select({
        employeeId: employee.employeeId,
        email: employee.email,
        displayName: employee.displayName,
        isActive: employee.isActive,
      })
      .from(employee)
      .where(
        sql`${employee.isActive} = true and lower(${employee.email}) = ${email}`,
      )
      .limit(1);
  }

  if (staff?.isActive) {
    const access = await db
      .select({
        role: role.key,
        resource: permissionPolicy.resource,
        action: permissionPolicy.action,
        effect: permissionPolicy.effect,
      })
      .from(employeeRole)
      .innerJoin(role, eq(employeeRole.roleId, role.roleId))
      .leftJoin(
        permissionPolicy,
        eq(employeeRole.roleId, permissionPolicy.roleId),
      )
      .where(eq(employeeRole.employeeId, staff.employeeId));

    const roles = [...new Set(access.map((row) => row.role))];
    const featureSubject = { userId: staff.employeeId, roles };
    const [ssoEnabled, sessionControlsEnabled] = await Promise.all([
      featureEnabled("work.sso_scim", featureSubject),
      featureEnabled("work.domain_controls", featureSubject),
    ]);
    if (ssoEnabled && !ssoAccessAllowed(sso, data.user)) return null;
    if (sessionControlsEnabled && sessionExpired) return null;

    return {
      employeeId: staff.employeeId,
      email: staff.email,
      displayName: staff.displayName,
      roles,
      permissions: access.flatMap((row) =>
        row.resource && row.action && row.effect
          ? [`${row.effect}:${row.resource}:${row.action}`]
          : [],
      ),
      actorType: "staff",
      clientId: null,
    };
  }

  if (!email || !data.user.email_confirmed_at) return null;
  const portalUsers = await db
    .select({
      portalUserId: clientPortalUser.clientPortalUserId,
      clientId: clientPortalUser.clientId,
      email: clientPortalUser.email,
      displayName: clientPortalUser.displayName,
    })
    .from(clientPortalUser)
    .where(
      sql`${clientPortalUser.isActive} = true and lower(${clientPortalUser.email}) = ${email}`,
    )
    .limit(2);
  if (portalUsers.length !== 1) return null;

  const portal = portalUsers[0]!;
  if (
    sessionExpired &&
    (await featureEnabled("work.domain_controls", {
      userId: portal.portalUserId,
      clientId: portal.clientId,
      roles: ["portal_client"],
    }))
  ) {
    return null;
  }
  return {
    employeeId: portal.portalUserId,
    email: portal.email,
    displayName: portal.displayName,
    roles: ["portal_client"],
    permissions: [
      "allow:portal:read",
      "allow:portal:approve",
      "deny:margin:view",
      "deny:invoice:*",
      "deny:payroll:*",
    ],
    actorType: "portal",
    clientId: portal.clientId,
  };
}
