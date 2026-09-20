import { describe, expect, it, vi } from "vitest";
import { createMockProvider, type LLMProvider } from "@hrmny/ai";
import {
  admitDiscoveryCallbackObservations,
  applyDiscoveryInterpretationProgress,
  continueDiscoveryInterpretationQueue,
  emptyDiscoveryInterpretationQueue,
  evaluateDiscoveryObservationProvenance,
  mapDiscoveryObservationToSubmit,
  maxObservationsFromEffective,
  planDiscoveryInterpretationTick,
  prepareDiscoveryObservationForSubmit,
  resolveDiscoveryCallbackSource,
} from "./discovery-callback-ingest";
import {
  DISCOVERY_INTERPRETATION_BATCH_SIZE,
  DISCOVERY_INTERPRETATION_CLAIM_MS,
  DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB,
} from "./discovery-interpretation";
import {
  buildDiscoveryN8nTrigger,
  DiscoveryRunError,
} from "./discovery-runs";
import type { DiscoveryEffectiveSnapshotV1 } from "./discovery-runs";

const bindingId = "10000000-0000-4000-8000-000000000003";
const effective: DiscoveryEffectiveSnapshotV1 = {
  programmeVersionId: "10000000-0000-4000-8000-000000000010",
  versionNumber: 1,
  configHash: "a".repeat(64),
  config: {
    limits: { maxObservations: 40 },
    reviewerEmployeeIds: ["10000000-0000-4000-8000-000000000011"],
  },
  sources: [
    {
      bindingId,
      sourceKey: "campaign_me",
      adapter: "publisher_feed_or_listing",
      adapterVersion: "unverified-v1",
      configuration: {
        url: "https://campaignme.com/latest/",
        feedUrl: "https://campaignme.com/feed/",
        notes: "do-not-send",
      },
      accountReferenceId: null,
      credentialGeneration: 2,
      enabled: true,
      required: true,
      executionMode: "automatic",
    },
    {
      bindingId: "10000000-0000-4000-8000-000000000099",
      sourceKey: "intent_import",
      adapter: "private_upload",
      adapterVersion: "unverified-v1",
      configuration: { notes: "private" },
      accountReferenceId: null,
      credentialGeneration: 0,
      enabled: true,
      required: false,
      executionMode: "manual",
    },
  ],
  runtime: {
    ownerEmployeeId: "10000000-0000-4000-8000-000000000012",
    n8nConnectionAccountId: "10000000-0000-4000-8000-000000000013",
    n8nConnectionOwnerEmployeeId: "10000000-0000-4000-8000-000000000012",
    n8nCredentialVersion: "1",
  },
};

const observation = {
  observationId: "10000000-0000-4000-8000-000000000005",
  sourceItemKey: "publisher-guid-42",
  contentHash: "b".repeat(64),
  sourceReference: {
    kind: "public_url" as const,
    url: "https://campaignme.com/latest/public-news-42",
  },
  observedAt: "2026-09-20T00:00:00.000Z",
  publishedAt: "2026-09-19T00:00:00.000Z",
  dateEvidence: {
    method: "feed" as const,
    precision: "day" as const,
  },
  kind: "news" as const,
  title: "Agency opens a regional creative review",
  excerpt: "A dated Campaign ME listing named a relevant UAE review.",
  companyHints: [{ name: "Example LLC", domain: "example.com" }],
};

describe("Discovery callback ingest mapping", () => {
  it("resolves the frozen binding and rejects a stale credential generation", () => {
    expect(
      resolveDiscoveryCallbackSource(effective, bindingId, 2),
    ).toEqual({
      ok: true,
      source: {
        bindingId,
        sourceKey: "campaign_me",
        credentialGeneration: 2,
        configuration: effective.sources[0]!.configuration,
      },
    });
    expect(
      resolveDiscoveryCallbackSource(effective, bindingId, 3),
    ).toEqual({ ok: false, code: "CREDENTIAL_GENERATION_MISMATCH" });
    expect(
      resolveDiscoveryCallbackSource(
        effective,
        "10000000-0000-4000-8000-000000000404",
        2,
      ),
    ).toEqual({ ok: false, code: "SOURCE_NOT_IN_RUN" });
    expect(
      resolveDiscoveryCallbackSource(null, bindingId, 2),
    ).toEqual({ ok: false, code: "RUN_FENCE_MISSING" });
  });

  it("maps a public-news observation onto the existing Review submit contract", () => {
    expect(
      mapDiscoveryObservationToSubmit(
        observation,
        "campaign_me",
        effective.sources[0]!.configuration,
      ),
    ).toEqual({
      ok: true,
      values: {
        requestId: observation.observationId,
        companyName: "Example LLC",
        website: "https://example.com",
        discoveryChannel: "publication",
        opportunityKind: "company_signal",
        whyNow: "Agency opens a regional creative review",
        sourceKey: "campaign_me",
        sourceItemId: "publisher-guid-42",
        externalOpportunityId: "publisher-guid-42",
        sourceUrl: "https://campaignme.com/latest/public-news-42",
        excerpt: "A dated Campaign ME listing named a relevant UAE review.",
        eventDate: "2026-09-19",
        visibilityScope: "public",
        strategicLane: "industry_scanning",
      },
    });
  });

  it("quarantines a news observation without an explicit company identity", () => {
    expect(
      mapDiscoveryObservationToSubmit(
        { ...observation, companyHints: [] },
        "campaign_me",
        effective.sources[0]!.configuration,
      ),
    ).toEqual({ ok: false, reason: "COMPANY_IDENTITY_MISSING" });
  });

  it("resolves a grounded public-news company from the excerpt and leaves unknown identity unresolved", async () => {
    const configuration = effective.sources[0]!.configuration;
    const named = await prepareDiscoveryObservationForSubmit(
      {
        ...observation,
        title: "Agency opens a regional creative review",
        excerpt:
          "Majid Al Futtaim opened a regional creative review in Dubai.",
        companyHints: [],
      },
      "campaign_me",
      configuration,
      createMockProvider(),
    );
    expect(named).toMatchObject({
      ok: true,
      values: {
        companyName: "Majid Al Futtaim",
        excerpt:
          "Majid Al Futtaim opened a regional creative review in Dubai.",
        eventDate: "2026-09-19",
        sourceUrl: "https://campaignme.com/latest/public-news-42",
      },
    });

    const missing = await prepareDiscoveryObservationForSubmit(
      { ...observation, companyHints: [] },
      "campaign_me",
      configuration,
      createMockProvider(),
    );
    expect(missing).toEqual({ ok: false, reason: "COMPANY_IDENTITY_MISSING" });

    const unavailable: LLMProvider = {
      name: "openrouter",
      async generate() {
        throw new Error("provider unavailable");
      },
    };
    const blocked = await prepareDiscoveryObservationForSubmit(
      {
        ...observation,
        excerpt:
          "Majid Al Futtaim opened a regional creative review in Dubai.",
        companyHints: [],
      },
      "campaign_me",
      configuration,
      unavailable,
    );
    expect(blocked).toEqual({
      ok: false,
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    });
    const gated = await prepareDiscoveryObservationForSubmit(
      {
        ...observation,
        excerpt:
          "Majid Al Futtaim opened a regional creative review in Dubai.",
        companyHints: [],
      },
      "campaign_me",
      configuration,
    );
    expect(gated).toEqual({
      ok: false,
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    });
  });

  it("quarantines authorized documents and keeps the published observation cap", () => {
    expect(
      mapDiscoveryObservationToSubmit(
        {
          ...observation,
          sourceReference: {
            kind: "authorized_document",
            artifactId: "10000000-0000-4000-8000-000000000077",
          },
        },
        "campaign_me",
        effective.sources[0]!.configuration,
      ),
    ).toEqual({ ok: false, reason: "AUTHORIZED_DOCUMENT_NOT_INGESTED" });
    expect(maxObservationsFromEffective(effective)).toBe(40);
    expect(maxObservationsFromEffective(null)).toBe(200);
  });

  it("puts only public automatic source URLs on the n8n trigger", () => {
    const trigger = buildDiscoveryN8nTrigger({
      jobId: "10000000-0000-4000-8000-000000000002",
      programmeId: "10000000-0000-4000-8000-000000000001",
      attemptToken: "10000000-0000-4000-8000-000000000004",
      attempts: 1,
      overallDeadlineAt: new Date("2026-09-20T00:30:00.000Z"),
      effective,
    });
    expect(trigger.maxObservations).toBe(40);
    expect(trigger.sources).toEqual([
      {
        bindingId,
        sourceKey: "campaign_me",
        adapter: "publisher_feed_or_listing",
        adapterVersion: "unverified-v1",
        credentialGeneration: 2,
        executionMode: "automatic",
        configuration: {
          url: "https://campaignme.com/latest/",
          feedUrl: "https://campaignme.com/feed/",
        },
      },
    ]);
    expect(JSON.stringify(trigger)).not.toContain("do-not-send");
    expect(JSON.stringify(trigger)).not.toContain("private");
  });

  it("keeps Campaign ME article URLs and rejects off-origin provenance", () => {
    const configuration = effective.sources[0]!.configuration;
    expect(
      evaluateDiscoveryObservationProvenance({
        url: "https://campaignme.com/latest/public-news-42",
        configuration,
      }),
    ).toEqual({
      ok: true,
      url: "https://campaignme.com/latest/public-news-42",
    });
    expect(
      evaluateDiscoveryObservationProvenance({
        url: "https://www.campaignme.com/agency-review-2026/",
        configuration,
      }).ok,
    ).toBe(true);
    expect(
      evaluateDiscoveryObservationProvenance({
        url: "https://communicateonline.me/latest/other-title",
        configuration,
      }),
    ).toEqual({ ok: false, reason: "SOURCE_ORIGIN_MISMATCH" });
    expect(
      evaluateDiscoveryObservationProvenance({
        url: "https://127.0.0.1/latest/private",
        configuration,
      }),
    ).toEqual({ ok: false, reason: "SOURCE_URL_NOT_PUBLIC_HTTPS" });
    expect(
      evaluateDiscoveryObservationProvenance({
        url: "ftp://campaignme.com/latest/file",
        configuration,
      }),
    ).toEqual({ ok: false, reason: "SOURCE_URL_SCHEME_REJECTED" });
    expect(
      evaluateDiscoveryObservationProvenance({
        url: "https://user:secret@campaignme.com/latest/private",
        configuration,
      }),
    ).toEqual({ ok: false, reason: "SOURCE_URL_CREDENTIALS_REJECTED" });
    expect(
      evaluateDiscoveryObservationProvenance({
        url: "https://campaignme.com/latest/public-news-42?redirect=https://evil.example/hook",
        configuration,
      }),
    ).toEqual({ ok: false, reason: "SOURCE_REDIRECT_PROVENANCE_REJECTED" });
    expect(
      mapDiscoveryObservationToSubmit(
        {
          ...observation,
          sourceReference: {
            kind: "public_url",
            url: "https://communicateonline.me/latest/other-title",
          },
        },
        "campaign_me",
        configuration,
      ),
    ).toEqual({ ok: false, reason: "SOURCE_ORIGIN_MISMATCH" });
  });

  it("refuses an empty automatic collector trigger", () => {
    expect(() =>
      buildDiscoveryN8nTrigger({
        jobId: "10000000-0000-4000-8000-000000000002",
        programmeId: "10000000-0000-4000-8000-000000000001",
        attemptToken: "10000000-0000-4000-8000-000000000004",
        attempts: 1,
        overallDeadlineAt: new Date("2026-09-20T00:30:00.000Z"),
        effective: {
          ...effective,
          sources: effective.sources.map((source) => ({
            ...source,
            executionMode: "manual" as const,
          })),
        },
      }),
    ).toThrowError(new DiscoveryRunError("INVALID_STATE", "NO_AUTOMATIC_DISCOVERY_SOURCES"));
  });

  it("admits a signed batch without provider I/O and bounds a 100-item interpretation queue", async () => {
    const generate = vi.fn(async () => {
      throw new Error("provider I/O during admission");
    });
    const provider: LLMProvider = { name: "openrouter", generate };
    const observations = Array.from({ length: 100 }, (_, index) => ({
      ...observation,
      observationId: `10000000-0000-4000-8000-00000000${String(index).padStart(4, "0")}`,
      sourceItemKey: `publisher-guid-${index}`,
      companyHints: [] as [],
      excerpt: "Majid Al Futtaim opened a regional creative review in Dubai.",
    }));
    const admission = admitDiscoveryCallbackObservations({
      observations,
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
      maxObservations: 200,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(admission.admitted).toEqual([]);
    expect(admission.pendingInterpretation).toHaveLength(100);
    expect(admission.quarantined).toBe(100);

    const capped = admitDiscoveryCallbackObservations({
      observations,
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
      maxObservations: 2,
    });
    expect(capped.pendingInterpretation).toHaveLength(2);
    expect(capped.quarantined).toBe(100);

    const queue = {
      ...emptyDiscoveryInterpretationQueue(),
      pending: admission.pendingInterpretation,
    };
    const first = planDiscoveryInterpretationTick({
      queue,
      providerAvailable: true,
    });
    expect(first).toMatchObject({ action: "claim" });
    if (first.action !== "claim") throw new Error("expected claim");
    expect(first.items).toHaveLength(DISCOVERY_INTERPRETATION_BATCH_SIZE);

    const ceiling = planDiscoveryInterpretationTick({
      queue: { ...queue, calls: DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB },
      providerAvailable: true,
    });
    expect(ceiling).toEqual({ action: "ceiling" });

    const claimed = applyDiscoveryInterpretationProgress(queue, {
      claimed: first.items,
      status: "continuing",
    });
    const busy = planDiscoveryInterpretationTick({
      queue: claimed,
      providerAvailable: true,
      nowMs: Date.parse(claimed.claimedAt ?? "") + 1_000,
    });
    expect(busy).toEqual({ action: "busy" });
    const recovered = planDiscoveryInterpretationTick({
      queue: claimed,
      providerAvailable: true,
      nowMs: Date.parse(claimed.claimedAt ?? "") + DISCOVERY_INTERPRETATION_CLAIM_MS + 1,
    });
    expect(recovered).toMatchObject({ action: "claim" });

    await expect(
      continueDiscoveryInterpretationQueue({
        queue,
        cancelled: true,
        provider,
        sourceKey: "campaign_me",
        configuration: effective.sources[0]!.configuration,
      }),
    ).resolves.toMatchObject({
      resolved: [],
      queue: { status: "cancelled", lastError: "RUN_CANCEL_REQUESTED" },
    });
    const replayed = planDiscoveryInterpretationTick({
      queue: applyDiscoveryInterpretationProgress(queue, {
        results: [
          {
            observationId: admission.pendingInterpretation[0]!.observationId,
            status: "resolved",
          },
        ],
      }),
      providerAvailable: true,
    });
    expect(replayed).toMatchObject({ action: "claim" });
    if (replayed.action === "claim") {
      expect(
        replayed.items.some(
          (item) =>
            item.observationId ===
            admission.pendingInterpretation[0]!.observationId,
        ),
      ).toBe(false);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it("stores unavailable and keeps deterministic rules when real interpretation is disabled", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({ awardedAppointment: true }),
      object: { awardedAppointment: true },
      provider: "mock" as const,
      model: "mock",
    }));
    const provider: LLMProvider = { name: "mock", generate };
    const admission = admitDiscoveryCallbackObservations({
      observations: [{ ...observation, companyHints: [] }],
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
      maxObservations: 40,
    });
    expect(admission.pendingInterpretation).toHaveLength(1);
    const progressed = await continueDiscoveryInterpretationQueue({
      queue: {
        ...emptyDiscoveryInterpretationQueue(),
        pending: admission.pendingInterpretation,
      },
      provider,
      providerAvailable: false,
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(progressed.resolved).toEqual([]);
    expect(progressed.queue.status).toBe("unavailable");
    expect(progressed.queue.done[0]).toMatchObject({
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    });
  });
});
