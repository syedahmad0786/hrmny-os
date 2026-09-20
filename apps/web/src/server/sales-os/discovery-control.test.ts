import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptDiscoveryPolicySuggestion,
  listDiscoveryControlQueue,
  proposeDiscoveryPolicySuggestion,
  recordDiscoverySourceOutcomesForTest,
  reconnectDiscoveryControlSource,
  resetMemoryDiscoveryControl,
  retryDiscoverySource,
} from "./discovery-control";
import {
  createDiscoveryProgramme,
  DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
  defaultDiscoverySources,
  getDiscoveryProgramme,
  publishDiscoveryProgramme,
} from "./discovery-programmes";
import {
  getMemoryDiscoveryRun,
  requestMemoryDiscoveryRun,
  resetMemoryDiscoveryRuns,
} from "./discovery-run-queries";

const ownerId = "c0000000-0000-4000-8000-000000000002";
const adminId = "c0000000-0000-4000-8000-000000000001";

async function publishedProgramme() {
  const created = await createDiscoveryProgramme({
    actorEmployeeId: ownerId,
    config: {
      ...DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
      name: `Control ${randomUUID().slice(0, 8)}`,
      ownerEmployeeId: ownerId,
      reviewerEmployeeIds: [],
    },
    sources: defaultDiscoverySources(),
  });
  return publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: created.version,
    actorEmployeeId: adminId,
  });
}

function requestRun(
  programme: Awaited<ReturnType<typeof publishedProgramme>>,
) {
  return requestMemoryDiscoveryRun({
    programmeId: programme.id,
    programmeName: programme.draft.config.name,
    ownerEmployeeId: ownerId,
    reviewerEmployeeIds: [],
    expectedVersion: programme.version,
    programmeVersion: programme.version,
    programmeState: programme.state,
    publishedVersion: programme.publishedVersion,
    maxObservations: (programme.published ?? programme.draft).config.limits
      .maxObservations,
    scheduleGeneration: programme.scheduleGeneration,
    sourceKeys: ["campaign_me", "communicate_online"],
    requestId: randomUUID(),
    overlap: "defer",
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
}

describe("Discovery ongoing control", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_MODE", "memory");
    resetMemoryDiscoveryRuns();
    resetMemoryDiscoveryControl();
  });

  it("retries a failed source from its checkpoint and leaves completed siblings intact", async () => {
    const programme = await publishedProgramme();
    const requested = requestRun(programme);
    const completedCheckpoint = {
      cursor: "page-2",
      providerJobId: "job-ok",
      itemsSeen: 12,
      pagesSeen: 2,
    };
    const failedCheckpoint = {
      cursor: "page-4",
      providerJobId: "job-fail",
      itemsSeen: 40,
      pagesSeen: 4,
    };
    recordDiscoverySourceOutcomesForTest(requested.runId, [
      {
        sourceKey: "campaign_me",
        status: "completed",
        lastEvent: "sales.discovery.completion.v1",
        checkpoint: completedCheckpoint,
        retryable: false,
        retryCount: 0,
        lastError: null,
      },
      {
        sourceKey: "communicate_online",
        status: "failed",
        lastEvent: "sales.discovery.completion.v1",
        checkpoint: failedCheckpoint,
        retryable: true,
        retryCount: 0,
        lastError: "source_unavailable",
      },
    ]);
    const retried = await retryDiscoverySource({
      runId: requested.runId,
      sourceKey: "communicate_online",
      actorEmployeeId: ownerId,
      isAdmin: false,
      requestId: randomUUID(),
    });
    expect(retried).toMatchObject({
      executionEnabled: false,
      collectorStarted: false,
      paidCallAuthorized: false,
      checkpoint: failedCheckpoint,
    });
    expect(retried.sourceOutcomes.communicate_online?.status).toBe(
      "retry_queued",
    );
    expect(retried.sourceOutcomes.campaign_me).toMatchObject({
      status: "completed",
      checkpoint: completedCheckpoint,
    });
    expect(retried.reservation.state).toBe("pending_unknown");
    expect(retried.reservation.paidCallAuthorized).toBe(false);
    await expect(
      retryDiscoverySource({
        runId: requested.runId,
        sourceKey: "communicate_online",
        actorEmployeeId: ownerId,
        isAdmin: false,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ message: "SOURCE_RETRY_ALREADY_QUEUED" });
    const queue = await listDiscoveryControlQueue({
      actorEmployeeId: ownerId,
      isAdmin: false,
    });
    expect(queue.executionEnabled).toBe(false);
    expect(queue.health.blockedRequired).toBeGreaterThan(0);
  });

  it("reconnects a source without starting collectors", async () => {
    const programme = await publishedProgramme();
    const before = programme.draft.sources.find(
      (source) => source.sourceKey === "apollo_organisation_search",
    );
    const reconnected = await reconnectDiscoveryControlSource({
      programmeId: programme.id,
      sourceKey: "apollo_organisation_search",
      actorEmployeeId: ownerId,
      isAdmin: false,
      reason: "Refresh the owned Apollo connection after an error",
    });
    expect(reconnected).toMatchObject({
      executionEnabled: false,
      collectorStarted: false,
      sourceKey: "apollo_organisation_search",
    });
    expect(reconnected.credentialGeneration).toBe(
      (before?.credentialGeneration ?? 0) + 1,
    );
  });

  it("applies an accepted observation-cap suggestion to a later run only", async () => {
    const programme = await publishedProgramme();
    const first = requestRun(programme);
    expect(getMemoryDiscoveryRun(first.runId)?.maxObservations).toBe(200);
    const suggestion = await proposeDiscoveryPolicySuggestion({
      programmeId: programme.id,
      maxObservations: 40,
      reason: "Lower the observation cap after a costly week",
      actorEmployeeId: ownerId,
      isAdmin: false,
    });
    const queued = await listDiscoveryControlQueue({
      actorEmployeeId: ownerId,
      isAdmin: false,
    });
    expect(queued.health.policySuggestions).toBe(1);
    expect(queued.items.some((item) => item.id === suggestion.suggestionId)).toBe(
      true,
    );
    const accepted = await acceptDiscoveryPolicySuggestion({
      suggestionId: suggestion.suggestionId,
      actorEmployeeId: adminId,
      isAdmin: true,
    });
    expect(accepted).toMatchObject({
      executionEnabled: false,
      collectorStarted: false,
      maxObservations: 40,
    });
    const refreshed = await getDiscoveryProgramme({
      programmeId: programme.id,
      actorEmployeeId: ownerId,
      isAdmin: false,
    });
    expect(refreshed.published?.config.limits.maxObservations).toBe(40);
    expect(refreshed.publishedVersion).toBe(accepted.publishedVersion);
    const later = requestRun(refreshed);
    expect(getMemoryDiscoveryRun(later.runId)?.maxObservations).toBe(40);
    expect(getMemoryDiscoveryRun(later.runId)?.publishedVersion).toBe(
      refreshed.publishedVersion,
    );
    expect(getMemoryDiscoveryRun(first.runId)?.maxObservations).toBe(200);
    expect(getMemoryDiscoveryRun(first.runId)?.publishedVersion).not.toBe(
      refreshed.publishedVersion,
    );
  });

  it("holds a source retry lock so concurrent retries cannot double-queue", async () => {
    const programme = await publishedProgramme();
    const requested = requestRun(programme);
    recordDiscoverySourceOutcomesForTest(requested.runId, [
      {
        sourceKey: "communicate_online",
        status: "failed",
        lastEvent: "sales.discovery.completion.v1",
        checkpoint: {
          cursor: "page-4",
          providerJobId: "job-fail",
          itemsSeen: 40,
          pagesSeen: 4,
        },
        retryable: true,
        retryCount: 0,
        lastError: "source_unavailable",
      },
    ]);
    const results = await Promise.allSettled([
      retryDiscoverySource({
        runId: requested.runId,
        sourceKey: "communicate_online",
        actorEmployeeId: ownerId,
        isAdmin: false,
        requestId: randomUUID(),
      }),
      retryDiscoverySource({
        runId: requested.runId,
        sourceKey: "communicate_online",
        actorEmployeeId: ownerId,
        isAdmin: false,
        requestId: randomUUID(),
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: { message: "SOURCE_RETRY_ALREADY_QUEUED" },
    });
  });
});
