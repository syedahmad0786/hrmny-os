import { sql } from "@hrmny/db";
import { getDb } from "./db";
import type { TrpcContext } from "./trpc/trpc";

export type WorkAiStudioEvent =
  | "task_added"
  | "task_completed"
  | "task_moved"
  | "priority_changed"
  | "due_date_set"
  | "approval_decided";

export async function queueWorkAiStudioEvent(
  ctx: TrpcContext,
  projectId: string,
  itemId: string,
  triggerType: WorkAiStudioEvent,
) {
  if (!ctx.employeeId) return 0;
  const db = getDb();
  if (!db) return 0;
  const queued = await db.execute(sql`
    with jobs as (
      select workflow.work_ai_studio_workflow_id,
        'ai-studio-event:' || workflow.work_ai_studio_workflow_id::text || ':' || gen_random_uuid()::text as job_key
      from public.work_ai_studio_workflow workflow
      where workflow.work_project_id = ${projectId}::uuid
        and workflow.trigger_type = ${triggerType}
        and workflow.status = 'published' and workflow.archived_at is null
    )
    insert into public.scheduled_job (job_key, kind, run_at, payload)
    select jobs.job_key, 'work_ai_studio', now(), jsonb_build_object(
      'workflowId', jobs.work_ai_studio_workflow_id,
      'itemId', ${itemId}::uuid,
      'actorEmployeeId', ${ctx.employeeId}::uuid,
      'eventKey', jobs.job_key,
      'recurring', false
    ) from jobs
    returning scheduled_job_id
  `);
  return queued.length;
}
