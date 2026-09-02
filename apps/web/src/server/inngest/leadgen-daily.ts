/**
 * Schedule metadata only. The registered durable function delegates to the
 * policy-gated `runLeadgenDailyCron`; this module intentionally exposes no
 * alternate provider-backed scheduled entry point.
 */

export const LEADGEN_DAILY = {
  id: "leadgen-daily",
  /** Every day at 06:00 Asia/Dubai (morning digest). */
  cron: "TZ=Asia/Dubai 0 6 * * *",
} as const;
