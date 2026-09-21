import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetMemoryDiscoveryCandidates } from "../sales-os/discovery-candidates";
import { resetMemoryDiscoveryControl } from "../sales-os/discovery-control";
import {
  resetMemoryDiscoveryRuns,
  setMemoryDiscoveryRunStatusForTest,
} from "../sales-os/discovery-run-queries";
import {
  resolveDevUser,
  sessionCanViewMargin,
  type SessionUser,
} from "../auth/session";
import { createCaller } from "./root";

function caller(user: SessionUser) {
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

function sourceDrafts(
  sources: Array<{
    sourceKey: string;
    enabled: boolean;
    required: boolean;
    accountReferenceId: string | null;
    configuration: { url?: string; feedUrl?: string; notes?: string };
  }>,
) {
  return sources.map((source) => ({
    sourceKey: source.sourceKey,
    enabled: source.enabled,
    required: source.required,
    accountReferenceId: source.accountReferenceId,
    configuration: source.configuration,
  }));
}

describe("Discovery programme contract", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_MODE", "memory");
    resetMemoryDiscoveryRuns();
    resetMemoryDiscoveryCandidates();
    resetMemoryDiscoveryControl();
  });

  it("keeps policy proposals operator-owned but policy acceptance admin-only", async () => {
    const am = caller(resolveDevUser("am"));
    const partner = caller(resolveDevUser("partner"));
    const manifest = await am.salesOs.discovery.manifest();
    const created = await am.salesOs.discovery.programmes.create({
      config: manifest.config,
      sources: sourceDrafts(manifest.sources),
    });
    const suggestion = await am.salesOs.discovery.control.proposePolicy({
      programmeId: created.id,
      maxObservations: 40,
      reason: "Lower the observation cap for future scheduled research runs",
    });

    await expect(
      am.salesOs.discovery.control.acceptPolicy({
        suggestionId: suggestion.suggestionId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      partner.salesOs.discovery.control.acceptPolicy({
        suggestionId: suggestion.suggestionId,
      }),
    ).resolves.toMatchObject({ maxObservations: 40 });
  });

  it("keeps unverified source truth visible and rejects unsafe URLs", async () => {
    const am = caller(resolveDevUser("am"));
    const manifest = await am.salesOs.discovery.manifest();
    expect(manifest.executionEnabled).toBe(false);
    expect(
      [
        "campaign_me",
        "communicate_online",
        "gulf_business",
        "arabian_business",
        "gulf_news_business",
        "khaleej_times_business",
        "the_national_business",
        "time_out_dubai",
      ].every((sourceKey) =>
        manifest.sources.some((source) => source.sourceKey === sourceKey),
      ),
    ).toBe(true);
    expect(
      manifest.sources.find((source) => source.sourceKey === "campaign_me"),
    ).toMatchObject({
      capabilityState: "candidate",
      connectionState: "not_required",
    });
    expect(
      manifest.sources.find((source) => source.sourceKey === "time_out_dubai"),
    ).toMatchObject({
      capabilityState: "blocked",
      required: true,
    });

    await expect(
      am.salesOs.discovery.programmes.create({
        config: manifest.config,
        sources: [
          {
            sourceKey: "campaign_me",
            enabled: true,
            required: true,
            configuration: { url: "https://127.0.0.1/private" },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const omitted = await am.salesOs.discovery.programmes.create({
      config: manifest.config,
      sources: [],
    });
    expect(omitted.draft.sources).toHaveLength(manifest.sources.length);
    expect(
      omitted.readiness.blockers.some(
        (blocker) =>
          blocker.sourceKey === "campaign_me" &&
          blocker.message.includes("required source is disabled"),
      ),
    ).toBe(true);

    const listingOnly = await am.salesOs.discovery.programmes.create({
      config: manifest.config,
      sources: [
        {
          sourceKey: "campaign_me",
          enabled: true,
          required: true,
          configuration: { url: "https://campaignme.com/latest/" },
        },
      ],
    });
    const reopened = await am.salesOs.discovery.programmes.get({
      programmeId: listingOnly.id,
    });
    expect(
      reopened.draft.sources.find(
        (source) => source.sourceKey === "campaign_me",
      )?.configuration,
    ).toEqual({ url: "https://campaignme.com/latest/" });
  });

  it("enforces ownership, admin publish, and one-winner optimistic updates", async () => {
    const amUser = resolveDevUser("am");
    const am = caller(amUser);
    const partner = caller(resolveDevUser("partner"));
    const manifest = await am.salesOs.discovery.manifest();
    const created = await am.salesOs.discovery.programmes.create({
      config: manifest.config,
      sources: sourceDrafts(manifest.sources),
    });
    expect(created).toMatchObject({
      state: "draft",
      version: 1,
      draftVersion: 1,
      executionEnabled: false,
    });

    const otherAm = caller({
      ...amUser,
      employeeId: "c0000000-0000-4000-8000-000000000099",
      email: "other-am@hrmny.local",
    });
    await expect(
      otherAm.salesOs.discovery.programmes.get({ programmeId: created.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      am.salesOs.discovery.programmes.publish({
        programmeId: created.id,
        expectedVersion: created.version,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const editedConfig = {
      ...created.draft.config,
      purpose: `${created.draft.config.purpose} Updated.`,
    };
    const writes = await Promise.allSettled([
      am.salesOs.discovery.programmes.saveDraft({
        programmeId: created.id,
        expectedVersion: created.version,
        config: editedConfig,
        sources: sourceDrafts(created.draft.sources),
      }),
      am.salesOs.discovery.programmes.saveDraft({
        programmeId: created.id,
        expectedVersion: created.version,
        config: {
          ...editedConfig,
          purpose: `${editedConfig.purpose} Concurrent.`,
        },
        sources: sourceDrafts(created.draft.sources),
      }),
    ]);
    expect(writes.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = writes.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: { code: "CONFLICT", message: "PROGRAMME_VERSION_CONFLICT" },
    });

    const fresh = await partner.salesOs.discovery.programmes.get({
      programmeId: created.id,
    });
    const published = await partner.salesOs.discovery.programmes.publish({
      programmeId: created.id,
      expectedVersion: fresh.version,
    });
    expect(published).toMatchObject({
      state: "active",
      publishedVersion: fresh.draftVersion,
      executionEnabled: false,
    });
    expect(published.nextDueAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const scheduled = await am.salesOs.discovery.runs.list({
      programmeId: created.id,
      status: "pending",
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      programmeId: created.id,
      status: "pending",
      trigger: "scheduled",
      executionEnabled: false,
      collectorStarted: false,
    });
    const scheduledDetail = await am.salesOs.discovery.runs.get({
      runId: scheduled[0]!.runId,
    });
    expect(scheduledDetail).toMatchObject({
      n8nClaimed: false,
      executionEnabled: false,
      collectorStarted: false,
    });
    await expect(
      otherAm.salesOs.discovery.runs.get({ runId: scheduled[0]!.runId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      otherAm.salesOs.discovery.runs.cancel({
        runId: scheduled[0]!.runId,
        expectedStateVersion: scheduledDetail.stateVersion,
        reason: "Outsider cancel attempt",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const requestId = "00000000-0000-4000-8000-000000000201";
    const requested = await am.salesOs.discovery.programmes.requestRun({
      programmeId: created.id,
      expectedVersion: published.version,
      requestId,
      overlap: "defer",
    });
    expect(requested.status).toBe("pending");
    const replayed = await am.salesOs.discovery.programmes.requestRun({
      programmeId: created.id,
      expectedVersion: published.version,
      requestId,
      overlap: "defer",
    });
    expect(replayed).toEqual(requested);
    const listed = await am.salesOs.discovery.runs.list({
      programmeId: created.id,
    });
    expect(listed.some((run) => run.runId === requested.runId)).toBe(true);
    const detail = await am.salesOs.discovery.runs.get({
      runId: requested.runId,
    });
    expect(detail).toMatchObject({
      runId: requested.runId,
      status: "pending",
      trigger: "manual",
      executionEnabled: false,
      collectorStarted: false,
      n8nClaimed: false,
    });
    await expect(
      am.salesOs.discovery.runs.cancel({
        runId: requested.runId,
        expectedStateVersion: detail.stateVersion + 1,
        reason: "Stale cancel attempt",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "RUN_STATE_CONFLICT",
    });
    await expect(
      am.salesOs.discovery.runs.cancel({
        runId: requested.runId,
        expectedStateVersion: detail.stateVersion,
        reason: "Operator cancelled the armed Discovery slot",
      }),
    ).resolves.toMatchObject({
      runId: requested.runId,
      status: "cancelled",
      executionEnabled: false,
      collectorStarted: false,
    });
    await expect(
      am.salesOs.discovery.runs.cancel({
        runId: requested.runId,
        expectedStateVersion: detail.stateVersion + 1,
        reason: "Already cancelled",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "RUN_NOT_CANCELLABLE",
    });
    const review = await am.salesOs.discovery.review.summary();
    expect(review).toEqual({
      needsReview: 0,
      needsEvidence: 0,
      researchRunning: 0,
      sourcesNeedingAttention: expect.any(Number),
      executionEnabled: false,
      candidateStoreReady: true,
      candidateStoreAccepted: false,
    });
    expect(review.needsReview).toBe(0);
    expect(published.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "EXECUTION_DISABLED", sourceKey: null }),
    );
    await expect(
      partner.salesOs.discovery.programmes.pause({
        programmeId: created.id,
        expectedVersion: fresh.version,
        reason: "Stale pause attempt",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "PROGRAMME_VERSION_CONFLICT",
    });
    await expect(
      partner.salesOs.discovery.programmes.pause({
        programmeId: created.id,
        expectedVersion: published.version,
        reason: "Hold all future research configuration",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      version: published.version + 1,
      executionEnabled: false,
      nextDueAt: null,
    });
  });

  it("promotes one deferred slot after the active memory run is cancelled", async () => {
    const am = caller(resolveDevUser("am"));
    const partner = caller(resolveDevUser("partner"));
    const manifest = await am.salesOs.discovery.manifest();
    const created = await am.salesOs.discovery.programmes.create({
      config: manifest.config,
      sources: sourceDrafts(manifest.sources),
    });
    const published = await partner.salesOs.discovery.programmes.publish({
      programmeId: created.id,
      expectedVersion: created.version,
    });
    const first = await am.salesOs.discovery.programmes.requestRun({
      programmeId: created.id,
      expectedVersion: published.version,
      requestId: "00000000-0000-4000-8000-000000000301",
      overlap: "defer",
    });
    setMemoryDiscoveryRunStatusForTest(first.runId, "running");
    const deferred = await am.salesOs.discovery.programmes.requestRun({
      programmeId: created.id,
      expectedVersion: published.version,
      requestId: "00000000-0000-4000-8000-000000000302",
      overlap: "defer",
    });
    expect(deferred.status).toBe("deferred");
    const running = await am.salesOs.discovery.runs.get({
      runId: first.runId,
    });
    await expect(
      am.salesOs.discovery.runs.cancel({
        runId: first.runId,
        expectedStateVersion: running.stateVersion,
        reason: "Stop the in-flight slot without a collector",
      }),
    ).resolves.toMatchObject({ status: "cancel_requested" });
    await expect(
      am.salesOs.discovery.runs.get({ runId: deferred.runId }),
    ).resolves.toMatchObject({ status: "deferred" });
    setMemoryDiscoveryRunStatusForTest(first.runId, "cancelled");
    await expect(
      am.salesOs.discovery.runs.get({ runId: deferred.runId }),
    ).resolves.toMatchObject({
      status: "pending",
      trigger: "deferred",
      executionEnabled: false,
      collectorStarted: false,
    });
  });
});
