import { eq, scheduledJob, sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "@/server/db";
import { emitHealthSignal } from "@/server/m1-persistence";
import { featureEnabled } from "@/server/features";
import { syncAsanaWorkspace } from "@/server/asana-sync";
import { getVerifiedAsanaConnection } from "@/server/trpc/connections-router";
import { refreshAsanaWebhooksIfEnabled } from "@/server/asana-webhooks";
import { deliverPendingWorkWebhooks } from "@/server/work-api";
import { cleanupExpiredWorkAiRuns } from "@/server/work-ai";
import { runWorkAiStudioJob } from "@/server/work-ai-studio";
import { runWorkAiTeammateJob } from "@/server/work-ai-teammates";
import { runWorkFormReceiptJob } from "@/server/work-form-receipts";
import { runScheduledWorkRuleJob } from "@/server/trpc/work-management-router";
import { runDueReports } from "@/server/inngest/report-scheduler";
import { runCrmTaskDigest } from "@/server/reminders/crm-task-digest";
import { runLeadgenDailyCron } from "@/server/leadgen/daily-cron";
import { runReconSweepers } from "@/server/recon/cron-sweepers";

export const dynamic = "force-dynamic";

const HealthJobSchema = z.object({
  signalKey: z.string().min(1).max(120),
  severity: z.enum(["info", "warn", "critical"]),
  payload: z.record(z.unknown()).default({}),
});
const AsanaSyncJobSchema = z.object({
  workspaceGid: z.string().min(1).max(120),
  workspaceName: z.string().min(1).max(300),
  actorEmployeeId: z.string().uuid(),
});
const WorkAiStudioJobSchema = z.object({
  workflowId: z.string().uuid(),
  itemId: z.string().uuid().nullable(),
  actorEmployeeId: z.string().uuid(),
  eventKey: z.string().min(1).max(500),
  recurring: z.boolean(),
});
const WorkAiTeammateJobSchema = z.object({
  teammateId: z.string().uuid(),
  itemId: z.string().uuid(),
  actorEmployeeId: z.string().uuid(),
  requestText: z.string().trim().min(1).max(10_000),
  triggerType: z.enum(["assignment", "mention", "rule", "follow_up"]),
  eventKey: z.string().min(1).max(500),
});

type ClaimedJob = {
  scheduled_job_id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  run_at: Date | string;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = getDb();
  if (!db) return new Response("DATABASE_URL missing", { status: 503 });

  await db.execute(sql`
    update scheduled_job
    set status = 'pending', locked_at = null, updated_at = now()
    where status = 'running' and locked_at < now() - interval '10 minutes'
  `);
  const claimedResult = await db.execute(sql`
    with due as (
      select scheduled_job_id
      from scheduled_job
      where status = 'pending' and run_at <= now()
      order by run_at
      for update skip locked
      limit 20
    )
    update scheduled_job job
    set status = 'running', locked_at = now(), attempts = attempts + 1,
        updated_at = now()
    from due
    where job.scheduled_job_id = due.scheduled_job_id
    returning job.scheduled_job_id, job.kind, job.payload, job.attempts, job.run_at
  `);
  const claimed = Array.from(claimedResult) as unknown as ClaimedJob[];

  let completed = 0;
  let failed = 0;
  for (const job of claimed) {
    try {
      let result: Record<string, unknown> = { ok: true };
      let recurring = false;
      let nextRunAt: Date | null = null;
      if (job.kind === "health_signal") {
        const payload = HealthJobSchema.parse(job.payload);
        await emitHealthSignal(
          payload.signalKey,
          payload.severity,
          payload.payload,
        );
      } else if (job.kind === "asana_sync") {
        const payload = AsanaSyncJobSchema.parse(job.payload);
        const roles = await db.execute<{ key: string }>(sql`
          select role.key from public.employee_role membership
          join public.role role on role.role_id = membership.role_id
          where membership.employee_id = ${payload.actorEmployeeId}::uuid
        `);
        const enabled = await featureEnabled("asana.sync", {
          userId: payload.actorEmployeeId,
          roles: roles.map((role) => role.key),
        });
        if (enabled) {
          const verified = await getVerifiedAsanaConnection(
            payload.actorEmployeeId,
          );
          if (!verified) throw new Error("Asana connection is unavailable");
          const synced = await syncAsanaWorkspace({
            db,
            adapter: verified.adapter,
            workspaceGid: payload.workspaceGid,
            workspaceName: payload.workspaceName,
            connectedAccountId: verified.account.id,
            actorEmployeeId: payload.actorEmployeeId,
          });
          const webhookRefresh = synced.reconciled
            ? await refreshAsanaWebhooksIfEnabled({
                adapter: verified.adapter,
                connectedAccountId: verified.account.id,
                workspace: {
                  gid: payload.workspaceGid,
                  name: payload.workspaceName,
                },
                employeeId: payload.actorEmployeeId,
              }).catch((error) => ({
                error:
                  error instanceof Error
                    ? error.message.slice(0, 500)
                    : "Webhook refresh failed",
              }))
            : null;
          result = { ...synced, webhookRefresh };
          recurring = true;
        } else result = { ok: true, disabled: true };
      } else if (job.kind === "work_ai_studio") {
        const payload = WorkAiStudioJobSchema.parse(job.payload);
        const studio = await runWorkAiStudioJob({
          ...payload,
          eventKey: payload.recurring
            ? `${payload.eventKey}:${new Date(job.run_at).toISOString()}`
            : payload.eventKey,
        });
        result = studio;
        recurring = studio.recurring;
        nextRunAt = recurring
          ? new Date(Date.now() + (studio.scheduleMinutes ?? 5) * 60_000)
          : null;
      } else if (job.kind === "work_ai_teammate") {
        const payload = WorkAiTeammateJobSchema.parse(job.payload);
        result = await runWorkAiTeammateJob(payload);
      } else if (job.kind === "work_form_receipt") {
        result = await runWorkFormReceiptJob(job.payload);
      } else if (job.kind === "work_rule") {
        const ruleRun = await runScheduledWorkRuleJob(job.payload);
        result = ruleRun;
        recurring = ruleRun.recurring;
        nextRunAt = recurring
          ? new Date(Date.now() + (ruleRun.scheduleMinutes ?? 15) * 60_000)
          : null;
      } else {
        throw new Error(`Unsupported job kind: ${job.kind}`);
      }
      await db
        .update(scheduledJob)
        .set({
          status: recurring ? "pending" : "completed",
          runAt: recurring
            ? (nextRunAt ?? new Date(Date.now() + 5 * 60_000))
            : new Date(),
          attempts: recurring ? 0 : job.attempts,
          lockedAt: null,
          completedAt: recurring ? null : new Date(),
          result,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(scheduledJob.scheduledJobId, job.scheduled_job_id));
      completed += 1;
    } catch (error) {
      const retry = Number(job.attempts) < 3;
      await db
        .update(scheduledJob)
        .set({
          status: retry ? "pending" : "failed",
          runAt: retry ? new Date(Date.now() + 5 * 60_000) : new Date(),
          lockedAt: null,
          lastError: String(error).slice(0, 2_000),
          updatedAt: new Date(),
        })
        .where(eq(scheduledJob.scheduledJobId, job.scheduled_job_id));
      failed += 1;
    }
  }

  const [lag] = await db.execute(sql<{ count: number }>`
    select count(*)::int as count
    from scheduled_job
    where status = 'pending' and run_at < now() - interval '5 minutes'
  `);
  if (Number(lag?.count ?? 0) > 0) {
    await emitHealthSignal("job_lag", "warn", {
      delayedJobs: Number(lag!.count),
    });
  }
  const [workWebhooks, expiredAiRuns, dueReports, crmTaskDigest, leadgenDaily, recon] =
    await Promise.all([
      deliverPendingWorkWebhooks(),
      cleanupExpiredWorkAiRuns(),
      // Scheduled reports: interval-based due-check filters to what should send
      // this tick (mock Resend until RESEND_MODE=live). Never fatal to the job run.
      runDueReports().catch((error) => ({ error: String(error).slice(0, 500) })),
      // CRM task digest: once/day owner nudge via Google Chat. Self-gates on
      // webhook env + hour window + today's health_signal row. Never fatal.
      runCrmTaskDigest().catch((error) => ({
        posted: false,
        error: String(error).slice(0, 500),
      })),
      // Daily lead-gen pipeline (Apollo/Hunter live when keyed). Never fatal.
      runLeadgenDailyCron().catch((error) => ({
        ran: false,
        error: String(error).slice(0, 500),
      })),
      // Xero mirror, competitor scan, retainer drafts, memory embed backfill.
      // Mock-safe; never fatal to the job run.
      runReconSweepers().catch((error) => ({
        error: String(error).slice(0, 500),
      })),
    ]);
  return Response.json({
    claimed: claimed.length,
    completed,
    failed,
    workWebhooks,
    expiredAiRuns,
    dueReports,
    crmTaskDigest,
    leadgenDaily,
    recon,
  });
}
