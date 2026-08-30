import { sql } from "@hrmny/db";
import {
  assertScheduledAllowed,
  PolicyViolationError,
  type AutonomyPolicy,
} from "@hrmny/ai";
import { readAiAutonomyPolicy } from "../ai/autonomy-policy";
import { getDb } from "../db";
import { recordHealthSignal } from "../m1-persistence";

/**
 * Cron-driven Sales research gate. The previous implementation resolved live
 * Apollo/email-verification credentials and created CRM records before reading
 * the audited autonomy policy. Until a proposal-only research runtime exists,
 * this entry point records one explicit refusal and performs no provider, AI,
 * enrichment, outreach, or CRM operation.
 */
export const LEADGEN_DAILY_SIGNAL = "leadgen_daily";
/** First cron tick at/after this UTC hour (~06:00 Asia/Dubai). */
export const LEADGEN_UTC_HOUR = 2;

let memoryLastRunDay: string | null = null;

export function resetLeadgenDailyMemory() {
  memoryLastRunDay = null;
}

async function alreadyRanToday(todayIso: string): Promise<boolean> {
  const db = getDb();
  if (!db) return memoryLastRunDay === todayIso;
  const [row] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from health_signal
    where signal_key = ${LEADGEN_DAILY_SIGNAL}
      and created_at >= ${todayIso}::date
  `);
  return Number(row?.count ?? 0) > 0;
}

export type LeadgenDailyCronResult = {
  ran: boolean;
  skipped?:
    | "before_window"
    | "already_ran"
    | "policy_denied"
    | "proposal_runtime_unavailable";
  policyViolation?:
    "forbidden_action" | "mode_not_scheduled" | "agent_not_allowlisted";
  created?: number;
  scored?: number;
  apolloSource?: string;
  hunterSource?: string;
};

export type LeadgenDailyCronDeps = {
  readPolicy?: () => Promise<AutonomyPolicy>;
  recordSignal?: typeof recordHealthSignal;
};

async function recordRefusal(
  todayIso: string,
  result: LeadgenDailyCronResult,
  recordSignal: typeof recordHealthSignal,
): Promise<LeadgenDailyCronResult> {
  await recordSignal(LEADGEN_DAILY_SIGNAL, "warn", {
    date: todayIso,
    outcome: "refused",
    reason: result.skipped,
    policyViolation: result.policyViolation ?? null,
  });
  memoryLastRunDay = todayIso;
  return result;
}

export async function runLeadgenDailyCron(
  now: Date = new Date(),
  deps: LeadgenDailyCronDeps = {},
): Promise<LeadgenDailyCronResult> {
  if (now.getUTCHours() < LEADGEN_UTC_HOUR) {
    return { ran: false, skipped: "before_window" };
  }
  const todayIso = now.toISOString().slice(0, 10);
  if (await alreadyRanToday(todayIso)) {
    return { ran: false, skipped: "already_ran" };
  }

  const recordSignal = deps.recordSignal ?? recordHealthSignal;
  const policy = await (deps.readPolicy ?? readAiAutonomyPolicy)();
  try {
    assertScheduledAllowed(policy, "research", "research");
  } catch (error) {
    if (!(error instanceof PolicyViolationError)) throw error;
    return recordRefusal(
      todayIso,
      {
        ran: false,
        skipped: "policy_denied",
        policyViolation: error.violation,
      },
      recordSignal,
    );
  }

  return recordRefusal(
    todayIso,
    { ran: false, skipped: "proposal_runtime_unavailable" },
    recordSignal,
  );
}
