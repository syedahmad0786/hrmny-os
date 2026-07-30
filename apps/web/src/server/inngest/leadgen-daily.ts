import {
  createEmailVerificationAdapter,
  createLeadSourceAdapter,
} from "@hrmny/integrations";
import { runDailyLeadGen, type LeadGenDeps } from "../leadgen/pipeline";
import type { MorningDigest } from "../leadgen/digest";

/**
 * Thin Inngest wrapper over `runDailyLeadGen`. The plain pipeline fn stays the
 * real entry point (tested in Vitest with mock providers); this only adds the
 * schedule metadata and env guard. No-op until `INNGEST_EVENT_KEY` /
 * `INNGEST_SIGNING_KEY` exist — and the `inngest` package is intentionally NOT
 * a dependency yet, so there's no client to import. When the keys land, register
 * `runLeadgenDaily` against the real Inngest client using `LEADGEN_DAILY`.
 */

export const LEADGEN_DAILY = {
  id: "leadgen-daily",
  /** Every day at 06:00 Asia/Dubai (morning digest). */
  cron: "TZ=Asia/Dubai 0 6 * * *",
} as const;

export function inngestConfigured(): boolean {
  return Boolean(
    process.env.INNGEST_EVENT_KEY?.trim() &&
      process.env.INNGEST_SIGNING_KEY?.trim(),
  );
}

/** Live-adapter run used by the scheduled trigger (adapters are mock without keys). */
export function runLeadgenDaily(
  overrides: Partial<LeadGenDeps> = {},
): Promise<MorningDigest> {
  return runDailyLeadGen({
    leadSource: overrides.leadSource ?? createLeadSourceAdapter(),
    verifier: overrides.verifier ?? createEmailVerificationAdapter(),
    runAgent: overrides.runAgent,
    digestSink: overrides.digestSink,
  });
}
