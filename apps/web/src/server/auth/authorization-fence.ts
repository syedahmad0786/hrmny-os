import { sql, type Db } from "@hrmny/db";

/** Keep staff, role, and feature inputs unchanged through a guarded transaction. */
export async function lockStaffFeatureAuthorizationInputs(
  db: Db,
  employeeId: string,
): Promise<void> {
  // ponytail: broad policy locks for transactions bounded to ten CRM records;
  // use coordinated per-policy advisory locks if authorization writes contend.
  await db.execute(
    sql`lock table public.feature_override, public.permission_policy in share mode`,
  );
  await db.execute(sql`
    select employee_id
    from public.employee
    where employee_id = ${employeeId}::uuid
    for share
  `);
  await db.execute(sql`
    select membership.employee_id
    from public.employee_role membership
    join public.role role on role.role_id = membership.role_id
    where membership.employee_id = ${employeeId}::uuid
    for share of membership, role
  `);
}
