import { afterEach, describe, expect, it, vi } from "vitest";
import { inngestCloudConfigured } from "./client";
import { inngestFunctions } from "./functions";
import {
  APOLLO_SEARCH_RETRY_EVENT,
  executeApolloSearchRetryEvent,
} from "./apollo-search-retry";

describe("Inngest bridge", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("registers schedules plus the durable Apollo event worker locally", () => {
    expect(inngestFunctions).toHaveLength(3);
  });

  it("does not claim provider acceptance without both exact key refs", () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "event-key");
    vi.stubEnv("INNGEST_SIGNING_KEY", "");
    expect(inngestCloudConfigured()).toBe(false);
    vi.stubEnv("INNGEST_SIGNING_KEY", "signing-key");
    expect(inngestCloudConfigured()).toBe(true);
  });

  it("rejects malformed Apollo events before sleeping or claiming the DB job", async () => {
    const deps = {
      sleepUntil: vi.fn(async () => undefined),
      runQueuedJob: vi.fn(async () => ({ status: "completed" })),
      sendEvent: vi.fn(async (_event: unknown) => undefined),
    };
    await expect(
      executeApolloSearchRetryEvent({ jobId: "not-a-uuid" }, deps),
    ).rejects.toThrow();
    expect(deps.sleepUntil).not.toHaveBeenCalled();
    expect(deps.runQueuedJob).not.toHaveBeenCalled();
    expect(deps.sendEvent).not.toHaveBeenCalled();
  });

  it("sleeps, claims by opaque job ID, and reschedules deterministically", async () => {
    const event = {
      jobId: "41000000-0000-4000-8000-000000000031",
      receiptId: "41000000-0000-4000-8000-000000000032",
      runAt: "2026-08-31T12:00:00.000Z",
    };
    const nextAttemptAt = "2026-08-31T12:01:23.000Z";
    const deps = {
      sleepUntil: vi.fn(async () => undefined),
      runQueuedJob: vi.fn(async () => ({
        status: "retry_scheduled",
        nextAttemptAt,
      })),
      sendEvent: vi.fn(async (_event: unknown) => undefined),
    };

    await expect(executeApolloSearchRetryEvent(event, deps)).resolves.toEqual({
      status: "retry_scheduled",
      nextAttemptAt,
    });
    expect(deps.sleepUntil).toHaveBeenCalledWith(event.runAt);
    expect(deps.runQueuedJob).toHaveBeenCalledWith(event.jobId);
    expect(deps.sendEvent).toHaveBeenCalledWith({
      id: `apollo-search:${event.jobId}:${Date.parse(nextAttemptAt)}`,
      name: APOLLO_SEARCH_RETRY_EVENT,
      data: { ...event, runAt: nextAttemptAt },
    });
    expect(JSON.stringify(deps.sendEvent.mock.calls[0]?.[0])).not.toMatch(
      /criteria|credential|api.?key|email/i,
    );
  });
});
