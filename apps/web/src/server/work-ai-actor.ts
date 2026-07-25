import { sql } from "@hrmny/db";
import { DEV_USERS, type SessionUser } from "./auth/session";
import { getDb } from "./db";
import type { TrpcContext } from "./trpc/trpc";

const demoActors = new Map<string, SessionUser>();

export function registerDemoWorkAiActor(user: SessionUser) {
  demoActors.set(user.employeeId, user);
}

export function unregisterDemoWorkAiActor(employeeId: string) {
  demoActors.delete(employeeId);
}

export function isDemoWorkAiActor(employeeId: string) {
  return demoActors.has(employeeId);
}

export function clearDemoWorkAiActors() {
  demoActors.clear();
}

export async function workAiContextForEmployee(
  employeeId: string,
): Promise<TrpcContext> {
  const demo =
    demoActors.get(employeeId) ??
    Object.values(DEV_USERS).find(
      (candidate) => candidate.employeeId === employeeId,
    );
  if (demo)
    return {
      user: demo,
      employeeId,
      roles: demo.roles,
      canViewMargin: false,
      clientId: demo.clientId,
    };
  const db = getDb();
  if (!db) throw new Error("AI actor is unavailable");
  const [employee] = await db.execute<{
    email: string;
    displayName: string;
    roles: string[];
  }>(sql`
    select employee.email, employee.display_name as "displayName",
      coalesce(array_agg(role.key) filter (where role.key is not null), '{}'::text[]) as roles
    from public.employee employee
    left join public.employee_role membership
      on membership.employee_id = employee.employee_id
    left join public.role role on role.role_id = membership.role_id
    where employee.employee_id = ${employeeId}::uuid and employee.is_active = true
    group by employee.employee_id
  `);
  if (!employee) throw new Error("AI actor is unavailable");
  const user: SessionUser = {
    employeeId,
    email: employee.email,
    displayName: employee.displayName,
    roles: employee.roles,
    permissions: [],
    actorType: "staff",
    clientId: null,
  };
  return {
    user,
    employeeId,
    roles: user.roles,
    canViewMargin: false,
    clientId: null,
  };
}
