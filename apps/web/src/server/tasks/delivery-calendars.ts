import { sql } from "@hrmny/db";
import { getDb } from "../db";

export type DeliveryCalendarSlot = {
  calendarSlotId: string;
  calendarId: string;
  slotDate: string;
  slotLabel: string | null;
  taskId: string | null;
  position: number;
};

export type DeliveryCalendar = {
  calendarId: string;
  clientId: string;
  month: string;
  focusPoints: unknown[];
  refApprovalState: string | null;
  finalApprovalState: string | null;
  shootDate: string | null;
  state: string;
  slots: DeliveryCalendarSlot[];
};

type CalendarRow = {
  calendar_id: string;
  client_id: string;
  month: string;
  focus_points: unknown[] | null;
  ref_approval_state: string | null;
  final_approval_state: string | null;
  shoot_date: string | null;
  state: string | null;
};

type SlotRow = {
  calendar_slot_id: string;
  calendar_id: string;
  slot_date: string;
  slot_label: string | null;
  task_id: string | null;
  position: number | string | null;
};

function mapSlot(row: SlotRow): DeliveryCalendarSlot {
  return {
    calendarSlotId: row.calendar_slot_id,
    calendarId: row.calendar_id,
    slotDate: row.slot_date,
    slotLabel: row.slot_label,
    taskId: row.task_id,
    position: Number(row.position ?? 0),
  };
}

function mapCalendar(row: CalendarRow, slots: DeliveryCalendarSlot[]): DeliveryCalendar {
  return {
    calendarId: row.calendar_id,
    clientId: row.client_id,
    month: row.month,
    focusPoints: Array.isArray(row.focus_points) ? row.focus_points : [],
    refApprovalState: row.ref_approval_state,
    finalApprovalState: row.final_approval_state,
    shootDate: row.shoot_date,
    state: row.state ?? "draft",
    slots,
  };
}

async function loadSlots(calendarId: string): Promise<DeliveryCalendarSlot[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.execute<SlotRow>(sql`
    select
      calendar_slot_id, calendar_id, slot_date::text as slot_date,
      slot_label, task_id, position
    from public.calendar_slot
    where calendar_id = ${calendarId}::uuid
    order by position, slot_date
  `);
  return rows.map(mapSlot);
}

export async function listDeliveryCalendars(input: {
  clientId: string;
  month?: string;
}): Promise<DeliveryCalendar[]> {
  const db = getDb();
  if (!db) return [];

  const rows = input.month
    ? await db.execute<CalendarRow>(sql`
        select
          calendar_id, client_id, month, focus_points,
          ref_approval_state, final_approval_state,
          shoot_date::text as shoot_date, state
        from public.calendar
        where client_id = ${input.clientId}::uuid
          and month = ${input.month}
        order by month desc
        limit 50
      `)
    : await db.execute<CalendarRow>(sql`
        select
          calendar_id, client_id, month, focus_points,
          ref_approval_state, final_approval_state,
          shoot_date::text as shoot_date, state
        from public.calendar
        where client_id = ${input.clientId}::uuid
        order by month desc
        limit 50
      `);

  const out: DeliveryCalendar[] = [];
  for (const row of rows) {
    out.push(mapCalendar(row, await loadSlots(row.calendar_id)));
  }
  return out;
}

export async function getDeliveryCalendar(
  calendarId: string,
): Promise<DeliveryCalendar | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute<CalendarRow>(sql`
    select
      calendar_id, client_id, month, focus_points,
      ref_approval_state, final_approval_state,
      shoot_date::text as shoot_date, state
    from public.calendar
    where calendar_id = ${calendarId}::uuid
    limit 1
  `);
  if (!rows[0]) return null;
  return mapCalendar(rows[0], await loadSlots(calendarId));
}

export async function createDeliveryCalendar(input: {
  clientId: string;
  month: string;
  focusPoints?: unknown[];
}): Promise<DeliveryCalendar | null> {
  const db = getDb();
  if (!db) return null;

  const clients = await db.execute<{ ok: number }>(sql`
    select 1 as ok from public.client
    where client_id = ${input.clientId}::uuid
    limit 1
  `);
  if (!clients[0]) return null;

  const rows = await db.execute<{ calendarId: string }>(sql`
    insert into public.calendar (
      client_id, month, focus_points, state
    ) values (
      ${input.clientId}::uuid,
      ${input.month},
      ${JSON.stringify(input.focusPoints ?? [])}::jsonb,
      'draft'
    )
    returning calendar_id as "calendarId"
  `);
  return getDeliveryCalendar(rows[0]!.calendarId);
}

export async function addDeliveryCalendarSlot(input: {
  calendarId: string;
  slotDate: string;
  slotLabel?: string | null;
  taskId?: string | null;
  position?: number;
}): Promise<DeliveryCalendarSlot | null> {
  const db = getDb();
  if (!db) return null;
  const cal = await getDeliveryCalendar(input.calendarId);
  if (!cal) return null;

  const rows = await db.execute<SlotRow>(sql`
    insert into public.calendar_slot (
      calendar_id, slot_date, slot_label, task_id, position
    ) values (
      ${input.calendarId}::uuid,
      ${input.slotDate}::date,
      ${input.slotLabel ?? null},
      ${input.taskId ?? null}::uuid,
      ${input.position ?? 0}
    )
    returning
      calendar_slot_id, calendar_id, slot_date::text as slot_date,
      slot_label, task_id, position
  `);
  return rows[0] ? mapSlot(rows[0]) : null;
}

export async function updateDeliveryCalendar(input: {
  calendarId: string;
  refApprovalState?: string | null;
  finalApprovalState?: string | null;
  shootDate?: string | null;
  state?: string;
}): Promise<DeliveryCalendar | null> {
  const db = getDb();
  if (!db) return null;
  const existing = await getDeliveryCalendar(input.calendarId);
  if (!existing) return null;

  const ref =
    input.refApprovalState !== undefined
      ? input.refApprovalState
      : existing.refApprovalState;
  const final =
    input.finalApprovalState !== undefined
      ? input.finalApprovalState
      : existing.finalApprovalState;
  const shoot =
    input.shootDate !== undefined ? input.shootDate : existing.shootDate;
  const state = input.state ?? existing.state;

  await db.execute(sql`
    update public.calendar
    set
      ref_approval_state = ${ref},
      final_approval_state = ${final},
      shoot_date = ${shoot}::date,
      state = ${state},
      updated_at = now()
    where calendar_id = ${input.calendarId}::uuid
  `);
  return getDeliveryCalendar(input.calendarId);
}
