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

/** Create a delivery task + brief metadata in Postgres. */
export async function createDeliveryTask(input: {
  clientId: string;
  taskType: string;
  title?: string;
  status?: string;
  calendarId?: string | null;
  month?: string | null;
  deadline?: string | null;
  priority?: string | null;
  ownerEmployeeId?: string | null;
}): Promise<DeliveryTask | null> {
  const db = getDb();
  if (!db) return null;

  const clientRows = await db.execute<{ ok: number }>(sql`
    select 1 as ok from public.client
    where client_id = ${input.clientId}::uuid
    limit 1
  `);
  if (!clientRows[0]) return null;

  const status = input.status ?? "backlog";
  const title = input.title?.trim() || input.taskType.replace(/_/g, " ");
  const priority = input.priority ?? "medium";

  const tasks = await db.execute<{ taskId: string }>(sql`
    insert into public.task (
      client_id, calendar_id, month, task_type, status,
      owner_employee_id, deadline, priority
    )
    values (
      ${input.clientId}::uuid,
      ${input.calendarId ?? null}::uuid,
      ${input.month ?? null},
      ${input.taskType},
      ${status}::task_status_enum,
      ${input.ownerEmployeeId ?? null}::uuid,
      ${input.deadline ?? null}::date,
      ${priority}
    )
    returning task_id as "taskId"
  `);
  const taskId = tasks[0]!.taskId;
  await db.execute(sql`
    insert into public.brief (task_id, body, dor_complete, missing_required_count)
    values (
      ${taskId}::uuid,
      ${JSON.stringify({
        title,
        qcPassed: false,
        clientRevisionCount: 0,
        revisionBoundaryAck: false,
      })}::jsonb,
      false,
      0
    )
    on conflict (task_id) do update set
      body = excluded.body,
      updated_at = now()
  `);
  return getDeliveryTask(taskId);
}

/** Seed a creative task at QC (or given status) with brief title metadata. */
export async function seedClientCreativeTask(input: {
  clientId: string;
  title: string;
  taskType?: string;
  status?: string;
  ownerEmployeeId?: string | null;
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

  return createDeliveryTask({
    clientId: input.clientId,
    taskType,
    title: input.title,
    status,
    priority: "high",
    ownerEmployeeId: input.ownerEmployeeId ?? null,
  });
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

export async function updateDeliveryTaskOwner(input: {
  taskId: string;
  ownerEmployeeId: string;
}): Promise<DeliveryTask | null> {
  const db = getDb();
  if (!db) return null;
  const current = await getDeliveryTask(input.taskId);
  if (!current) return null;
  await db.execute(sql`
    update public.task
    set owner_employee_id = ${input.ownerEmployeeId}::uuid, updated_at = now()
    where task_id = ${input.taskId}::uuid
  `);
  return getDeliveryTask(input.taskId);
}

export async function updateDeliveryTaskSituational(input: {
  taskId: string;
  situationalState: string | null;
}): Promise<DeliveryTask | null> {
  const db = getDb();
  if (!db) return null;
  const current = await getDeliveryTask(input.taskId);
  if (!current) return null;
  await db.execute(sql`
    update public.task
    set situational_state = ${input.situationalState}, updated_at = now()
    where task_id = ${input.taskId}::uuid
  `);
  return getDeliveryTask(input.taskId);
}

export type DeliveryBrief = {
  briefId: string;
  taskId: string;
  body: Record<string, unknown>;
  dorComplete: boolean;
  missingRequiredCount: number;
  lockedAt: string | null;
};

type BriefRow = {
  brief_id: string;
  task_id: string;
  body: Record<string, unknown> | null;
  dor_complete: boolean;
  missing_required_count: number | string;
  locked_at: Date | string | null;
};

function mapBrief(row: BriefRow): DeliveryBrief {
  return {
    briefId: row.brief_id,
    taskId: row.task_id,
    body: row.body ?? {},
    dorComplete: Boolean(row.dor_complete),
    missingRequiredCount: Number(row.missing_required_count ?? 0),
    lockedAt: row.locked_at
      ? typeof row.locked_at === "string"
        ? row.locked_at
        : row.locked_at.toISOString()
      : null,
  };
}

export async function getDeliveryBrief(
  briefId: string,
): Promise<DeliveryBrief | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute<BriefRow>(sql`
    select
      brief_id, task_id, body, dor_complete, missing_required_count, locked_at
    from public.brief
    where brief_id = ${briefId}::uuid
    limit 1
  `);
  return rows[0] ? mapBrief(rows[0]) : null;
}

export async function getDeliveryBriefByTask(
  taskId: string,
): Promise<DeliveryBrief | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute<BriefRow>(sql`
    select
      brief_id, task_id, body, dor_complete, missing_required_count, locked_at
    from public.brief
    where task_id = ${taskId}::uuid
    limit 1
  `);
  return rows[0] ? mapBrief(rows[0]) : null;
}

/** Upsert brief for a durable task; advances task to briefing when unlocked. */
export async function upsertDeliveryBriefForTask(input: {
  taskId: string;
  body: Record<string, unknown>;
  dorComplete: boolean;
  missingRequiredCount: number;
  setStatusBriefing?: boolean;
}): Promise<DeliveryBrief | null> {
  const db = getDb();
  if (!db) return null;
  const task = await getDeliveryTask(input.taskId);
  if (!task) return null;

  await db.execute(sql`
    insert into public.brief (task_id, body, dor_complete, missing_required_count)
    values (
      ${input.taskId}::uuid,
      ${JSON.stringify(input.body)}::jsonb,
      ${input.dorComplete},
      ${input.missingRequiredCount}
    )
    on conflict (task_id) do update set
      body = excluded.body,
      dor_complete = excluded.dor_complete,
      missing_required_count = excluded.missing_required_count,
      updated_at = now()
  `);

  if (input.setStatusBriefing !== false && !task.briefId) {
    await db.execute(sql`
      update public.task
      set status = 'briefing'::task_status_enum, updated_at = now()
      where task_id = ${input.taskId}::uuid
        and status = 'backlog'::task_status_enum
    `);
  } else if (input.setStatusBriefing !== false) {
    await db.execute(sql`
      update public.task
      set status = 'briefing'::task_status_enum, updated_at = now()
      where task_id = ${input.taskId}::uuid
        and status in ('backlog'::task_status_enum, 'briefing'::task_status_enum)
    `);
  }

  return getDeliveryBriefByTask(input.taskId);
}

export async function updateDeliveryBriefBody(input: {
  briefId: string;
  body: Record<string, unknown>;
  dorComplete: boolean;
  missingRequiredCount: number;
}): Promise<DeliveryBrief | null> {
  const db = getDb();
  if (!db) return null;
  const existing = await getDeliveryBrief(input.briefId);
  if (!existing) return null;
  if (existing.lockedAt) return null;

  await db.execute(sql`
    update public.brief
    set
      body = ${JSON.stringify(input.body)}::jsonb,
      dor_complete = ${input.dorComplete},
      missing_required_count = ${input.missingRequiredCount},
      updated_at = now()
    where brief_id = ${input.briefId}::uuid
  `);
  return getDeliveryBrief(input.briefId);
}

/**
 * Lock a durable brief (sets locked_at), advances task to brief_ready,
 * and spawns a sibling creative_spawn task when missing.
 */
export async function lockDeliveryBrief(input: {
  briefId: string;
  dorComplete: boolean;
  missingRequiredCount: number;
}): Promise<{
  brief: DeliveryBrief;
  taskStatus: string;
  spawnedTaskId: string | null;
  reuse: boolean;
} | null> {
  const db = getDb();
  if (!db) return null;
  const existing = await getDeliveryBrief(input.briefId);
  if (!existing) return null;

  const sourceTask = await getDeliveryTask(existing.taskId);
  if (!sourceTask) return null;

  if (!existing.lockedAt) {
    await db.execute(sql`
      update public.brief
      set
        dor_complete = ${input.dorComplete},
        missing_required_count = ${input.missingRequiredCount},
        locked_at = coalesce(locked_at, now()),
        updated_at = now()
      where brief_id = ${input.briefId}::uuid
    `);
  }

  await db.execute(sql`
    update public.task
    set status = 'brief_ready'::task_status_enum, updated_at = now()
    where task_id = ${existing.taskId}::uuid
  `);

  const spawnTitle = `Creative from brief ${input.briefId.slice(0, 8)}`;
  const existingSpawn = await db.execute<{ taskId: string }>(sql`
    select t.task_id as "taskId"
    from public.task t
    join public.brief b on b.task_id = t.task_id
    where t.client_id = ${sourceTask.clientId}::uuid
      and t.task_type = 'creative_spawn'
      and (
        b.body->>'sourceBriefId' = ${input.briefId}
        or b.body->>'briefId' = ${input.briefId}
      )
    limit 1
  `);

  let spawnedTaskId: string | null = existingSpawn[0]?.taskId ?? null;
  let reuse = Boolean(spawnedTaskId);

  if (spawnedTaskId) {
    await db.execute(sql`
      update public.task
      set status = 'brief_ready'::task_status_enum, updated_at = now()
      where task_id = ${spawnedTaskId}::uuid
    `);
  } else {
    const spawned = await createDeliveryTask({
      clientId: sourceTask.clientId,
      taskType: "creative_spawn",
      title: spawnTitle,
      status: "brief_ready",
      calendarId: sourceTask.calendarId,
      month: sourceTask.month,
      deadline: sourceTask.deadline,
      priority: sourceTask.priority ?? "high",
      ownerEmployeeId: sourceTask.ownerEmployeeId,
    });
    spawnedTaskId = spawned?.taskId ?? null;
    if (spawned?.briefId) {
      const body = {
        title: spawnTitle,
        sourceBriefId: input.briefId,
        sourceTaskId: existing.taskId,
        qcPassed: false,
        clientRevisionCount: 0,
        revisionBoundaryAck: false,
      };
      await db.execute(sql`
        update public.brief
        set body = ${JSON.stringify(body)}::jsonb, updated_at = now()
        where brief_id = ${spawned.briefId}::uuid
      `);
    }
    reuse = false;
  }

  const brief = await getDeliveryBrief(input.briefId);
  if (!brief) return null;
  return {
    brief,
    taskStatus: "brief_ready",
    spawnedTaskId,
    reuse,
  };
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
