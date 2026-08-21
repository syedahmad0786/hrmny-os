import { sql } from "@hrmny/db";
import { getDb } from "../db";

export type OsNotification = {
  osNotificationId: string;
  employeeId: string | null;
  title: string;
  body: string | null;
  kind: string;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};

const memory: OsNotification[] = [];

export async function notifyEmployee(input: {
  employeeId: string;
  title: string;
  body?: string | null;
  kind?: string;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<OsNotification> {
  const db = getDb();
  if (!db) {
    const row: OsNotification = {
      osNotificationId: crypto.randomUUID(),
      employeeId: input.employeeId,
      title: input.title,
      body: input.body ?? null,
      kind: input.kind ?? "info",
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    memory.unshift(row);
    return row;
  }
  const rows = await db.execute<OsNotification>(sql`
    insert into public.os_notification (
      employee_id, title, body, kind, href, entity_type, entity_id
    ) values (
      ${input.employeeId}::uuid,
      ${input.title},
      ${input.body ?? null},
      ${input.kind ?? "info"},
      ${input.href ?? null},
      ${input.entityType ?? null},
      ${input.entityId ?? null}::uuid
    )
    returning
      os_notification_id as "osNotificationId",
      employee_id as "employeeId",
      title, body, kind, href,
      entity_type as "entityType",
      entity_id as "entityId",
      read_at::text as "readAt",
      created_at::text as "createdAt"
  `);
  return rows[0]!;
}

export async function listNotifications(
  employeeId: string,
  opts?: { unreadOnly?: boolean; limit?: number },
): Promise<OsNotification[]> {
  const db = getDb();
  const limit = opts?.limit ?? 50;
  if (!db) {
    return memory
      .filter((n) => n.employeeId === employeeId)
      .filter((n) => (opts?.unreadOnly ? !n.readAt : true))
      .slice(0, limit);
  }
  if (opts?.unreadOnly) {
    return db.execute<OsNotification>(sql`
      select
        os_notification_id as "osNotificationId",
        employee_id as "employeeId",
        title, body, kind, href,
        entity_type as "entityType",
        entity_id as "entityId",
        read_at::text as "readAt",
        created_at::text as "createdAt"
      from public.os_notification
      where employee_id = ${employeeId}::uuid and read_at is null
      order by created_at desc
      limit ${limit}
    `);
  }
  return db.execute<OsNotification>(sql`
    select
      os_notification_id as "osNotificationId",
      employee_id as "employeeId",
      title, body, kind, href,
      entity_type as "entityType",
      entity_id as "entityId",
      read_at::text as "readAt",
      created_at::text as "createdAt"
    from public.os_notification
    where employee_id = ${employeeId}::uuid
    order by created_at desc
    limit ${limit}
  `);
}

export async function markNotificationRead(
  employeeId: string,
  notificationId: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) {
    const row = memory.find(
      (n) =>
        n.osNotificationId === notificationId && n.employeeId === employeeId,
    );
    if (!row) return false;
    row.readAt = new Date().toISOString();
    return true;
  }
  const rows = await db.execute<{ id: string }>(sql`
    update public.os_notification
    set read_at = now(), updated_at = now()
    where os_notification_id = ${notificationId}::uuid
      and employee_id = ${employeeId}::uuid
    returning os_notification_id as id
  `);
  return Boolean(rows[0]);
}

export async function markAllNotificationsRead(
  employeeId: string,
): Promise<number> {
  const db = getDb();
  if (!db) {
    let n = 0;
    for (const row of memory) {
      if (row.employeeId === employeeId && !row.readAt) {
        row.readAt = new Date().toISOString();
        n += 1;
      }
    }
    return n;
  }
  const rows = await db.execute<{ n: number }>(sql`
    with updated as (
      update public.os_notification
      set read_at = now(), updated_at = now()
      where employee_id = ${employeeId}::uuid and read_at is null
      returning 1
    )
    select count(*)::int as n from updated
  `);
  return rows[0]?.n ?? 0;
}
