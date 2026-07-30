import { createResendAdapter, type EmailSendAdapter } from "@hrmny/integrations";
import type { RunAgent } from "@hrmny/ai";
import { getReportEntry } from "../reports/registry";
import { renderMarkdown } from "../reports/types";
import {
  dueSchedules,
  getSchedule,
  markRan,
  recordRun,
  type RunRow,
  type ScheduleRow,
} from "../reports/store";

/**
 * Scheduled reports runner. Same shape as leadgen-daily.ts: the plain
 * `runDueReports(now)` fn is the real entry point (tested in Vitest, mock
 * Resend), and this module only adds the Inngest schedule metadata + env guard.
 * The `inngest` package is intentionally NOT a dependency yet — when
 * INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY land, register `runDueReports`
 * against the real Inngest client using REPORT_SCHEDULER. Until then the
 * existing `/api/cron/jobs` route drives it (see that route's GET handler).
 */

export const REPORT_SCHEDULER = {
  id: "report-scheduler",
  /**
   * Every day at 07:00 Asia/Dubai. Cadence is enforced per-schedule by
   * `isDue` (interval since last_run_at), so a daily tick is the finest grain;
   * weekly/monthly schedules simply skip most ticks.
   */
  cron: "TZ=Asia/Dubai 0 7 * * *",
} as const;

export function inngestConfigured(): boolean {
  return Boolean(
    process.env.INNGEST_EVENT_KEY?.trim() &&
      process.env.INNGEST_SIGNING_KEY?.trim(),
  );
}

export type RunReportsDeps = {
  emailer?: EmailSendAdapter;
  runAgent?: RunAgent;
};

/**
 * Assemble one schedule's report, email it (mock Resend by default), record a
 * report_run, and advance last_run_at. Never throws — a failed report is
 * recorded as a `failed` run so one bad schedule can't halt the batch. Used by
 * both the due-batch runner and the manual run-now.
 */
export async function runScheduleOnce(
  schedule: ScheduleRow,
  at: Date,
  deps: RunReportsDeps = {},
): Promise<RunRow> {
  const emailer = deps.emailer ?? createResendAdapter();
  const entry = getReportEntry(schedule.reportKey);
  if (!entry) {
    return recordRun({
      reportScheduleId: schedule.reportScheduleId,
      reportKey: schedule.reportKey,
      status: "failed",
      artifact: { error: `unknown report_key: ${schedule.reportKey}` },
    });
  }
  try {
    const artifact = await entry.run({ now: at, runAgent: deps.runAgent });
    const markdown = renderMarkdown(artifact);
    const delivery = await emailer.send({
      to: schedule.recipients,
      subject: artifact.title,
      markdown,
    });
    const run = await recordRun({
      reportScheduleId: schedule.reportScheduleId,
      reportKey: schedule.reportKey,
      status: "sent",
      artifact: { ...artifact, markdown, delivery },
    });
    // Advance last_run_at AFTER a successful send so a re-tick within the
    // cadence window is a no-op (idempotent). A failed send leaves the schedule
    // due, so the next tick retries.
    // ponytail: no cross-worker lock — two concurrent ticks could both see one
    // schedule as due and double-send. Fine for a single cron worker; add a
    // `for update skip locked` claim (like /api/cron/jobs) if that changes.
    await markRan(schedule.reportScheduleId, at);
    return run;
  } catch (error) {
    return recordRun({
      reportScheduleId: schedule.reportScheduleId,
      reportKey: schedule.reportKey,
      status: "failed",
      artifact: { error: String(error).slice(0, 2000) },
    });
  }
}

export type RunDueSummary = {
  due: number;
  sent: number;
  failed: number;
  runs: RunRow[];
};

/** Real scheduled entry point — find due schedules, assemble + send each. */
export async function runDueReports(
  now: Date = new Date(),
  deps: RunReportsDeps = {},
): Promise<RunDueSummary> {
  const due = await dueSchedules(now);
  const runs: RunRow[] = [];
  for (const schedule of due) {
    runs.push(await runScheduleOnce(schedule, now, deps));
  }
  return {
    due: due.length,
    sent: runs.filter((r) => r.status === "sent").length,
    failed: runs.filter((r) => r.status === "failed").length,
    runs,
  };
}

/**
 * Manual run-now — assembles + sends regardless of cadence, then advances
 * last_run_at so the next scheduled tick won't re-fire the same report. Returns
 * null when the schedule id is unknown.
 */
export async function runScheduleNow(
  scheduleId: string,
  deps: RunReportsDeps = {},
): Promise<RunRow | null> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) return null;
  return runScheduleOnce(schedule, new Date(), deps);
}
