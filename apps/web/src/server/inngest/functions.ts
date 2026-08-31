import { cron } from "inngest";
import { runLeadgenDailyCron } from "../leadgen/daily-cron";
import { LEADGEN_DAILY } from "./leadgen-daily";
import { REPORT_SCHEDULER, runDueReports } from "./report-scheduler";
import { inngest } from "./client";
import {
  APOLLO_SEARCH_RETRY_EVENT,
  executeApolloSearchRetryEvent,
} from "./apollo-search-retry";
import { runApolloPeopleSearchQueuedJob } from "../sales-os/apollo-search";

/** Durable policy gate for the contained once-per-day Sales research proposal. */
export const leadgenDailyFunction = inngest.createFunction(
  {
    id: LEADGEN_DAILY.id,
    triggers: [cron(LEADGEN_DAILY.cron)],
    retries: 2,
  },
  async ({ step }) =>
    step.run("leadgen-daily-policy-gate", () => runLeadgenDailyCron()),
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

/**
 * Event-driven Apollo retry worker. The event contains only opaque IDs; the
 * worker claims the database job and rehydrates criteria from the immutable
 * integration receipt after reauthorizing the original employee.
 */
export const apolloSearchRetryFunction = inngest.createFunction(
  {
    id: "sales-apollo-people-search-retry-v1",
    triggers: [{ event: APOLLO_SEARCH_RETRY_EVENT }],
    retries: 2,
    // One provider call at a time across every owner-bound connection. This is
    // deliberately stricter than Apollo's changing account limits; HTTP
    // receipts and Retry-After still govern the next eligible attempt.
    concurrency: {
      limit: 1,
    },
  },
  async ({ event, step }) =>
    executeApolloSearchRetryEvent(event.data, {
      sleepUntil: (runAt) => step.sleepUntil("wait-until-due", runAt),
      runQueuedJob: (jobId) =>
        step.run("claim-and-run-apollo-search", () =>
          runApolloPeopleSearchQueuedJob(jobId),
        ),
      sendEvent: (nextEvent) =>
        step.sendEvent("schedule-next-apollo-attempt", nextEvent),
    }),
);

export const inngestFunctions = [
  leadgenDailyFunction,
  reportSchedulerFunction,
  apolloSearchRetryFunction,
] as const;
