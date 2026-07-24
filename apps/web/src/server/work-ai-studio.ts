import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DEV_USERS, type SessionUser } from "./auth/session";
import { getDb } from "./db";
import { writeAudit } from "./m1-persistence";
import type { TrpcContext } from "./trpc/trpc";
import {
  getDemoWork,
  requireItemAccess,
  requireProjectAccess,
} from "./trpc/work-management-router";
import {
  generateWorkAi,
  workAiActionTypes,
  type WorkAiAction,
  type WorkAiRun,
  type WorkAiStudioDraft,
} from "./work-ai";

export const workAiStudioTriggerTypes = [
  "manual",
  "task_added",
  "task_completed",
  "task_moved",
  "priority_changed",
  "due_date_set",
  "approval_decided",
  "scheduled",
] as const;
export type WorkAiStudioTrigger = (typeof workAiStudioTriggerTypes)[number];

export const workAiStudioWorkflowInputSchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(20_000).default(""),
    triggerType: z.enum(workAiStudioTriggerTypes),
    aiCondition: z.string().trim().max(10_000).nullable().default(null),
    instructions: z.string().trim().min(1).max(20_000),
    referenceText: z.string().trim().max(50_000).default(""),
    allowedActionTypes: z
      .array(z.enum(workAiActionTypes))
      .max(workAiActionTypes.length)
      .default([]),
    model: z.string().trim().min(1).max(200).nullable().default(null),
    scheduleMinutes: z
      .number()
      .int()
      .min(5)
      .max(10_080)
      .nullable()
      .default(null),
  })
  .superRefine((value, ctx) => {
    if (
      (value.triggerType === "scheduled") !==
      (value.scheduleMinutes !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Scheduled workflows require an interval",
        path: ["scheduleMinutes"],
      });
  });
export type WorkAiStudioWorkflowInput = z.infer<
  typeof workAiStudioWorkflowInputSchema
>;

export type WorkAiStudioWorkflow = WorkAiStudioWorkflowInput & {
  workflowId: string;
  status: "draft" | "published" | "paused";
  createdByEmployeeId: string;
  updatedByEmployeeId: string;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  tokenCount: number;
  lastRunAt: string | null;
};

type WorkAiStudioRun = {
  studioRunId: string;
  workflowId: string;
  aiRunId: string | null;
  triggerItemId: string | null;
  triggeredByEmployeeId: string;
  eventKey: string;
  status: "running" | "answered" | "proposed" | "skipped" | "failed";
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

const demoWorkflows = new Map<string, WorkAiStudioWorkflow>();
const demoRuns = new Map<string, WorkAiStudioRun>();
const demoEvents = new Map<string, string>();

function actor(ctx: TrpcContext) {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return ctx.employeeId;
}

function mapWorkflow(row: {
  workflowId: string;
  projectId: string;
  name: string;
  description: string;
  triggerType: WorkAiStudioTrigger;
  aiCondition: string | null;
  instructions: string;
  referenceText: string;
  allowedActionTypes: WorkAiAction["type"][];
  model: string | null;
  status: WorkAiStudioWorkflow["status"];
  scheduleMinutes: number | null;
  createdByEmployeeId: string;
  updatedByEmployeeId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  runCount: number;
  tokenCount: number;
  lastRunAt: Date | string | null;
}): WorkAiStudioWorkflow {
  return {
    ...row,
    allowedActionTypes: row.allowedActionTypes ?? [],
    runCount: Number(row.runCount ?? 0),
    tokenCount: Number(row.tokenCount ?? 0),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    lastRunAt: row.lastRunAt ? new Date(row.lastRunAt).toISOString() : null,
  };
}

async function workflowById(ctx: TrpcContext, workflowId: string) {
  const db = getDb();
  if (!db) {
    const workflow = demoWorkflows.get(workflowId);
    if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
    await requireProjectAccess(ctx, workflow.projectId);
    return workflow;
  }
  const [row] = await db.execute<Parameters<typeof mapWorkflow>[0]>(sql`
    select workflow.work_ai_studio_workflow_id as "workflowId",
      workflow.work_project_id as "projectId", workflow.name,
      workflow.description, workflow.trigger_type as "triggerType",
      workflow.ai_condition as "aiCondition", workflow.instructions,
      workflow.reference_text as "referenceText",
      workflow.allowed_action_types as "allowedActionTypes", workflow.model,
      workflow.status, workflow.schedule_minutes as "scheduleMinutes",
      workflow.created_by_employee_id as "createdByEmployeeId",
      workflow.updated_by_employee_id as "updatedByEmployeeId",
      workflow.created_at as "createdAt", workflow.updated_at as "updatedAt",
      count(run.work_ai_studio_run_id)::int as "runCount",
      coalesce(sum(coalesce(ai.input_tokens, 0) + coalesce(ai.output_tokens, 0)), 0)::int as "tokenCount",
      max(run.created_at) as "lastRunAt"
    from public.work_ai_studio_workflow workflow
    left join public.work_ai_studio_run run
      on run.work_ai_studio_workflow_id = workflow.work_ai_studio_workflow_id
    left join public.work_ai_run ai on ai.work_ai_run_id = run.work_ai_run_id
    where workflow.work_ai_studio_workflow_id = ${workflowId}::uuid
      and workflow.archived_at is null
    group by workflow.work_ai_studio_workflow_id
    limit 1
  `);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProjectAccess(ctx, row.projectId);
  return mapWorkflow(row);
}

export async function listWorkAiStudioWorkflows(ctx: TrpcContext) {
  const db = getDb();
  if (!db) {
    const visible = [];
    for (const workflow of demoWorkflows.values()) {
      try {
        await requireProjectAccess(ctx, workflow.projectId);
        visible.push(workflow);
      } catch (error) {
        if (!(error instanceof TRPCError)) throw error;
      }
    }
    return visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const rows = await db.execute<Parameters<typeof mapWorkflow>[0]>(sql`
    select workflow.work_ai_studio_workflow_id as "workflowId",
      workflow.work_project_id as "projectId", workflow.name,
      workflow.description, workflow.trigger_type as "triggerType",
      workflow.ai_condition as "aiCondition", workflow.instructions,
      workflow.reference_text as "referenceText",
      workflow.allowed_action_types as "allowedActionTypes", workflow.model,
      workflow.status, workflow.schedule_minutes as "scheduleMinutes",
      workflow.created_by_employee_id as "createdByEmployeeId",
      workflow.updated_by_employee_id as "updatedByEmployeeId",
      workflow.created_at as "createdAt", workflow.updated_at as "updatedAt",
      count(run.work_ai_studio_run_id)::int as "runCount",
      coalesce(sum(coalesce(ai.input_tokens, 0) + coalesce(ai.output_tokens, 0)), 0)::int as "tokenCount",
      max(run.created_at) as "lastRunAt"
    from public.work_ai_studio_workflow workflow
    left join public.work_ai_studio_run run
      on run.work_ai_studio_workflow_id = workflow.work_ai_studio_workflow_id
    left join public.work_ai_run ai on ai.work_ai_run_id = run.work_ai_run_id
    where workflow.archived_at is null
    group by workflow.work_ai_studio_workflow_id
    order by workflow.updated_at desc
    limit 200
  `);
  const visible: WorkAiStudioWorkflow[] = [];
  for (const row of rows) {
    try {
      await requireProjectAccess(ctx, row.projectId);
      visible.push(mapWorkflow(row));
    } catch (error) {
      if (!(error instanceof TRPCError)) throw error;
    }
  }
  return visible;
}

export async function createWorkAiStudioWorkflow(
  ctx: TrpcContext,
  raw: WorkAiStudioWorkflowInput,
) {
  const input = workAiStudioWorkflowInputSchema.parse(raw);
  const employeeId = actor(ctx);
  await requireProjectAccess(ctx, input.projectId, "editor");
  const now = new Date().toISOString();
  const workflow: WorkAiStudioWorkflow = {
    ...input,
    allowedActionTypes: [...new Set(input.allowedActionTypes)],
    workflowId: randomUUID(),
    status: "draft",
    createdByEmployeeId: employeeId,
    updatedByEmployeeId: employeeId,
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    tokenCount: 0,
    lastRunAt: null,
  };
  const db = getDb();
  if (!db) demoWorkflows.set(workflow.workflowId, workflow);
  else
    await db.execute(sql`
      insert into public.work_ai_studio_workflow (
        work_ai_studio_workflow_id, work_project_id, name, description,
        trigger_type, ai_condition, instructions, reference_text,
        allowed_action_types, model, schedule_minutes,
        created_by_employee_id, updated_by_employee_id
      ) values (
        ${workflow.workflowId}::uuid, ${input.projectId}::uuid, ${input.name},
        ${input.description}, ${input.triggerType}, ${input.aiCondition},
        ${input.instructions}, ${input.referenceText},
        ${workflow.allowedActionTypes}::text[], ${input.model},
        ${input.scheduleMinutes}, ${employeeId}::uuid, ${employeeId}::uuid
      )
    `);
  await writeAudit({
    actorEmployeeId: employeeId,
    action: "work.ai.studio.workflow.create",
    entityType: "work_ai_studio_workflow",
    entityId: workflow.workflowId,
    before: null,
    after: { projectId: workflow.projectId, triggerType: workflow.triggerType },
    reason: null,
  });
  return workflow;
}

export async function updateWorkAiStudioWorkflow(
  ctx: TrpcContext,
  workflowId: string,
  raw: WorkAiStudioWorkflowInput,
) {
  const input = workAiStudioWorkflowInputSchema.parse(raw);
  const employeeId = actor(ctx);
  const current = await workflowById(ctx, workflowId);
  await Promise.all([
    requireProjectAccess(ctx, current.projectId, "editor"),
    requireProjectAccess(ctx, input.projectId, "editor"),
  ]);
  const allowedActionTypes = [...new Set(input.allowedActionTypes)];
  const db = getDb();
  if (!db) {
    Object.assign(current, input, {
      allowedActionTypes,
      updatedByEmployeeId: employeeId,
      updatedAt: new Date().toISOString(),
    });
  } else {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        update public.work_ai_studio_workflow set
          work_project_id = ${input.projectId}::uuid, name = ${input.name},
          description = ${input.description}, trigger_type = ${input.triggerType},
          ai_condition = ${input.aiCondition}, instructions = ${input.instructions},
          reference_text = ${input.referenceText},
          allowed_action_types = ${allowedActionTypes}::text[], model = ${input.model},
          schedule_minutes = ${input.scheduleMinutes},
          updated_by_employee_id = ${employeeId}::uuid, updated_at = now()
        where work_ai_studio_workflow_id = ${workflowId}::uuid
          and archived_at is null
      `);
      await tx.execute(sql`
        update public.scheduled_job set status = 'completed', completed_at = now(),
          locked_at = null, updated_at = now()
        where job_key = ${`ai-studio-schedule:${workflowId}`}
          and status in ('pending', 'running')
      `);
      if (current.status === "published" && input.triggerType === "scheduled")
        await tx.execute(sql`
          insert into public.scheduled_job (job_key, kind, run_at, payload)
          values (
            ${`ai-studio-schedule:${workflowId}`}, 'work_ai_studio',
            now() + (${input.scheduleMinutes}::text || ' minutes')::interval,
            ${JSON.stringify({
              workflowId,
              itemId: null,
              actorEmployeeId: current.createdByEmployeeId,
              eventKey: `schedule:${workflowId}`,
              recurring: true,
            })}::jsonb
          ) on conflict (job_key) do update set status = 'pending',
            run_at = excluded.run_at, payload = excluded.payload, attempts = 0,
            locked_at = null, completed_at = null, last_error = null, updated_at = now()
        `);
    });
  }
  await writeAudit({
    actorEmployeeId: employeeId,
    action: "work.ai.studio.workflow.update",
    entityType: "work_ai_studio_workflow",
    entityId: workflowId,
    before: { projectId: current.projectId, triggerType: current.triggerType },
    after: { projectId: input.projectId, triggerType: input.triggerType },
    reason: null,
  });
  return workflowById(ctx, workflowId);
}

export async function setWorkAiStudioWorkflowStatus(
  ctx: TrpcContext,
  workflowId: string,
  status: "published" | "paused",
) {
  const employeeId = actor(ctx);
  const workflow = await workflowById(ctx, workflowId);
  await requireProjectAccess(ctx, workflow.projectId, "editor");
  const db = getDb();
  if (!db) {
    workflow.status = status;
    workflow.updatedByEmployeeId = employeeId;
    workflow.updatedAt = new Date().toISOString();
  } else {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        update public.work_ai_studio_workflow set status = ${status},
          updated_by_employee_id = ${employeeId}::uuid, updated_at = now()
        where work_ai_studio_workflow_id = ${workflowId}::uuid
          and archived_at is null
      `);
      await tx.execute(sql`
        update public.scheduled_job set status = 'completed', completed_at = now(),
          locked_at = null, updated_at = now()
        where job_key = ${`ai-studio-schedule:${workflowId}`}
          and status in ('pending', 'running')
      `);
      if (status === "published" && workflow.triggerType === "scheduled")
        await tx.execute(sql`
          insert into public.scheduled_job (job_key, kind, run_at, payload)
          values (
            ${`ai-studio-schedule:${workflowId}`}, 'work_ai_studio',
            now() + (${workflow.scheduleMinutes}::text || ' minutes')::interval,
            ${JSON.stringify({
              workflowId,
              itemId: null,
              actorEmployeeId: workflow.createdByEmployeeId,
              eventKey: `schedule:${workflowId}`,
              recurring: true,
            })}::jsonb
          ) on conflict (job_key) do update set status = 'pending',
            run_at = excluded.run_at, payload = excluded.payload, attempts = 0,
            locked_at = null, completed_at = null, last_error = null, updated_at = now()
        `);
    });
  }
  await writeAudit({
    actorEmployeeId: employeeId,
    action: `work.ai.studio.workflow.${status}`,
    entityType: "work_ai_studio_workflow",
    entityId: workflowId,
    before: { status: workflow.status },
    after: { status },
    reason: null,
  });
  return workflowById(ctx, workflowId);
}

export async function archiveWorkAiStudioWorkflow(
  ctx: TrpcContext,
  workflowId: string,
) {
  const employeeId = actor(ctx);
  const workflow = await workflowById(ctx, workflowId);
  await requireProjectAccess(ctx, workflow.projectId, "editor");
  const db = getDb();
  if (!db) demoWorkflows.delete(workflowId);
  else
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        update public.work_ai_studio_workflow set status = 'paused',
          archived_at = now(), updated_by_employee_id = ${employeeId}::uuid,
          updated_at = now()
        where work_ai_studio_workflow_id = ${workflowId}::uuid
      `);
      await tx.execute(sql`
        update public.scheduled_job set status = 'completed', completed_at = now(),
          locked_at = null, updated_at = now()
        where job_key = ${`ai-studio-schedule:${workflowId}`}
          and status in ('pending', 'running')
      `);
    });
  await writeAudit({
    actorEmployeeId: employeeId,
    action: "work.ai.studio.workflow.archive",
    entityType: "work_ai_studio_workflow",
    entityId: workflowId,
    before: { status: workflow.status },
    after: { archived: true },
    reason: null,
  });
  return { ok: true as const };
}

async function requireWorkflowItem(
  ctx: TrpcContext,
  projectId: string,
  itemId: string,
) {
  await requireItemAccess(ctx, itemId);
  const db = getDb();
  if (!db) {
    if (getDemoWork().items.get(itemId)?.projectId !== projectId)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Task is not in this project",
      });
    return;
  }
  const membership = await db.execute(sql`
    select 1 from public.work_project_item
    where work_project_id = ${projectId}::uuid and work_item_id = ${itemId}::uuid
    limit 1
  `);
  if (!membership[0])
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Task is not in this project",
    });
}

export async function runWorkAiStudioWorkflow(input: {
  ctx: TrpcContext;
  workflowId: string;
  itemId: string | null;
  eventKey?: string;
  triggeredByEmployeeId?: string;
  allowDraft?: boolean;
}) {
  const workflow = await workflowById(input.ctx, input.workflowId);
  const employeeId = actor(input.ctx);
  if (workflow.status !== "published" && !input.allowDraft)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Workflow is not published",
    });
  await requireProjectAccess(
    input.ctx,
    workflow.projectId,
    workflow.status === "published" ? "viewer" : "editor",
  );
  if (input.itemId)
    await requireWorkflowItem(input.ctx, workflow.projectId, input.itemId);
  const eventKey = input.eventKey ?? `manual:${randomUUID()}`;
  let studioRunId: string = randomUUID();
  const triggeredByEmployeeId = input.triggeredByEmployeeId ?? employeeId;
  const db = getDb();
  if (!db) {
    const eventId = `${workflow.workflowId}:${eventKey}`;
    const duplicate = demoEvents.get(eventId);
    if (duplicate && demoRuns.get(duplicate)?.status !== "failed")
      return { duplicate: true as const, studioRunId: duplicate, run: null };
    if (duplicate) studioRunId = duplicate;
    else demoEvents.set(eventId, studioRunId);
    demoRuns.set(studioRunId, {
      studioRunId,
      workflowId: workflow.workflowId,
      aiRunId: null,
      triggerItemId: input.itemId,
      triggeredByEmployeeId,
      eventKey,
      status: "running",
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
  } else {
    const inserted = await db.execute<{ studioRunId: string }>(sql`
      insert into public.work_ai_studio_run (
        work_ai_studio_run_id, work_ai_studio_workflow_id, trigger_item_id,
        triggered_by_employee_id, event_key
      ) values (
        ${studioRunId}::uuid, ${workflow.workflowId}::uuid,
        ${input.itemId}::uuid, ${triggeredByEmployeeId}::uuid, ${eventKey}
      ) on conflict (work_ai_studio_workflow_id, event_key) do update set
        status = 'running', error_message = null, completed_at = null
      where work_ai_studio_run.status = 'failed'
      returning work_ai_studio_run_id as "studioRunId"
    `);
    if (!inserted[0])
      return { duplicate: true as const, studioRunId: null, run: null };
    studioRunId = inserted[0].studioRunId;
  }
  try {
    const run = await generateWorkAi({
      ctx: input.ctx,
      kind: "studio",
      requestText: `Run AI Studio workflow: ${workflow.name}`,
      projectIds: [workflow.projectId],
      itemId: input.itemId,
      workflowInstructions: workflow.instructions,
      referenceText: workflow.referenceText,
      aiCondition: workflow.aiCondition,
      allowedActionTypes: workflow.allowedActionTypes,
      model: workflow.model,
    });
    const status = !run.result?.conditionMatched
      ? "skipped"
      : run.status === "proposed"
        ? "proposed"
        : "answered";
    if (!db) {
      const stored = demoRuns.get(studioRunId)!;
      stored.aiRunId = run.runId;
      stored.status = status;
      stored.completedAt = new Date().toISOString();
      workflow.runCount += 1;
      workflow.lastRunAt = stored.completedAt;
    } else
      await db.execute(sql`
        update public.work_ai_studio_run set work_ai_run_id = ${run.runId}::uuid,
          status = ${status}, completed_at = now()
        where work_ai_studio_run_id = ${studioRunId}::uuid
      `);
    await writeAudit({
      actorEmployeeId: employeeId,
      action: "work.ai.studio.workflow.run",
      entityType: "work_ai_studio_workflow",
      entityId: workflow.workflowId,
      before: null,
      after: { studioRunId, aiRunId: run.runId, status },
      reason: null,
    });
    return { duplicate: false as const, studioRunId, run };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 2_000)
        : "Workflow failed";
    if (!db) {
      const stored = demoRuns.get(studioRunId);
      if (stored) {
        stored.status = "failed";
        stored.errorMessage = message;
        stored.completedAt = new Date().toISOString();
      }
    } else
      await db.execute(sql`
        update public.work_ai_studio_run set status = 'failed',
          error_message = ${message}, completed_at = now()
        where work_ai_studio_run_id = ${studioRunId}::uuid
      `);
    throw error;
  }
}

export async function draftWorkAiStudioWorkflow(
  ctx: TrpcContext,
  requestText: string,
): Promise<{ draft: WorkAiStudioDraft; run: WorkAiRun }> {
  const run = await generateWorkAi({
    ctx,
    kind: "studio",
    purpose: "studio_draft",
    requestText,
    projectIds: [],
    itemId: null,
    allowedActionTypes: [],
  });
  if (!run.result?.studioDraft)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "AI did not return a valid workflow draft",
    });
  return { draft: run.result.studioDraft, run };
}

async function contextForEmployee(employeeId: string): Promise<TrpcContext> {
  const demo = Object.values(DEV_USERS).find(
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
  if (!db) throw new Error("Workflow actor is unavailable");
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
  if (!employee) throw new Error("Workflow actor is unavailable");
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

export async function runWorkAiStudioJob(input: {
  workflowId: string;
  itemId: string | null;
  actorEmployeeId: string;
  eventKey: string;
  recurring: boolean;
}) {
  const actorContext = await contextForEmployee(input.actorEmployeeId);
  const visible = await workflowById(actorContext, input.workflowId);
  if (visible.status !== "published")
    return {
      duplicate: false as const,
      studioRunId: null,
      run: null,
      recurring: false,
      scheduleMinutes: visible.scheduleMinutes,
      disabled: true,
    };
  const ownerContext = await contextForEmployee(visible.createdByEmployeeId);
  await workflowById(ownerContext, input.workflowId);
  const result = await runWorkAiStudioWorkflow({
    ctx: ownerContext,
    workflowId: input.workflowId,
    itemId: input.itemId,
    eventKey: input.eventKey,
    triggeredByEmployeeId: input.actorEmployeeId,
  });
  return {
    ...result,
    recurring: input.recurring && visible.status === "published",
    scheduleMinutes: visible.scheduleMinutes,
  };
}

export function clearDemoWorkAiStudio() {
  demoWorkflows.clear();
  demoRuns.clear();
  demoEvents.clear();
}
