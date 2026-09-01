import { afterEach, describe, expect, it, vi } from "vitest";
import { inngest, inngestCloudConfigured } from "./client";
import { inngestFunctions } from "./functions";
import {
  APOLLO_SEARCH_RETRY_EVENT,
  executeApolloSearchRetryEvent,
  sendApolloSearchRetryEvent,
} from "./apollo-search-retry";

describe("Inngest bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

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

  it.each(["retry_scheduled", "busy"])(
    "sleeps, claims by opaque job ID, and reschedules %s deterministically",
    async (status) => {
      const event = {
        jobId: "41000000-0000-4000-8000-000000000031",
        receiptId: "41000000-0000-4000-8000-000000000032",
        runAt: "2026-08-31T12:00:00.000Z",
      };
      const nextAttemptAt = "2026-08-31T12:01:23.000Z";
      const deps = {
        sleepUntil: vi.fn(async () => undefined),
        runQueuedJob: vi.fn(async () => ({ status, nextAttemptAt })),
        sendEvent: vi.fn(async (_event: unknown) => undefined),
      };

      await expect(executeApolloSearchRetryEvent(event, deps)).resolves.toEqual(
        { status, nextAttemptAt },
      );
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
    },
  );

  it.each(["completed", "revoked", "dead_letter", "failed"])(
    "does not reschedule terminal Apollo outcome %s",
    async (status) => {
      const event = {
        jobId: "41000000-0000-4000-8000-000000000031",
        receiptId: "41000000-0000-4000-8000-000000000032",
        runAt: "2026-08-31T12:00:00.000Z",
      };
      const outcome = {
        status,
        nextAttemptAt: "2026-08-31T12:01:23.000Z",
      };
      const deps = {
        sleepUntil: vi.fn(async () => undefined),
        runQueuedJob: vi.fn(async () => outcome),
        sendEvent: vi.fn(async (_event: unknown) => undefined),
      };

      await expect(executeApolloSearchRetryEvent(event, deps)).resolves.toEqual(
        outcome,
      );
      expect(deps.sleepUntil).toHaveBeenCalledWith(event.runAt);
      expect(deps.runQueuedJob).toHaveBeenCalledWith(event.jobId);
      expect(deps.sendEvent).not.toHaveBeenCalled();
    },
  );

  it("does not dispatch Apollo retries when Inngest is unconfigured", async () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "");
    vi.stubEnv("INNGEST_SIGNING_KEY", "");
    const send = vi.spyOn(inngest, "send");
    const event = {
      jobId: "41000000-0000-4000-8000-000000000031",
      receiptId: "41000000-0000-4000-8000-000000000032",
      runAt: "2026-08-31T12:00:00.000Z",
    };

    await expect(sendApolloSearchRetryEvent(event)).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("returns null when Inngest accepts a dispatch without an event ID", async () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "event-key");
    vi.stubEnv("INNGEST_SIGNING_KEY", "signing-key");
    const send = vi.spyOn(inngest, "send").mockResolvedValue({ ids: [] });
    const event = {
      jobId: "41000000-0000-4000-8000-000000000031",
      receiptId: "41000000-0000-4000-8000-000000000032",
      runAt: "2026-08-31T12:00:00.000Z",
    };

    await expect(sendApolloSearchRetryEvent(event)).resolves.toBeNull();
    expect(send).toHaveBeenCalledWith({
      id: `apollo-search:${event.jobId}:${Date.parse(event.runAt)}`,
      name: APOLLO_SEARCH_RETRY_EVENT,
      data: event,
    });
  });

  it("surfaces failed Inngest dispatches without retrying in process", async () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "event-key");
    vi.stubEnv("INNGEST_SIGNING_KEY", "signing-key");
    const send = vi
      .spyOn(inngest, "send")
      .mockRejectedValue(new Error("dispatch failed"));
    const event = {
      jobId: "41000000-0000-4000-8000-000000000031",
      receiptId: "41000000-0000-4000-8000-000000000032",
      runAt: "2026-08-31T12:00:00.000Z",
    };

    await expect(sendApolloSearchRetryEvent(event)).rejects.toThrow(
      "dispatch failed",
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
