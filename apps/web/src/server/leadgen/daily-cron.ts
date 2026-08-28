import { sql } from "@hrmny/db";
import {
  createEmailVerificationAdapter,
  createLeadSourceAdapter,
} from "@hrmny/integrations";
import { getDb } from "../db";
import { emitHealthSignal } from "../m1-persistence";
import {
  resolveApolloRuntimeConfig,
  resolveEmailVerificationRuntimeConfig,
} from "../integrations/runtime-adapters";
import { runDailyLeadGen } from "./pipeline";

/**
 * Cron-driven daily lead-gen (replaces Inngest until keys exist).
 * Runs once per UTC day after 02:00 (~06:00 Asia/Dubai), HITL-only side
 * effects (digest sink → health_signal / Chat). Credentials connect providers;
 * explicit mode and billing flags activate live/paid operations separately.
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

  const [apollo, verifierRuntime] = await Promise.all([
    resolveApolloRuntimeConfig(),
    resolveEmailVerificationRuntimeConfig(),
  ]);

  const digest = await runDailyLeadGen({
    leadSource: createLeadSourceAdapter(apollo.config),
    verifier: createEmailVerificationAdapter(verifierRuntime.config),
  });

  const { runDailyResearch } = await import("../sales-os/research");
  const { flagStaleEmails } = await import("../sales-os/stale");
  const { buildSalesOsDigest } = await import("../sales-os/digest");
  const research = await runDailyResearch({ date: now }).catch(() => null);
  const stale = await flagStaleEmails(now).catch(() => 0);
  const salesDigest = await buildSalesOsDigest(now).catch(() => null);

  await emitHealthSignal(LEADGEN_DAILY_SIGNAL, "info", {
    date: todayIso,
    count: digest.count,
    verifiedCount: digest.verifiedCount,
    hotCount: digest.hotCount,
    apolloSource: apollo.source,
    hunterSource: verifierRuntime.source,
    researched: research?.created.length ?? 0,
    sector: research?.sector ?? null,
    staleEmails: stale,
    approvalQueue:
      (salesDigest?.researchedWaiting ?? 0) +
      (salesDigest?.contactsWaiting ?? 0) +
      (salesDigest?.outreachDrafts ?? 0),
  }).catch(() => undefined);

  memoryLastRunDay = todayIso;
  return {
    ran: true,
    created: digest.count,
    scored: digest.leads.length,
    apolloSource: apollo.source,
    hunterSource: verifierRuntime.source,
  };
}
