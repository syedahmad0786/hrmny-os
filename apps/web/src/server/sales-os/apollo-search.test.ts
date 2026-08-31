process.env.DATABASE_URL = "";

import {
  ApolloProviderRequestError,
  type LeadCandidate,
  type LeadSearchExecution,
  type LeadSourceAdapter,
} from "@hrmny/integrations";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginIntegrationReceiptAttempt,
  completeIntegrationReceiptIfProcessing,
  resetIntegrationReceiptMemory,
} from "../integrations/inbox";
import {
  ApolloSearchRetryError,
  getApolloPeopleSearchStatus,
  revokeApolloPeopleSearch,
  runScheduledApolloPeopleSearch,
  searchApolloPeopleFree,
  type ApolloPeopleSearchRetryPayload,
} from "./apollo-search";

const ACTOR = "20000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-31T08:00:00.000Z");

function execution(id = "apollo-person-1"): LeadSearchExecution {
  const candidate: LeadCandidate = {
    externalId: id,
    fullName: "Mina Ma***",
    title: "Marketing Director",
    email: "must-not-persist@example.com",
    companyName: "Example UAE",
    companyDomain: "example.com",
    source: "apollo",
    raw: { fullProviderPayload: true },
  };
  return {
    candidates: [candidate],
    providerReceipt: {
      provider: "apollo",
      operation: "people.search",
      httpStatus: 200,
      responseHash: "a".repeat(64),
      receivedAt: NOW.toISOString(),
      rateLimit: { minuteRemaining: 49 },
    },
  };
}

function sourceWith(
  run: () => Promise<LeadSearchExecution>,
): LeadSourceAdapter {
  return {
    mode: "live",
    searchLeads: vi.fn(async () => (await run()).candidates),
    searchLeadsWithReceipt: vi.fn(run),
    enrichLead: vi.fn(async () => null),
  };
}

async function queueSearch(input: {
  idempotencyKey: string;
  query?: string;
  titles?: string[];
  source: LeadSourceAdapter;
}) {
  let queued: ApolloPeopleSearchRetryPayload | undefined;
  const pending = await searchApolloPeopleFree(
    {
      idempotencyKey: input.idempotencyKey,
      actorEmployeeId: ACTOR,
      query: input.query,
      titles: input.titles,
    },
    {
      leadSource: input.source,
      now: () => NOW,
      scheduleRetry: async (payload, runAt) => {
        queued = payload;
        return {
          jobId: "job-test",
          nextAttemptAt: runAt.toISOString(),
          queue: "injected_test_queue",
        };
      },
    },
  );
  if (!queued) throw new Error("test queue was not called");
  return { pending, queued };
}

function workerDeps(source: LeadSourceAdapter, now = NOW) {
  return {
    leadSource: source,
    authorizeActor: vi.fn(async () => true),
    now: () => now,
  };
}

describe("durable Apollo zero-credit search bridge", () => {
  beforeEach(() => resetIntegrationReceiptMemory());

  it("queues first, executes once, and replays the immutable receipt", async () => {
    const source = sourceWith(async () => execution());
    const input = {
      idempotencyKey: "30000000-0000-4000-8000-000000000001",
      actorEmployeeId: ACTOR,
      titles: ["Marketing Director"],
    };
    const { pending, queued } = await queueSearch({ ...input, source });

    expect(pending).toMatchObject({
      duplicate: false,
      status: "retry_scheduled",
      attempts: 0,
      reason: "APOLLO_SEARCH_QUEUED",
    });
    expect(queued).toEqual({
      receiptId: pending.receiptId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();

    const completed = await runScheduledApolloPeopleSearch(
      queued,
      workerDeps(source),
    );
    const replay = await searchApolloPeopleFree(input, { leadSource: source });
    expect(completed).toMatchObject({
      status: "completed",
      attempts: 1,
      reconciliation: {
        state: "verified",
        providerReadback: "synchronous_response",
        candidateCount: 1,
        verifiedAt: NOW.toISOString(),
      },
    });
    expect(completed.candidates[0]).not.toHaveProperty("raw");
    expect(completed.candidates[0]).not.toHaveProperty("email");
    expect(replay).toMatchObject({
      receiptId: pending.receiptId,
      duplicate: true,
      status: "completed",
    });
    expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(1);
  });

  it("rejects one idempotency key reused for another search", async () => {
    const source = sourceWith(async () => execution());
    const idempotencyKey = "30000000-0000-4000-8000-000000000002";
    await queueSearch({ idempotencyKey, titles: ["Director"], source });
    await expect(
      searchApolloPeopleFree(
        { idempotencyKey, actorEmployeeId: ACTOR, titles: ["Founder"] },
        { leadSource: source },
      ),
    ).rejects.toThrow(/PAYLOAD_MISMATCH/);
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
  });

  it("honors Retry-After and retains the provider failure receipt", async () => {
    const providerReceivedAt = new Date(NOW.getTime() + 5_000);
    const failureReceipt = {
      provider: "apollo",
      operation: "people.search",
      httpStatus: 429,
      responseHash: "b".repeat(64),
      receivedAt: providerReceivedAt.toISOString(),
      rateLimit: { retryAfterSeconds: 17, minuteRemaining: 0 },
    };
    const source = sourceWith(async () => {
      throw new ApolloProviderRequestError(
        "People search failed: HTTP 429",
        429,
        true,
        17,
        failureReceipt,
      );
    });
    const { pending, queued } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000003",
      titles: ["Director"],
      source,
    });

    await expect(
      runScheduledApolloPeopleSearch(queued, workerDeps(source)),
    ).rejects.toBeInstanceOf(ApolloSearchRetryError);
    expect(
      await getApolloPeopleSearchStatus({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).toMatchObject({
      status: "retry_scheduled",
      attempts: 1,
      nextAttemptAt: "2026-08-31T08:00:22.000Z",
      reason: "APOLLO_HTTP_429",
      providerReceipt: failureReceipt,
    });
  });

  it("completes a bounded retry and exposes reconciled readback", async () => {
    const run = vi
      .fn<() => Promise<LeadSearchExecution>>()
      .mockRejectedValueOnce(
        new ApolloProviderRequestError("HTTP 503", 503, true),
      )
      .mockResolvedValueOnce(execution("apollo-person-2"));
    const source = sourceWith(run);
    const { pending, queued } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000004",
      query: "creative UAE",
      source,
    });
    await expect(
      runScheduledApolloPeopleSearch(queued, workerDeps(source)),
    ).rejects.toBeInstanceOf(ApolloSearchRetryError);
    const completed = await runScheduledApolloPeopleSearch(
      queued,
      workerDeps(source, new Date(NOW.getTime() + 60_000)),
    );
    expect(completed).toMatchObject({
      status: "completed",
      attempts: 2,
      candidates: [{ externalId: "apollo-person-2" }],
    });
    expect(
      await getApolloPeopleSearchStatus({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).toMatchObject({ status: "completed", attempts: 2 });
  });

  it("dead-letters after the third bounded provider attempt", async () => {
    const source = sourceWith(async () => {
      throw new ApolloProviderRequestError("HTTP 503", 503, true, 2);
    });
    const { queued } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000005",
      query: "hospitality",
      source,
    });
    await expect(
      runScheduledApolloPeopleSearch(queued, workerDeps(source)),
    ).rejects.toBeInstanceOf(ApolloSearchRetryError);
    await expect(
      runScheduledApolloPeopleSearch(
        queued,
        workerDeps(source, new Date(NOW.getTime() + 2_000)),
      ),
    ).rejects.toBeInstanceOf(ApolloSearchRetryError);
    const dead = await runScheduledApolloPeopleSearch(
      queued,
      workerDeps(source, new Date(NOW.getTime() + 4_000)),
    );
    expect(dead).toMatchObject({
      status: "dead_letter",
      attempts: 3,
      reason: "APOLLO_HTTP_503",
    });
    expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(3);
  });

  it("recovers an expired in-flight lease after a worker crash", async () => {
    const source = sourceWith(async () => execution("apollo-recovered"));
    const { pending, queued } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000012",
      query: "recovery",
      source,
    });
    expect(
      await beginIntegrationReceiptAttempt(
        pending.receiptId,
        3,
        new Date(NOW.getTime() - 1_000),
      ),
    ).toMatchObject({ attempts: 1, attemptToken: expect.any(String) });

    await expect(
      runScheduledApolloPeopleSearch(queued, workerDeps(source)),
    ).resolves.toMatchObject({
      status: "completed",
      attempts: 2,
      candidates: [{ externalId: "apollo-recovered" }],
    });
    expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(1);
  });

  it("fences an expired worker after a replacement attempt is claimed", async () => {
    let resolveProvider!: (value: LeadSearchExecution) => void;
    const source = sourceWith(
      () =>
        new Promise<LeadSearchExecution>((resolve) => {
          resolveProvider = resolve;
        }),
    );
    const { pending, queued } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000013",
      query: "fenced recovery",
      source,
    });
    const stale = await beginIntegrationReceiptAttempt(
      pending.receiptId,
      3,
      new Date(NOW.getTime() - 1_000),
      "30000000-0000-4000-8000-00000000aaaa",
    );
    expect(stale).toMatchObject({ attempts: 1 });

    const replacement = runScheduledApolloPeopleSearch(
      queued,
      workerDeps(source),
    );
    await vi.waitFor(() =>
      expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(1),
    );
    await expect(
      completeIntegrationReceiptIfProcessing(
        pending.receiptId,
        stale!.attemptToken,
        { bridgeStatus: "completed", candidates: [] },
      ),
    ).resolves.toBe(false);
    resolveProvider(execution("apollo-fenced-winner"));
    await expect(replacement).resolves.toMatchObject({
      status: "completed",
      attempts: 2,
      candidates: [{ externalId: "apollo-fenced-winner" }],
    });
  });

  it("fails closed when the initiating employee's Apollo connection is gone", async () => {
    const source = sourceWith(async () => execution());
    const { queued } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000014",
      query: "owner connection",
      source,
    });
    const resolveApiKey = vi.fn(async () => ({
      apiKey: null,
      source: "none" as const,
    }));
    const result = await runScheduledApolloPeopleSearch(queued, {
      authorizeActor: vi.fn(async () => true),
      resolveApiKey,
      now: () => NOW,
    });
    expect(result).toMatchObject({
      status: "revoked",
      reason: "APOLLO_FREE_SEARCH_CONNECTION_REQUIRED",
    });
    expect(resolveApiKey).toHaveBeenCalledWith("apollo", ACTOR, null);
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
  });

  it("revokes a queued request and prevents its provider call", async () => {
    const source = sourceWith(async () => execution());
    const { pending, queued } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000006",
      query: "retail",
      source,
    });
    const cancelRetry = vi.fn(async () => true);
    const revoked = await revokeApolloPeopleSearch(
      { idempotencyKey: pending.idempotencyKey, actorEmployeeId: ACTOR },
      { cancelRetry },
    );
    expect(revoked.status).toBe("revoked");
    expect(cancelRetry).toHaveBeenCalledWith(pending.receiptId);
    expect(
      await runScheduledApolloPeopleSearch(queued, workerDeps(source)),
    ).toMatchObject({ status: "revoked" });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
  });

  it("rechecks employee authorization before delayed provider access", async () => {
    const source = sourceWith(async () => execution());
    const { queued } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000007",
      query: "agency",
      source,
    });
    const result = await runScheduledApolloPeopleSearch(queued, {
      leadSource: source,
      authorizeActor: vi.fn(async () => false),
    });
    expect(result).toMatchObject({
      status: "revoked",
      reason: "APOLLO_SEARCH_AUTHORIZATION_REVOKED",
    });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
  });

  it("requires an explicit administrator boundary to revoke another owner's request", async () => {
    const source = sourceWith(async () => execution());
    const { pending } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000011",
      query: "admin revoke",
      source,
    });
    const administrator = "20000000-0000-4000-8000-000000000002";
    await expect(
      revokeApolloPeopleSearch({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: administrator,
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      revokeApolloPeopleSearch(
        {
          idempotencyKey: pending.idempotencyKey,
          actorEmployeeId: administrator,
          administratorOverride: true,
        },
        { cancelRetry: async () => true },
      ),
    ).resolves.toMatchObject({ status: "revoked" });
  });

  it("does not let stale success overwrite an in-flight revocation", async () => {
    let resolveProvider!: (value: LeadSearchExecution) => void;
    const source = sourceWith(
      () =>
        new Promise<LeadSearchExecution>((resolve) => {
          resolveProvider = resolve;
        }),
    );
    const { pending, queued } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000008",
      query: "concurrent",
      source,
    });
    const inFlight = runScheduledApolloPeopleSearch(queued, workerDeps(source));
    await vi.waitFor(() =>
      expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(1),
    );
    await revokeApolloPeopleSearch(
      { idempotencyKey: pending.idempotencyKey, actorEmployeeId: ACTOR },
      { cancelRetry: async () => true },
    );
    resolveProvider(execution());
    await expect(inFlight).resolves.toMatchObject({ status: "revoked" });
  });

  it("does not disclose another employee's receipt", async () => {
    const source = sourceWith(async () => execution());
    const { pending } = await queueSearch({
      idempotencyKey: "30000000-0000-4000-8000-000000000009",
      query: "private",
      source,
    });
    await expect(
      getApolloPeopleSearchStatus({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: "20000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("fails closed when the durable queue is unavailable", async () => {
    const source = sourceWith(async () => execution());
    await expect(
      searchApolloPeopleFree(
        {
          idempotencyKey: "30000000-0000-4000-8000-000000000010",
          actorEmployeeId: ACTOR,
          query: "queue",
        },
        { leadSource: source, scheduleRetry: async () => null },
      ),
    ).rejects.toThrow(/RETRY_QUEUE_REQUIRED/);
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
  });
});
