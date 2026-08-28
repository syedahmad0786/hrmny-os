import { cron } from "inngest";
import { runLeadgenDailyCron } from "../leadgen/daily-cron";
import { LEADGEN_DAILY } from "./leadgen-daily";
import { REPORT_SCHEDULER, runDueReports } from "./report-scheduler";
import { inngest } from "./client";

/** Durable provider runner for the existing once-per-day lead-gen operation. */
export const leadgenDailyFunction = inngest.createFunction(
  {
    id: LEADGEN_DAILY.id,
    triggers: [cron(LEADGEN_DAILY.cron)],
    retries: 2,
  },
  async ({ step }) =>
    step.run("leadgen-daily-claim-and-run", () => runLeadgenDailyCron()),
);

/**
 * Durable scheduler tick. Each schedule retains its existing cadence and
 * provider idempotency key; the Inngest trigger only replaces the cron runner.
 */
export const reportSchedulerFunction = inngest.createFunction(
  {
    id: REPORT_SCHEDULER.id,
    triggers: [cron(REPORT_SCHEDULER.cron)],
    retries: 2,
  },
  async ({ step }) =>
    step.run("claim-and-send-due-reports", () => runDueReports()),
);

export const inngestFunctions = [
  leadgenDailyFunction,
  reportSchedulerFunction,
] as const;
