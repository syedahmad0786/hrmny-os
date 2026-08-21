import { sql } from "@hrmny/db";
import { getDb } from "../db";

export type DeliveryTask = {
  taskId: string;
  clientId: string;
  calendarId: string | null;
  month: string | null;
  taskType: string;
  title: string;
  status: string;
  situationalState: string | null;
  ownerEmployeeId: string | null;
  deadline: string | null;
  priority: string | null;
  qcPassed: boolean;
  qcNotes: string | null;
  clientRevisionCount: number;
  revisionBoundaryAck: boolean;
  briefId: string | null;
};

type TaskJoinRow = {
  task_id: string;
  client_id: string;
  calendar_id: string | null;
  month: string | null;
  task_type: string;
  status: string;
  situational_state: string | null;
  owner_employee_id: string | null;
  deadline: string | null;
  priority: string | null;
  brief_id: string | null;
  body: Record<string, unknown> | null;
};

function mapRow(row: TaskJoinRow): DeliveryTask {
  const body = row.body ?? {};
  return {
    taskId: row.task_id,
    clientId: row.client_id,
    calendarId: row.calendar_id,
    month: row.month,
    taskType: row.task_type,
    title:
      (typeof body.title === "string" && body.title) ||
      row.task_type.replace(/_/g, " "),
    status: row.status,
    situationalState: row.situational_state,
    ownerEmployeeId: row.owner_employee_id,
    deadline: row.deadline,
    priority: row.priority,
    qcPassed: body.qcPassed === true,
    qcNotes: typeof body.qcNotes === "string" ? body.qcNotes : null,
    clientRevisionCount: Number(body.clientRevisionCount ?? 0),
    revisionBoundaryAck: body.revisionBoundaryAck === true,
    briefId: row.brief_id,
  };
}

export async function listDeliveryTasks(filter?: {
  clientId?: string;
  status?: string;
}): Promise<DeliveryTask[]> {
  const db = getDb();
  if (!db) return [];

  if (filter?.clientId && filter?.status) {
    const rows = await db.execute<TaskJoinRow>(sql`
      select
        t.task_id, t.client_id, t.calendar_id, t.month, t.task_type, t.status,
        t.situational_state, t.owner_employee_id, t.deadline::text as deadline,
        t.priority, b.brief_id, b.body
      from public.task t
      left join public.brief b on b.task_id = t.task_id
      where t.client_id = ${filter.clientId}::uuid
        and t.status = ${filter.status}::task_status_enum
      order by t.updated_at desc
      limit 200
    `);
    return rows.map(mapRow);
  }
  if (filter?.clientId) {
    const rows = await db.execute<TaskJoinRow>(sql`
      select
        t.task_id, t.client_id, t.calendar_id, t.month, t.task_type, t.status,
        t.situational_state, t.owner_employee_id, t.deadline::text as deadline,
        t.priority, b.brief_id, b.body
      from public.task t
      left join public.brief b on b.task_id = t.task_id
      where t.client_id = ${filter.clientId}::uuid
      order by t.updated_at desc
      limit 200
    `);
    return rows.map(mapRow);
  }
  if (filter?.status) {
    const rows = await db.execute<TaskJoinRow>(sql`
      select
        t.task_id, t.client_id, t.calendar_id, t.month, t.task_type, t.status,
        t.situational_state, t.owner_employee_id, t.deadline::text as deadline,
        t.priority, b.brief_id, b.body
      from public.task t
      left join public.brief b on b.task_id = t.task_id
      where t.status = ${filter.status}::task_status_enum
      order by t.updated_at desc
      limit 200
    `);
    return rows.map(mapRow);
  }

  const rows = await db.execute<TaskJoinRow>(sql`
    select
      t.task_id, t.client_id, t.calendar_id, t.month, t.task_type, t.status,
      t.situational_state, t.owner_employee_id, t.deadline::text as deadline,
      t.priority, b.brief_id, b.body
    from public.task t
    left join public.brief b on b.task_id = t.task_id
    order by t.updated_at desc
    limit 200
  `);
  return rows.map(mapRow);
}

export async function getDeliveryTask(
  taskId: string,
): Promise<DeliveryTask | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute<TaskJoinRow>(sql`
    select
      t.task_id, t.client_id, t.calendar_id, t.month, t.task_type, t.status,
      t.situational_state, t.owner_employee_id, t.deadline::text as deadline,
      t.priority, b.brief_id, b.body
    from public.task t
    left join public.brief b on b.task_id = t.task_id
    where t.task_id = ${taskId}::uuid
    limit 1
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Seed a creative task at QC (or given status) with brief title metadata. */
export async function seedClientCreativeTask(input: {
  clientId: string;
  title: string;
  taskType?: string;
  status?: string;
}): Promise<DeliveryTask | null> {
  const db = getDb();
  if (!db) return null;
  const status = input.status ?? "qc";
  const taskType = input.taskType ?? "social_cutdowns";

  const existing = await db.execute<{ taskId: string }>(sql`
    select task_id as "taskId" from public.task
    where client_id = ${input.clientId}::uuid
      and task_type = ${taskType}
      and status = ${status}::task_status_enum
    limit 1
  `);
  if (existing[0]) {
    return getDeliveryTask(existing[0].taskId);
  }

  const tasks = await db.execute<{ taskId: string }>(sql`
    insert into public.task (client_id, task_type, status, priority)
    values (
      ${input.clientId}::uuid,
      ${taskType},
      ${status}::task_status_enum,
      'high'
    )
    returning task_id as "taskId"
  `);
  const taskId = tasks[0]!.taskId;
  await db.execute(sql`
    insert into public.brief (task_id, body, dor_complete, missing_required_count)
    values (
      ${taskId}::uuid,
      ${JSON.stringify({
        title: input.title,
        qcPassed: false,
        clientRevisionCount: 0,
        revisionBoundaryAck: false,
      })}::jsonb,
      true,
      0
    )
    on conflict (task_id) do update set
      body = excluded.body,
      updated_at = now()
  `);
  return getDeliveryTask(taskId);
}

export async function updateDeliveryTaskStatus(input: {
  taskId: string;
  status: string;
  qcPassed?: boolean;
  qcNotes?: string | null;
}): Promise<DeliveryTask | null> {
  const db = getDb();
  if (!db) return null;
  const current = await getDeliveryTask(input.taskId);
  if (!current) return null;

  await db.execute(sql`
    update public.task
    set status = ${input.status}::task_status_enum, updated_at = now()
    where task_id = ${input.taskId}::uuid
  `);

  if (current.briefId) {
    const body = {
      title: current.title,
      qcPassed: input.qcPassed ?? current.qcPassed,
      qcNotes: input.qcNotes ?? current.qcNotes,
      clientRevisionCount: current.clientRevisionCount,
      revisionBoundaryAck: current.revisionBoundaryAck,
    };
    await db.execute(sql`
      update public.brief
      set body = ${JSON.stringify(body)}::jsonb, updated_at = now()
      where brief_id = ${current.briefId}::uuid
    `);
  }

  return getDeliveryTask(input.taskId);
}

export async function setDeliveryTaskQc(input: {
  taskId: string;
  decision: "pass" | "fail" | "waive";
  notes?: string;
}): Promise<DeliveryTask | null> {
  const passed = input.decision === "pass" || input.decision === "waive";
  const current = await getDeliveryTask(input.taskId);
  if (!current) return null;
  return updateDeliveryTaskStatus({
    taskId: input.taskId,
    status: current.status,
    qcPassed: passed,
    qcNotes: input.notes ?? null,
  });
}
