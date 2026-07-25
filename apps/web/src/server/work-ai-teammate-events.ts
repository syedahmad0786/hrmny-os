import { sql } from "@hrmny/db";
import { getDb } from "./db";
import { featureEnabled } from "./features";
import type { TrpcContext } from "./trpc/trpc";
import { isDemoWorkAiActor } from "./work-ai-actor";

type DemoAssignedTeammateEvent = {
  itemId: string;
  assigneeEmployeeId: string;
  requestText: string;
};

const demoAssignedTeammateEvents: DemoAssignedTeammateEvent[] = [];

export function listDemoAssignedTeammateEvents() {
  return demoAssignedTeammateEvents.map((event) => ({ ...event }));
}

export function clearDemoAssignedTeammateEvents() {
  demoAssignedTeammateEvents.length = 0;
}

export async function queueAssignedWorkAiTeammate(
  ctx: TrpcContext,
  itemId: string,
  assigneeEmployeeId: string | null,
  requestText = "Work on this assigned task and propose the next useful actions.",
) {
  if (!ctx.employeeId || !assigneeEmployeeId) return 0;
  const db = getDb();
  if (!db) {
    if (!isDemoWorkAiActor(assigneeEmployeeId)) return 0;
    demoAssignedTeammateEvents.push({
      itemId,
      assigneeEmployeeId,
      requestText,
    });
    return 1;
  }
  const [project] = await db.execute<{
    projectId: string;
    clientId: string | null;
  }>(sql`
    select membership.work_project_id as "projectId",
      project.client_id as "clientId"
    from public.work_project_item membership
    join public.work_project project
      on project.work_project_id = membership.work_project_id
    where membership.work_item_id = ${itemId}::uuid
    order by membership.created_at limit 1
  `);
  if (
    !project ||
    !(await featureEnabled("work.ai.teammates", {
      userId: ctx.employeeId,
      clientId: project.clientId,
      roles: ctx.roles,
    }))
  )
    return 0;
  const queued = await db.execute(sql`
    with target as (
      select teammate.work_ai_teammate_id,
        'ai-teammate-assignment:' || teammate.work_ai_teammate_id::text || ':' || gen_random_uuid()::text as job_key
      from public.work_ai_teammate teammate
      join public.work_ai_teammate_member member
        on member.work_ai_teammate_id = teammate.work_ai_teammate_id
        and member.employee_id = ${ctx.employeeId}::uuid
      join public.work_ai_teammate_project_access access
        on access.work_ai_teammate_id = teammate.work_ai_teammate_id
        and access.work_project_id = ${project.projectId}::uuid
      where teammate.employee_id = ${assigneeEmployeeId}::uuid
        and teammate.status = 'active' and teammate.archived_at is null
      limit 1
    )
    insert into public.scheduled_job (job_key, kind, run_at, payload)
    select target.job_key, 'work_ai_teammate', now(), jsonb_build_object(
      'teammateId', target.work_ai_teammate_id,
      'itemId', ${itemId}::uuid,
      'actorEmployeeId', ${ctx.employeeId}::uuid,
      'requestText', ${requestText},
      'triggerType', 'assignment',
      'eventKey', target.job_key
    ) from target
    returning scheduled_job_id
  `);
  return queued.length;
}

export async function queueMentionedWorkAiTeammates(
  ctx: TrpcContext,
  itemId: string,
  commentBody: string,
) {
  if (!ctx.employeeId || !commentBody.includes("@")) return 0;
  const db = getDb();
  if (!db) return 0;
  const queued = await db.execute(sql`
    with targets as (
      select teammate.work_ai_teammate_id,
        'ai-teammate-mention:' || teammate.work_ai_teammate_id::text || ':' || gen_random_uuid()::text as job_key
      from public.work_ai_teammate teammate
      join public.work_ai_teammate_member member
        on member.work_ai_teammate_id = teammate.work_ai_teammate_id
        and member.employee_id = ${ctx.employeeId}::uuid
      where teammate.status = 'active' and teammate.archived_at is null
        and position(lower('@' || teammate.name) in lower(${commentBody})) > 0
    )
    insert into public.scheduled_job (job_key, kind, run_at, payload)
    select targets.job_key, 'work_ai_teammate', now(), jsonb_build_object(
      'teammateId', targets.work_ai_teammate_id,
      'itemId', ${itemId}::uuid,
      'actorEmployeeId', ${ctx.employeeId}::uuid,
      'requestText', ${commentBody},
      'triggerType', 'mention',
      'eventKey', targets.job_key
    ) from targets
    returning scheduled_job_id
  `);
  return queued.length;
}
