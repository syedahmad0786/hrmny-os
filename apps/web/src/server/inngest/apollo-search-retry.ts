import { inngest, inngestCloudConfigured } from "./client";
import { z } from "zod";

export const APOLLO_SEARCH_RETRY_EVENT =
  "sales/apollo.people-search.retry.requested" as const;

export type ApolloSearchRetryEventData = {
  jobId: string;
  receiptId: string;
  runAt: string;
};

export const ApolloSearchRetryEventDataSchema = z.object({
  jobId: z.string().uuid(),
  receiptId: z.string().uuid(),
  runAt: z.string().datetime(),
});

type ApolloSearchRetryOutcome = {
  status: string;
  nextAttemptAt?: string;
};

type ApolloSearchRetryExecutionDeps<T extends ApolloSearchRetryOutcome> = {
  sleepUntil: (runAt: string) => Promise<unknown>;
  runQueuedJob: (jobId: string) => Promise<T>;
  sendEvent: (event: {
    id: string;
    name: typeof APOLLO_SEARCH_RETRY_EVENT;
    data: ApolloSearchRetryEventData;
  }) => Promise<unknown>;
};

export function apolloSearchRetryEventId(data: {
  jobId: string;
  runAt: string;
}): string {
  return `apollo-search:${data.jobId}:${new Date(data.runAt).getTime()}`;
}

/**
 * Extracted execution boundary for deterministic contract tests. The caller
 * supplies Inngest step wrappers; no criteria, credentials, or provider data
 * can enter the event payload.
 */
export async function executeApolloSearchRetryEvent<
  T extends ApolloSearchRetryOutcome,
>(rawData: unknown, deps: ApolloSearchRetryExecutionDeps<T>): Promise<T> {
  const data = ApolloSearchRetryEventDataSchema.parse(rawData);
  await deps.sleepUntil(data.runAt);
  const outcome = await deps.runQueuedJob(data.jobId);
  if (
    outcome.nextAttemptAt &&
    new Set(["retry_scheduled", "processing", "not_due", "busy"]).has(
      outcome.status,
    )
  ) {
    const nextData = { ...data, runAt: outcome.nextAttemptAt };
    await deps.sendEvent({
      id: apolloSearchRetryEventId(nextData),
      name: APOLLO_SEARCH_RETRY_EVENT,
      data: nextData,
    });
  }
  return outcome;
}

/**
 * Publish only opaque operational identifiers. Search criteria and provider
 * data remain in HRMNY's database-backed job and receipt ledgers.
 */
export async function sendApolloSearchRetryEvent(
  data: ApolloSearchRetryEventData,
): Promise<string | null> {
  if (!inngestCloudConfigured()) return null;
  const { ids } = await inngest.send({
    id: apolloSearchRetryEventId(data),
    name: APOLLO_SEARCH_RETRY_EVENT,
    data,
  });
  return ids[0] ?? null;
}
