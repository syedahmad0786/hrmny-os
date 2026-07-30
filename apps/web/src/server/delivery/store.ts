import { sql } from "@hrmny/db";
import {
  getDemoStore,
  type DemoBrief,
  type DemoCalendar,
  type DemoCalendarSlot,
  type DemoTask,
} from "../demo-store";
import { getDb } from "../db";

type TaskRow = {
  task_id: string;
  client_id: string;
  calendar_id: string | null;
  month: string | null;
  task_type: string;
  title: string | null;
  status: string;
  situational_state: string | null;
  owner_employee_id: string | null;
  deadline: string | null;
  priority: string | null;
  qc_passed: boolean;
  qc_notes: string | null;
  client_revision_count: number;
  revision_boundary_ack: boolean;
  brief_id: string | null;
};

type BriefRow = {
  brief_id: string;
  task_id: string;
  body: Record<string, unknown> | null;
  dor_complete: boolean;
  missing_required_count: string | number;
  missing: string[] | null;
  locked_at: Date | string | null;
};

type CalendarRow = {
  calendar_id: string;
  client_id: string;
  month: string;
  focus_points: unknown[] | null;
  ref_approval_state: string | null;
  final_approval_state: string | null;
  shoot_date: string | null;
  state: string;
};

type SlotRow = {
  calendar_slot_id: string;
  calendar_id: string;
  slot_date: string;
  slot_label: string | null;
  task_id: string | null;
  position: string | number;
};

function mapTask(row: TaskRow): DemoTask {
  return {
    taskId: row.task_id,
    clientId: row.client_id,
    calendarId: row.calendar_id,
    month: row.month,
    taskType: row.task_type,
    title: row.title ?? row.task_type,
    status: row.status,
    situationalState: row.situational_state,
    ownerEmployeeId: row.owner_employee_id,
    deadline: row.deadline,
    priority: row.priority,
    qcPassed: Boolean(row.qc_passed),
    qcNotes: row.qc_notes,
    clientRevisionCount: Number(row.client_revision_count ?? 0),
    revisionBoundaryAck: Boolean(row.revision_boundary_ack),
    briefId: row.brief_id,
  };
}

function mapBrief(row: BriefRow): DemoBrief {
  return {
    briefId: row.brief_id,
    taskId: row.task_id,
    body: row.body ?? {},
    dorComplete: Boolean(row.dor_complete),
    missingRequiredCount: Number(row.missing_required_count ?? 0),
    missing: Array.isArray(row.missing) ? row.missing : [],
    lockedAt: row.locked_at ? new Date(row.locked_at).toISOString() : null,
  };
}

function mapSlot(row: SlotRow): DemoCalendarSlot {
  return {
    calendarSlotId: row.calendar_slot_id,
    calendarId: row.calendar_id,
    slotDate: row.slot_date,
    slotLabel: row.slot_label,
    taskId: row.task_id,
    position: Number(row.position ?? 0),
  };
}

export async function listTasks(filter?: {
  clientId?: string;
}): Promise<DemoTask[]> {
  const db = getDb();
  if (!db) {
    let rows = [...getDemoStore().tasks.values()];
    if (filter?.clientId)
      rows = rows.filter((t) => t.clientId === filter.clientId);
    return rows;
  }
  const rows = (await db.execute(sql`
    select
      task_id, client_id, calendar_id, month, task_type, title, status,
      situational_state, owner_employee_id, deadline::text as deadline,
      priority, qc_passed, qc_notes, client_revision_count,
      revision_boundary_ack, brief_id
    from public.task
    where (
      ${filter?.clientId ?? null}::uuid is null
      or client_id = ${filter?.clientId ?? null}::uuid
    )
    order by updated_at desc
  `)) as unknown as TaskRow[];
  return rows.map(mapTask);
}

export async function getTask(taskId: string): Promise<DemoTask | null> {
  const db = getDb();
  if (!db) return getDemoStore().tasks.get(taskId) ?? null;
  const rows = (await db.execute(sql`
    select
      task_id, client_id, calendar_id, month, task_type, title, status,
      situational_state, owner_employee_id, deadline::text as deadline,
      priority, qc_passed, qc_notes, client_revision_count,
      revision_boundary_ack, brief_id
    from public.task
    where task_id = ${taskId}::uuid
    limit 1
  `)) as unknown as TaskRow[];
  return rows[0] ? mapTask(rows[0]) : null;
}

export async function upsertTask(task: DemoTask): Promise<DemoTask> {
  const db = getDb();
  if (!db) {
    getDemoStore().tasks.set(task.taskId, task);
    return task;
  }
  await db.execute(sql`
    insert into public.task (
      task_id, client_id, calendar_id, month, task_type, title, status,
      situational_state, owner_employee_id, deadline, priority,
      qc_passed, qc_notes, client_revision_count, revision_boundary_ack, brief_id
    ) values (
      ${task.taskId}::uuid,
      ${task.clientId}::uuid,
      ${task.calendarId}::uuid,
      ${task.month},
      ${task.taskType},
      ${task.title},
      ${task.status}::task_status_enum,
      ${task.situationalState},
      ${task.ownerEmployeeId}::uuid,
      ${task.deadline}::date,
      ${task.priority},
      ${task.qcPassed},
      ${task.qcNotes},
      ${task.clientRevisionCount},
      ${task.revisionBoundaryAck},
      ${task.briefId}::uuid
    )
    on conflict (task_id) do update set
      calendar_id = excluded.calendar_id,
      month = excluded.month,
      task_type = excluded.task_type,
      title = excluded.title,
      status = excluded.status,
      situational_state = excluded.situational_state,
      owner_employee_id = excluded.owner_employee_id,
      deadline = excluded.deadline,
      priority = excluded.priority,
      qc_passed = excluded.qc_passed,
      qc_notes = excluded.qc_notes,
      client_revision_count = excluded.client_revision_count,
      revision_boundary_ack = excluded.revision_boundary_ack,
      brief_id = excluded.brief_id,
      updated_at = now()
  `);
  return task;
}

export async function getBrief(briefId: string): Promise<DemoBrief | null> {
  const db = getDb();
  if (!db) return getDemoStore().briefs.get(briefId) ?? null;
  const rows = (await db.execute(sql`
    select brief_id, task_id, body, dor_complete, missing_required_count,
           missing, locked_at
    from public.brief
    where brief_id = ${briefId}::uuid
    limit 1
  `)) as unknown as BriefRow[];
  return rows[0] ? mapBrief(rows[0]) : null;
}

export async function upsertBrief(brief: DemoBrief): Promise<DemoBrief> {
  const db = getDb();
  if (!db) {
    getDemoStore().briefs.set(brief.briefId, brief);
    return brief;
  }
  await db.execute(sql`
    insert into public.brief (
      brief_id, task_id, body, dor_complete, missing_required_count, missing, locked_at
    ) values (
      ${brief.briefId}::uuid,
      ${brief.taskId}::uuid,
      ${JSON.stringify(brief.body)}::jsonb,
      ${brief.dorComplete},
      ${brief.missingRequiredCount},
      ${JSON.stringify(brief.missing)}::jsonb,
      ${brief.lockedAt}::timestamptz
    )
    on conflict (brief_id) do update set
      body = excluded.body,
      dor_complete = excluded.dor_complete,
      missing_required_count = excluded.missing_required_count,
      missing = excluded.missing,
      locked_at = excluded.locked_at,
      updated_at = now()
  `);
  return brief;
}

export async function getCalendar(
  calendarId: string,
): Promise<DemoCalendar | null> {
  const db = getDb();
  if (!db) return getDemoStore().calendars.get(calendarId) ?? null;
  const rows = (await db.execute(sql`
    select calendar_id, client_id, month, focus_points, ref_approval_state,
           final_approval_state, shoot_date::text as shoot_date, state
    from public.calendar
    where calendar_id = ${calendarId}::uuid
    limit 1
  `)) as unknown as CalendarRow[];
  if (!rows[0]) return null;
  const slots = (await db.execute(sql`
    select calendar_slot_id, calendar_id, slot_date::text as slot_date,
           slot_label, task_id, position
    from public.calendar_slot
    where calendar_id = ${calendarId}::uuid
    order by position asc
  `)) as unknown as SlotRow[];
  const row = rows[0];
  return {
    calendarId: row.calendar_id,
    clientId: row.client_id,
    month: row.month,
    focusPoints: row.focus_points ?? [],
    refApprovalState: row.ref_approval_state,
    finalApprovalState: row.final_approval_state,
    shootDate: row.shoot_date,
    state: row.state,
    slots: slots.map(mapSlot),
  };
}

export async function listCalendarsByClient(
  clientId: string,
): Promise<DemoCalendar[]> {
  const db = getDb();
  if (!db) {
    return [...getDemoStore().calendars.values()].filter(
      (c) => c.clientId === clientId,
    );
  }
  const rows = (await db.execute(sql`
    select calendar_id
    from public.calendar
    where client_id = ${clientId}::uuid
    order by month desc
  `)) as unknown as Array<{ calendar_id: string }>;
  const out: DemoCalendar[] = [];
  for (const row of rows) {
    const cal = await getCalendar(row.calendar_id);
    if (cal) out.push(cal);
  }
  return out;
}

export async function upsertCalendar(
  calendar: DemoCalendar,
): Promise<DemoCalendar> {
  const db = getDb();
  if (!db) {
    getDemoStore().calendars.set(calendar.calendarId, calendar);
    return calendar;
  }
  await db.execute(sql`
    insert into public.calendar (
      calendar_id, client_id, month, focus_points, ref_approval_state,
      final_approval_state, shoot_date, state
    ) values (
      ${calendar.calendarId}::uuid,
      ${calendar.clientId}::uuid,
      ${calendar.month},
      ${JSON.stringify(calendar.focusPoints)}::jsonb,
      ${calendar.refApprovalState},
      ${calendar.finalApprovalState},
      ${calendar.shootDate}::date,
      ${calendar.state}
    )
    on conflict (calendar_id) do update set
      month = excluded.month,
      focus_points = excluded.focus_points,
      ref_approval_state = excluded.ref_approval_state,
      final_approval_state = excluded.final_approval_state,
      shoot_date = excluded.shoot_date,
      state = excluded.state,
      updated_at = now()
  `);

  // Replace slots for this calendar.
  await db.execute(sql`
    delete from public.calendar_slot
    where calendar_id = ${calendar.calendarId}::uuid
  `);
  for (const slot of calendar.slots) {
    await db.execute(sql`
      insert into public.calendar_slot (
        calendar_slot_id, calendar_id, slot_date, slot_label, task_id, position
      ) values (
        ${slot.calendarSlotId}::uuid,
        ${slot.calendarId}::uuid,
        ${slot.slotDate}::date,
        ${slot.slotLabel},
        ${slot.taskId}::uuid,
        ${slot.position}
      )
    `);
  }
  return calendar;
}
