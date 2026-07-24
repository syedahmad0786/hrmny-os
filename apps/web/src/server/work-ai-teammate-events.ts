import { sql } from "@hrmny/db";
import { getDb } from "./db";
import type { TrpcContext } from "./trpc/trpc";

export async function queueAssignedWorkAiTeammate(
  ctx: TrpcContext,
  itemId: string,
  assigneeEmployeeId: string | null,
) {
  if (!ctx.employeeId || !assigneeEmployeeId) return 0;
  const db = getDb();
  if (!db) return 0;
  const queued = await db.execute(sql`
    with target as (
      select teammate.work_ai_teammate_id,
        'ai-teammate-assignment:' || teammate.work_ai_teammate_id::text || ':' || gen_random_uuid()::text as job_key
      from public.work_ai_teammate teammate
      join public.work_ai_teammate_member member
        on member.work_ai_teammate_id = teammate.work_ai_teammate_id
        and member.employee_id = ${ctx.employeeId}::uuid
      where teammate.employee_id = ${assigneeEmployeeId}::uuid
        and teammate.status = 'active' and teammate.archived_at is null
      limit 1
    )
    insert into public.scheduled_job (job_key, kind, run_at, payload)
    select target.job_key, 'work_ai_teammate', now(), jsonb_build_object(
      'teammateId', target.work_ai_teammate_id,
      'itemId', ${itemId}::uuid,
      'actorEmployeeId', ${ctx.employeeId}::uuid,
      'requestText', 'Work on this assigned task and propose the next useful actions.',
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
