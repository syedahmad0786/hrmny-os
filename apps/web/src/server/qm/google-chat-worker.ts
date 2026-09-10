import { createHash, randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import { resolveActiveStaffById } from "../auth/session";
import {
  dispatchGoogleChatInteraction,
  googleChatJobSchema,
  GOOGLE_CHAT_INTERACTION_JOB_KIND,
  GOOGLE_CHAT_QM_JOB_KIND,
  qmGoogleChatAllowed,
} from "../google-chat";

const ref = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9:_-]+$/);
const lease = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
});
export const qmChatWorkerRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }).strict(),
  lease.extend({ action: z.literal("renew"), runId: ref.optional() }).strict(),
  lease
    .extend({
      action: z.literal("complete"),
      runId: ref.optional(),
      result: z
        .object({
          status: z.enum([
            "ok",
            "refused",
            "failed",
            "pending_approval",
            "silent",
            "react",
          ]),
          reply: z.string().max(32_000).optional(),
          sessionId: ref.optional(),
        })
        .strict(),
    })
    .strict(),
]);

type JobRow = {
  scheduled_job_id: string;
  payload: unknown;
  result: Record<string, unknown> | null;
  integration_inbox_id: string;
  owner_employee_id: string;
};

function threadRef(employeeId: string, email: string, externalRef: string) {
  // Native QM enables web continuation and approvals only on the principal's web thread namespace.
  return `web:${email}:google-chat-${employeeId}-${createHash("sha256").update(externalRef).digest("hex")}`;
}

/** Only the private source worker calls this; delivery remains in the existing OS worker. */
export async function operateQmGoogleChat(raw: unknown) {
  const input = qmChatWorkerRequest.parse(raw);
  if (process.env.GOOGLE_CHAT_RUNTIME !== "qm")
    throw new Error("QM_CHAT_DISABLED");
  const db = getDb();
  if (!db) throw new Error("QM_CHAT_DATABASE_REQUIRED");
  let row: JobRow | undefined;
  let claimToken: string;
  if (input.action === "claim") {
    claimToken = randomUUID();
    // Failed leases are retained for inspection; never silently re-run indefinitely.
    await db.execute(sql`
      with expired as (
        update public.scheduled_job set status = 'failed', locked_at = null,
          last_error = 'QM_CHAT_LEASE_EXHAUSTED', updated_at = now()
        where kind = ${GOOGLE_CHAT_QM_JOB_KIND} and attempts >= 3
          and status = 'running' and locked_at < now() - interval '2 minutes'
        returning integration_inbox_id
      )
      update public.integration_inbox i set status = 'failed',
        last_error = 'QM_CHAT_LEASE_EXHAUSTED', updated_at = now()
      from expired e where i.integration_inbox_id = e.integration_inbox_id
        and i.provider = 'google-chat' and i.status = 'processing'
    `);
    [row] = await db.execute<JobRow>(sql`
      with due as (
        select j.scheduled_job_id from public.scheduled_job j
        join public.integration_inbox i on i.integration_inbox_id = j.integration_inbox_id
        where j.kind = ${GOOGLE_CHAT_QM_JOB_KIND} and j.run_at <= now()
          and j.attempts < 3 and (j.status = 'pending' or
            (j.status = 'running' and j.locked_at < now() - interval '2 minutes'))
          and i.provider = 'google-chat' and i.status = 'processing'
          and i.owner_employee_id::text = j.payload ->> 'employeeId'
        order by j.run_at for update of j skip locked limit 1
      ), claimed as (
        update public.scheduled_job j set status = 'running', locked_at = now(),
          attempts = attempts + 1, updated_at = now(),
          result = coalesce(result, '{}'::jsonb) || jsonb_build_object('claimToken', ${claimToken}::text)
        from due where j.scheduled_job_id = due.scheduled_job_id returning j.*
      )
      select c.scheduled_job_id, c.payload, c.result, c.integration_inbox_id, i.owner_employee_id
      from claimed c join public.integration_inbox i on i.integration_inbox_id = c.integration_inbox_id
    `);
    if (!row) return { job: null };
  } else {
    claimToken = input.claimToken;
    [row] = await db.execute<JobRow>(sql`
      select j.scheduled_job_id, j.payload, j.result, j.integration_inbox_id, i.owner_employee_id
      from public.scheduled_job j
      join public.integration_inbox i on i.integration_inbox_id = j.integration_inbox_id
      where j.scheduled_job_id = ${input.jobId}::uuid and j.kind = ${GOOGLE_CHAT_QM_JOB_KIND}
        and j.status = 'running' and j.locked_at >= now() - interval '2 minutes'
        and j.result ->> 'claimToken' = ${claimToken}
        and i.provider = 'google-chat' and i.status = 'processing'
    `);
    if (!row) throw new Error("QM_CHAT_LEASE_LOST");
  }
  const job = googleChatJobSchema.parse(row.payload);
  if (
    job.receiptId !== row.integration_inbox_id ||
    job.employeeId !== row.owner_employee_id
  )
    throw new Error("QM_CHAT_OWNER_MISMATCH");
  const user = await resolveActiveStaffById(job.employeeId);
  if (
    !user ||
    user.actorType !== "staff" ||
    user.clientId !== null ||
    user.email !== user.email.trim().toLowerCase() ||
    !/^[^@\s]+@hrmny\.co$/.test(user.email) ||
    !qmGoogleChatAllowed(user.employeeId) ||
    (row.result?.actorId && row.result.actorId !== user.email)
  ) {
    await db.execute(sql`
      with revoked as (
        update public.scheduled_job set status = 'failed', locked_at = null,
          last_error = 'QM_CHAT_STAFF_REVOKED', updated_at = now()
        where scheduled_job_id = ${row.scheduled_job_id}::uuid and kind = ${GOOGLE_CHAT_QM_JOB_KIND}
          and result ->> 'claimToken' = ${claimToken} returning integration_inbox_id
      )
      update public.integration_inbox i set status = 'failed',
        last_error = 'QM_CHAT_STAFF_REVOKED', updated_at = now()
      from revoked r where i.integration_inbox_id = r.integration_inbox_id
        and i.provider = 'google-chat' and i.status = 'processing'
    `);
    throw new Error("QM_CHAT_STAFF_REVOKED");
  }
  const qmThreadRef = threadRef(user.employeeId, user.email, job.externalRef);
  if (input.action === "claim") {
    const bound = await db.execute(sql`
      update public.scheduled_job set result = result || jsonb_build_object('actorId', ${user.email}::text)
      where scheduled_job_id = ${row.scheduled_job_id}::uuid and kind = ${GOOGLE_CHAT_QM_JOB_KIND}
        and status = 'running' and result ->> 'claimToken' = ${claimToken}
        and locked_at >= now() - interval '2 minutes' returning scheduled_job_id
    `);
    if (!bound.length) throw new Error("QM_CHAT_LEASE_LOST");
    return {
      job: {
        jobId: row.scheduled_job_id,
        claimToken,
        receiptId: job.receiptId,
        actorId: user.email,
        threadRef: qmThreadRef,
        prompt: job.prompt,
        ...(typeof row.result?.runId === "string"
          ? { runId: row.result.runId }
          : {}),
      },
    };
  }
  if (row.result?.runId && input.runId && row.result.runId !== input.runId)
    throw new Error("QM_CHAT_RUN_CHANGED");
  if (input.action === "renew") {
    const updated = await db.execute(sql`
      update public.scheduled_job set locked_at = now(), updated_at = now(),
        result = result || ${JSON.stringify(input.runId ? { runId: input.runId } : {})}::jsonb
      where scheduled_job_id = ${input.jobId}::uuid and kind = ${GOOGLE_CHAT_QM_JOB_KIND}
        and status = 'running' and result ->> 'claimToken' = ${claimToken}
        and locked_at >= now() - interval '2 minutes'
      returning scheduled_job_id
    `);
    if (!updated.length) throw new Error("QM_CHAT_LEASE_LOST");
    return { ok: true };
  }
  const fallback =
    input.result.status === "pending_approval"
      ? "Approval is required. Open your assistant workspace to review the requested action."
      : input.result.status === "failed" || input.result.status === "refused"
        ? "The assistant could not complete this request. Open your workspace for details."
        : "The assistant run finished. Open your workspace to continue.";
  const text = `${(input.result.reply?.trim() || fallback).slice(0, 3_500)}\n\nAssistant workspace: https://hrmny-portal.fly.dev/`;
  const result = {
    bridgeStatus: "reply_ready",
    text,
    qmThreadRef,
    qmRunId: input.runId ?? row.result?.runId ?? null,
    qmSessionId: input.result.sessionId ?? null,
    qmStatus: input.result.status,
  };
  // Both state changes commit together: the original worker can only deliver this saved answer.
  const handed = await db.execute(sql`
    with owned as materialized (
      select scheduled_job_id, integration_inbox_id from public.scheduled_job
      where scheduled_job_id = ${input.jobId}::uuid and kind = ${GOOGLE_CHAT_QM_JOB_KIND}
        and status = 'running' and result ->> 'claimToken' = ${claimToken}
        and locked_at >= now() - interval '2 minutes'
      for update
    ), ready as (
      update public.integration_inbox i set result = ${JSON.stringify(result)}::jsonb,
        updated_at = now(), state_version = state_version + 1
      from owned j
      where i.integration_inbox_id = j.integration_inbox_id and i.provider = 'google-chat'
        and i.status = 'processing' and i.owner_employee_id = ${user.employeeId}::uuid
      returning i.integration_inbox_id
    )
    update public.scheduled_job j set kind = ${GOOGLE_CHAT_INTERACTION_JOB_KIND}, status = 'pending',
      attempts = 0, run_at = now(), locked_at = null, result = null, updated_at = now()
    from ready where j.integration_inbox_id = ready.integration_inbox_id
      and j.scheduled_job_id = ${input.jobId}::uuid returning j.scheduled_job_id
  `);
  if (!handed.length) throw new Error("QM_CHAT_LEASE_LOST");
  await dispatchGoogleChatInteraction({
    jobId: input.jobId,
    receiptId: job.receiptId,
  }).catch(() => false);
  return { ok: true };
}
