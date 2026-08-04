import { sql } from "@hrmny/db";
import { getDb } from "../db";
import { emitHealthSignal } from "../m1-persistence";
import { listCrmTasks } from "../crm/repository";
import type { CrmTaskRow } from "../crm/types";

/**
 * CRM task digest (W11 owner nudges). Once per day, find open/in_progress
 * crm_task rows due today or overdue, group them by owner, and post ONE
 * digest via the existing Google Chat notifier (`emitHealthSignal`, which
 * both records a health_signal row and posts to GOOGLE_CHAT_WEBHOOK_URL).
 * The recorded health_signal row doubles as the per-day idempotency marker
 * in DB mode; memory mode uses a module-level flag (single-process dev/test).
 * Driven by /api/cron/jobs alongside runDueReports — no autonomous sends
 * beyond the internal Chat webhook (which is the HITL notification channel).
 */

export const CRM_TASK_DIGEST_SIGNAL = "crm_task_digest";
/** Post on the first cron tick at/after this UTC hour (~08:00 Asia/Dubai). */
export const DIGEST_UTC_HOUR = 4;

export type DigestTask = { crmTaskId: string; title: string; dueDate: string };
export type DigestGroup = {
  ownerEmployeeId: string | null;
  overdue: DigestTask[];
  dueToday: DigestTask[];
};
export type CrmTaskDigest = {
  groups: DigestGroup[];
  totalOverdue: number;
  totalDueToday: number;
};

/**
 * Pure selection + grouping: open/in_progress tasks with a dueDate <= today
 * (ISO date strings compare lexicographically), grouped by ownerEmployeeId.
 */
export function buildCrmTaskDigest(
  tasks: CrmTaskRow[],
  todayIso: string,
): CrmTaskDigest {
  const byOwner = new Map<string, DigestGroup>();
  let totalOverdue = 0;
  let totalDueToday = 0;
  for (const t of tasks) {
    if (t.status !== "open" && t.status !== "in_progress") continue;
    if (!t.dueDate || t.dueDate > todayIso) continue;
    const key = t.ownerEmployeeId ?? "unassigned";
    let group = byOwner.get(key);
    if (!group) {
      group = { ownerEmployeeId: t.ownerEmployeeId, overdue: [], dueToday: [] };
      byOwner.set(key, group);
    }
    const item: DigestTask = {
      crmTaskId: t.crmTaskId,
      title: t.title,
      dueDate: t.dueDate,
    };
    if (t.dueDate < todayIso) {
      group.overdue.push(item);
      totalOverdue += 1;
    } else {
      group.dueToday.push(item);
      totalDueToday += 1;
    }
  }
  return { groups: [...byOwner.values()], totalOverdue, totalDueToday };
}

// ponytail: module-level day marker — only the dedupe for memory mode
// (single process); DB mode dedupes on today's health_signal row.
let memoryLastSentDay: string | null = null;
export function resetCrmTaskDigestMemory() {
  memoryLastSentDay = null;
}

async function alreadySentToday(todayIso: string): Promise<boolean> {
  const db = getDb();
  if (!db) return memoryLastSentDay === todayIso;
  const [row] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from health_signal
    where signal_key = ${CRM_TASK_DIGEST_SIGNAL}
      and created_at >= ${todayIso}::date
  `);
  return Number(row?.count ?? 0) > 0;
}

export type CrmTaskDigestResult = {
  posted: boolean;
  skipped?: "no_webhook" | "before_window" | "already_sent" | "nothing_due";
  owners?: number;
  overdue?: number;
  dueToday?: number;
};

/** Cron entry point. Inject `now` in tests. Never posts more than once/day. */
export async function runCrmTaskDigest(
  now: Date = new Date(),
): Promise<CrmTaskDigestResult> {
  const webhook = process.env.GOOGLE_CHAT_WEBHOOK_URL?.trim();
  if (!webhook) {
    console.log(
      "[crm-task-digest] skipped: GOOGLE_CHAT_WEBHOOK_URL not configured",
    );
    return { posted: false, skipped: "no_webhook" };
  }
  if (now.getUTCHours() < DIGEST_UTC_HOUR) {
    return { posted: false, skipped: "before_window" };
  }
  // ponytail: "today" is the UTC day; switch to Asia/Dubai if owners complain
  // about the 4h offset on due-date boundaries.
  const todayIso = now.toISOString().slice(0, 10);
  if (await alreadySentToday(todayIso)) {
    return { posted: false, skipped: "already_sent" };
  }
  const tasks = await listCrmTasks();
  const digest = buildCrmTaskDigest(tasks, todayIso);
  if (digest.groups.length === 0) {
    return { posted: false, skipped: "nothing_due" };
  }
  await emitHealthSignal(CRM_TASK_DIGEST_SIGNAL, "info", {
    date: todayIso,
    totalOverdue: digest.totalOverdue,
    totalDueToday: digest.totalDueToday,
    owners: digest.groups.map((g) => ({
      ownerEmployeeId: g.ownerEmployeeId ?? "unassigned",
      overdue: g.overdue.map((t) => `${t.title} (due ${t.dueDate})`),
      dueToday: g.dueToday.map((t) => t.title),
    })),
  });
  memoryLastSentDay = todayIso;
  return {
    posted: true,
    owners: digest.groups.length,
    overdue: digest.totalOverdue,
    dueToday: digest.totalDueToday,
  };
}
