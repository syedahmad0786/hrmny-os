import { sql } from "@hrmny/db";
import {
  createEmailVerificationAdapter,
  createLeadSourceAdapter,
} from "@hrmny/integrations";
import { getDb } from "../db";
import { emitHealthSignal } from "../m1-persistence";
import { resolveIntegrationApiKey } from "../integrations/resolve-keys";
import { runDailyLeadGen } from "./pipeline";

/**
 * Cron-driven daily lead-gen (replaces Inngest until keys exist).
 * Runs once per UTC day after 02:00 (~06:00 Asia/Dubai), HITL-only side
 * effects (digest sink → health_signal / Chat). Apollo/Hunter use env or
 * vault when present; otherwise adapters stay mock.
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
  skipped?: "before_window" | "already_ran";
  created?: number;
  scored?: number;
  apolloSource?: string;
  hunterSource?: string;
};

export async function runLeadgenDailyCron(
  now: Date = new Date(),
): Promise<LeadgenDailyCronResult> {
  if (now.getUTCHours() < LEADGEN_UTC_HOUR) {
    return { ran: false, skipped: "before_window" };
  }
  const todayIso = now.toISOString().slice(0, 10);
  if (await alreadyRanToday(todayIso)) {
    return { ran: false, skipped: "already_ran" };
  }

  const [apollo, hunter] = await Promise.all([
    resolveIntegrationApiKey("apollo"),
    resolveIntegrationApiKey("hunter"),
  ]);

  const digest = await runDailyLeadGen({
    leadSource: createLeadSourceAdapter(
      apollo.apiKey ? { mode: "live", apiKey: apollo.apiKey } : undefined,
    ),
    verifier: createEmailVerificationAdapter(
      hunter.apiKey ? { mode: "live", apiKey: hunter.apiKey } : undefined,
    ),
  });

  await emitHealthSignal(LEADGEN_DAILY_SIGNAL, "info", {
    date: todayIso,
    count: digest.count,
    verifiedCount: digest.verifiedCount,
    hotCount: digest.hotCount,
    apolloSource: apollo.source,
    hunterSource: hunter.source,
  }).catch(() => undefined);

  memoryLastRunDay = todayIso;
  return {
    ran: true,
    created: digest.count,
    scored: digest.leads.length,
    apolloSource: apollo.source,
    hunterSource: hunter.source,
  };
}
