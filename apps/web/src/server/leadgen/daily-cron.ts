import { sql } from "@hrmny/db";
import {
  assertScheduledAllowed,
  PolicyViolationError,
  type AutonomyPolicy,
} from "@hrmny/ai";
import { readAiAutonomyPolicy } from "../ai/autonomy-policy";
import { z } from "zod";
import { proposeDailyResearch } from "../sales-os/scheduled-research";
import { getDb } from "../db";
import { recordHealthSignal } from "../m1-persistence";

/**
 * Cron-driven proposal-only research. The policy is checked before provider
 * discovery; canonical CRM promotion and outreach always retain their own gates.
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
    | "research_owner_required"
    | "research_pending"
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
  runProposals?: typeof proposeDailyResearch;
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

  if (!z.string().uuid().safeParse(policy.updatedBy).success)
    return recordRefusal(
      todayIso,
      { ran: false, skipped: "research_owner_required" },
      recordSignal,
    );
  const result = await (deps.runProposals ?? proposeDailyResearch)(
    policy.updatedBy!,
    now,
  );
  if (result.pending) return { ran: false, skipped: "research_pending" };
  await recordSignal(LEADGEN_DAILY_SIGNAL, "info", {
    date: todayIso,
    outcome: "proposals_created",
    proposed: result.proposed,
    receiptId: result.receiptId,
    canonicalCrmWrites: 0,
    outreachSends: 0,
  });
  memoryLastRunDay = todayIso;
  return { ran: true, created: result.proposed, apolloSource: "live" };
}
