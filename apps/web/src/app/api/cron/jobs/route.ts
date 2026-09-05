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
import { inngestCloudConfigured } from "@/server/inngest/client";
import { runCrmTaskDigest } from "@/server/reminders/crm-task-digest";
import { runLeadgenDailyCron } from "@/server/leadgen/daily-cron";
import { runDueFollowupDrafts } from "@/server/leadgen/followup-scheduler";
import { runGoogleWorkspaceOutreachMonitor } from "@/server/leadgen/google-workspace-monitor";
import { runReconSweepers } from "@/server/recon/cron-sweepers";
import {
  APOLLO_PEOPLE_SEARCH_JOB_KIND,
  APOLLO_PROVIDER_CONCURRENCY_KEY,
  redactExpiredApolloPeopleSearchCandidates,
  runApolloPeopleSearchQueuedJob,
} from "@/server/sales-os/apollo-search";
import { getSalesOsSettings } from "@/server/sales-os/store";
import {
  failGoogleChatInteractionJob,
  GOOGLE_CHAT_INTERACTION_JOB_KIND,
  runGoogleChatInteractionJob,
} from "@/server/google-chat";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  // Retention runs before any external call so a slow provider backlog cannot
  // starve governed erasure. Failure is isolated and surfaced as a health
  // signal; the next cron tick retries it.
  let apolloCandidatesRedacted = 0;
  let apolloRedactionError: string | null = null;
  let apolloRedactionBacklog = false;
  try {
    const settings = await getSalesOsSettings();
    const batchLimit = 500;
    const maxBatches = 20;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const redacted = await redactExpiredApolloPeopleSearchCandidates({
        retentionMonths: settings.retentionMonths,
        limit: batchLimit,
      });
      apolloCandidatesRedacted += redacted;
      if (redacted < batchLimit) break;
      if (batch === maxBatches - 1) apolloRedactionBacklog = true;
    }
    if (apolloRedactionBacklog) {
      await emitHealthSignal("apollo_candidate_retention_backlog", "warn", {
        redacted: apolloCandidatesRedacted,
        batchLimit,
        maxBatches,
      });
    }
  } catch {
    apolloRedactionError = "APOLLO_CANDIDATE_REDACTION_FAILED";
    await emitHealthSignal("apollo_candidate_retention", "warn", {
      reason: apolloRedactionError,
    }).catch(() => undefined);
  }

  // Apollo jobs own a shared job/receipt attempt fence. Both cron fallback and
  // Inngest enter through the same claimant; the generic worker must not claim
  // or reset those rows independently.
  const apolloDue = await db.execute<{ scheduled_job_id: string }>(sql`
    select candidate.scheduled_job_id
    from public.scheduled_job candidate
    where candidate.kind = ${APOLLO_PEOPLE_SEARCH_JOB_KIND}
      and candidate.concurrency_key = ${APOLLO_PROVIDER_CONCURRENCY_KEY}
      and (
        (
          candidate.status = 'running'
          and (
            candidate.lease_expires_at is null
            or candidate.lease_expires_at <= now()
          )
        )
        or (
          candidate.status = 'pending'
          and candidate.run_at <= now()
          and not exists (
            select 1
            from public.scheduled_job active
            where active.concurrency_key = candidate.concurrency_key
              and active.status = 'running'
          )
        )
      )
    order by
      case when candidate.status = 'running' then 0 else 1 end,
      coalesce(
        candidate.lease_expires_at,
        candidate.locked_at,
        candidate.run_at
      ),
      candidate.run_at,
      candidate.scheduled_job_id
    limit 1
  `);
  let apolloCompleted = 0;
  let apolloFailed = 0;
  let apolloRuntimeFailures = 0;
  for (const job of apolloDue) {
    let outcome: Awaited<ReturnType<typeof runApolloPeopleSearchQueuedJob>>;
    try {
      outcome = await runApolloPeopleSearchQueuedJob(job.scheduled_job_id);
    } catch {
      apolloFailed += 1;
      apolloRuntimeFailures += 1;
      await emitHealthSignal("apollo_people_search_worker", "warn", {
        jobId: job.scheduled_job_id,
        reason: "APOLLO_WORKER_RUNTIME_FAILURE",
      }).catch(() => undefined);
      continue;
    }
    if (outcome.status === "failed" || outcome.status === "dead_letter") {
      apolloFailed += 1;
    } else if (outcome.status === "completed" || outcome.status === "revoked") {
      apolloCompleted += 1;
    }
  }
  await db.execute(sql`
    update scheduled_job
    set status = 'pending', locked_at = null, updated_at = now()
    where status = 'running' and locked_at < now() - interval '10 minutes'
      and kind <> ${APOLLO_PEOPLE_SEARCH_JOB_KIND}
  `);
  const claimedResult = await db.execute(sql`
    with due as (
      select scheduled_job_id
      from scheduled_job
      where status = 'pending' and run_at <= now()
        and kind <> ${APOLLO_PEOPLE_SEARCH_JOB_KIND}
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
      } else if (job.kind === GOOGLE_CHAT_INTERACTION_JOB_KIND) {
        result = await runGoogleChatInteractionJob(job.payload);
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
          payload:
            job.kind === GOOGLE_CHAT_INTERACTION_JOB_KIND
              ? {}
              : (job.payload as Record<string, unknown>),
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
      const retryDelaySeconds = 5 * 60;
      if (!retry && job.kind === GOOGLE_CHAT_INTERACTION_JOB_KIND) {
        await failGoogleChatInteractionJob(job.payload, error).catch(
          () => undefined,
        );
      }
      await db
        .update(scheduledJob)
        .set({
          status: retry ? "pending" : "failed",
          runAt: retry
            ? new Date(Date.now() + retryDelaySeconds * 1_000)
            : new Date(),
          payload:
            !retry && job.kind === GOOGLE_CHAT_INTERACTION_JOB_KIND
              ? {}
              : (job.payload as Record<string, unknown>),
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
  const useInngest = inngestCloudConfigured();
  const googleWorkspaceInbox = useInngest
    ? { skipped: "inngest_configured" as const }
    : await runGoogleWorkspaceOutreachMonitor().catch((error) => ({
        error: String(error).slice(0, 500),
      }));
  const [
    workWebhooks,
    expiredAiRuns,
    dueReports,
    crmTaskDigest,
    leadgenDaily,
    salesFollowupDrafts,
    recon,
  ] = await Promise.all([
    deliverPendingWorkWebhooks(),
    cleanupExpiredWorkAiRuns(),
    // Scheduled reports: interval-based due-check filters to what should send
    // this tick (mock Resend until RESEND_MODE=live). Never fatal to the job run.
    useInngest
      ? Promise.resolve({ skipped: "inngest_configured" as const })
      : runDueReports().catch((error) => ({
          error: String(error).slice(0, 500),
        })),
    // CRM task digest: once/day owner nudge via Google Chat. Self-gates on
    // webhook env + hour window + today's health_signal row. Never fatal.
    runCrmTaskDigest().catch((error) => ({
      posted: false,
      error: String(error).slice(0, 500),
    })),
    // Daily Sales research gate. It fails closed before provider/CRM work
    // until the audited policy and proposal-only runtime are both present.
    useInngest
      ? Promise.resolve({
          ran: false,
          skipped: "inngest_configured" as const,
        })
      : runLeadgenDailyCron().catch((error) => ({
          ran: false,
          error: String(error).slice(0, 500),
        })),
    useInngest
      ? Promise.resolve({ skipped: "inngest_configured" as const })
      : "error" in googleWorkspaceInbox
        ? Promise.resolve({ skipped: "gmail_monitor_failed" as const })
        : runDueFollowupDrafts().catch((error) => ({
            error: String(error).slice(0, 500),
          })),
    // Xero mirror, competitor scan, retainer drafts, memory embed backfill.
    // Mock-safe; never fatal to the job run.
    runReconSweepers().catch((error) => ({
      error: String(error).slice(0, 500),
    })),
  ]);
  const responseBody = {
    claimed: claimed.length,
    completed,
    failed,
    apollo: {
      considered: apolloDue.length,
      completed: apolloCompleted,
      failed: apolloFailed,
      runtimeFailures: apolloRuntimeFailures,
      candidatesRedacted: apolloCandidatesRedacted,
      redactionError: apolloRedactionError,
      redactionBacklog: apolloRedactionBacklog,
    },
    workWebhooks,
    expiredAiRuns,
    dueReports,
    crmTaskDigest,
    leadgenDaily,
    googleWorkspaceInbox,
    salesFollowupDrafts,
    recon,
  };
  return Response.json(responseBody, {
    status: apolloRuntimeFailures > 0 ? 500 : 200,
  });
}
