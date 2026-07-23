import { eq, scheduledJob, sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "@/server/db";
import { emitHealthSignal } from "@/server/m1-persistence";

export const dynamic = "force-dynamic";

const HealthJobSchema = z.object({
  signalKey: z.string().min(1).max(120),
  severity: z.enum(["info", "warn", "critical"]),
  payload: z.record(z.unknown()).default({}),
});

type ClaimedJob = {
  scheduled_job_id: string;
  kind: string;
  payload: unknown;
  attempts: number;
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
    returning job.scheduled_job_id, job.kind, job.payload, job.attempts
  `);
  const claimed = Array.from(claimedResult) as unknown as ClaimedJob[];

  let completed = 0;
  let failed = 0;
  for (const job of claimed) {
    try {
      if (job.kind !== "health_signal") {
        throw new Error(`Unsupported job kind: ${job.kind}`);
      }
      const payload = HealthJobSchema.parse(job.payload);
      await emitHealthSignal(
        payload.signalKey,
        payload.severity,
        payload.payload,
      );
      await db
        .update(scheduledJob)
        .set({
          status: "completed",
          completedAt: new Date(),
          result: { ok: true },
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
  return Response.json({ claimed: claimed.length, completed, failed });
}
