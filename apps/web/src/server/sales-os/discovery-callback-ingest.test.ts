import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMockProvider, withMetering, type LLMProvider } from "@hrmny/ai";
import {
  admitDiscoveryCallbackObservations,
  applyDiscoveryInterpretationProgress,
  continueDiscoveryInterpretationQueue,
  emptyDiscoveryInterpretationBudget,
  emptyDiscoveryInterpretationQueue,
  evaluateDiscoveryObservationProvenance,
  mapDiscoveryObservationToSubmit,
  maxObservationsFromEffective,
  planDiscoveryInterpretationTick,
  prepareDiscoveryObservationForSubmit,
  readDiscoveryIdentityLineage,
  remainingDiscoveryInterpretationBudget,
  remainingDiscoveryInterpretationBudgetForQueue,
  reserveDiscoveryInterpretationBudget,
  resolveDiscoveryCallbackSource,
  resolveDiscoveryInterpretationJobLastError,
  settleDiscoveryInterpretationBudget,
} from "./discovery-callback-ingest";
import {
  DISCOVERY_INTERPRETATION_BATCH_SIZE,
  DISCOVERY_INTERPRETATION_CLAIM_MS,
  DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB,
  DISCOVERY_INTERPRETATION_MAX_TOKENS_PER_JOB,
  DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL,
  evaluateDiscoveryEvidence,
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
  excerpt: "Example LLC opened a dated Campaign ME listing for a relevant UAE review.",
  companyHints: [{ name: "Example LLC", domain: "example.com" }],
};

describe("Discovery callback ingest mapping", () => {
  it("preserves a global cost-receipt failure across source completion", () => {
    expect(
      resolveDiscoveryInterpretationJobLastError({
        queueLastError: null,
        costReceiptAvailable: false,
        cancelled: false,
      }),
    ).toBe("DISCOVERY_COST_RECEIPT_UNAVAILABLE");
    expect(
      resolveDiscoveryInterpretationJobLastError({
        queueLastError: "RUN_CANCEL_REQUESTED",
        costReceiptAvailable: false,
        cancelled: true,
      }),
    ).toBe("RUN_CANCEL_REQUESTED");
  });

  it("continues a >2000 excerpt without throwing the packet schema", async () => {
    const excerpt = `${"A group wins its first significant contract in a new market. ".repeat(80)}GISEC GLOBAL closed the final.`;
    const item = {
      observationId: observation.observationId,
      sourceItemKey: "gulf-packet-lock",
      excerpt,
      title: "UAE corporate tax risk can begin with one ordinary business decision",
      publishedAt: "2026-09-21T00:00:00.000Z",
      sourceUrl:
        "https://gulfnews.com/business/analysis/uae-corporate-tax-risk-can-begin-with-one-ordinary-business-decision-1.500682575",
      kind: "news",
      contentHash: "a".repeat(64),
    };
    const generate = vi.fn(async (options: { messages: Array<{ content: string }> }) => {
      const packet = JSON.parse(options.messages[1]!.content) as { excerpt: string };
      expect(packet.excerpt.length).toBeLessThanOrEqual(2000);
      return {
        text: JSON.stringify({
          claims: [],
          relevantService: null,
          opportunityKind: "company_signal",
          awardedAppointment: false,
          unsupported: false,
          companyIdentity: { name: null, domain: null, ambiguous: false },
        }),
        object: {
          claims: [],
          relevantService: null,
          opportunityKind: "company_signal",
          awardedAppointment: false,
          unsupported: false,
          companyIdentity: { name: null, domain: null, ambiguous: false },
        },
        provider: "mock" as const,
        model: "mock",
        requestId: "gen-oversize-continue",
      };
    });
    const continued = await continueDiscoveryInterpretationQueue({
      queue: {
        ...emptyDiscoveryInterpretationQueue(),
        pending: [item],
        status: "pending",
      },
      provider: { name: "mock", generate },
      sourceKey: "gulf_news_business",
      configuration: {
        url: "https://gulfnews.com/business",
        feedUrl: "https://gulfnews.com/rss",
        permittedHosts: ["gulfnews.com", "www.gulfnews.com"],
      },
    });
    expect(generate).toHaveBeenCalled();
    expect(continued.queue.done[0]).toMatchObject({
      excerptHash: createHash("sha256").update(excerpt).digest("hex"),
      boundedExcerpt: true,
    });
  });

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
        excerpt: "Example LLC opened a dated Campaign ME listing for a relevant UAE review.",
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

  it("does not attach an ungrounded hint domain to a resolved company", () => {
    const mapped = mapDiscoveryObservationToSubmit(
      {
        ...observation,
        excerpt:
          "Majid Al Futtaim opened a regional creative review in Dubai.",
        companyHints: [
          {
            name: "Women in Advertising 2026",
            domain: "women-in-advertising.example",
          },
        ],
      },
      "campaign_me",
      effective.sources[0]!.configuration,
      { name: "Majid Al Futtaim", domain: "majidalfuttaim.com" },
    );
    expect(mapped).toEqual({
      ok: true,
      values: {
        requestId: observation.observationId,
        companyName: "Majid Al Futtaim",
        website: "https://majidalfuttaim.com",
        discoveryChannel: "publication",
        opportunityKind: "company_signal",
        whyNow: "Agency opens a regional creative review",
        sourceKey: "campaign_me",
        sourceItemId: "publisher-guid-42",
        externalOpportunityId: "publisher-guid-42",
        sourceUrl: "https://campaignme.com/latest/public-news-42",
        excerpt:
          "Majid Al Futtaim opened a regional creative review in Dubai.",
        eventDate: "2026-09-19",
        visibilityScope: "public",
        strategicLane: "industry_scanning",
      },
    });
  });

  it("does not promote an ungrounded title-as-company hint into Review", () => {
    const titleAsCompany = {
      ...observation,
      title: "Women in Advertising 2026: The new holiday masterminds",
      excerpt:
        "Take a moment to picture the traditional Middle Eastern family holiday ad. For years, the industry relied on familiar, comfortable tropes.",
      companyHints: [{ name: "Women in Advertising 2026" }],
    };
    expect(
      mapDiscoveryObservationToSubmit(
        titleAsCompany,
        "campaign_me",
        effective.sources[0]!.configuration,
      ),
    ).toEqual({ ok: false, reason: "COMPANY_IDENTITY_MISSING" });
    const admission = admitDiscoveryCallbackObservations({
      observations: [titleAsCompany],
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
      maxObservations: 40,
    });
    expect(admission.admitted).toEqual([]);
    expect(admission.quarantined).toBe(1);
    expect(admission.pendingInterpretation).toHaveLength(1);
    expect(admission.pendingInterpretation[0]?.title).toBe(titleAsCompany.title);
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
      {
        ...observation,
        companyHints: [],
        excerpt: "A dated Campaign ME listing named a relevant UAE review.",
      },
      "campaign_me",
      configuration,
      createMockProvider(),
    );
    expect(missing).toMatchObject({ ok: false, reason: "COMPANY_IDENTITY_MISSING" });

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
    expect(blocked).toMatchObject({
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
    expect(gated).toMatchObject({
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
    const gulfConfiguration = {
      url: "https://gulfnews.com/business",
      feedUrl: "https://gulfnews.com/feed",
    };
    expect(
      evaluateDiscoveryObservationProvenance({
        url: "https://gulfnews.com/business/retail/talabat-expands-uae-dark-stores-1.123",
        configuration: gulfConfiguration,
      }),
    ).toEqual({
      ok: true,
      url: "https://gulfnews.com/business/retail/talabat-expands-uae-dark-stores-1.123",
    });
    expect(
      evaluateDiscoveryObservationProvenance({
        url: "https://gulfnews.com/sport/cricket/uae-vs-england-1.456",
        configuration: gulfConfiguration,
      }),
    ).toEqual({ ok: false, reason: "SOURCE_PATH_MISMATCH" });
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
    expect(recovered).toMatchObject({ action: "uncertain" });

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
            semantic: "unavailable",
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
      semantic: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
      requestId: null,
    });
    expect(progressed.queue.done[0]?.excerptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not refund a crash after receipt and shares one job budget across sources", () => {
    const tokenBoundedCalls = Math.floor(
      DISCOVERY_INTERPRETATION_MAX_TOKENS_PER_JOB /
        DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL,
    );
    const reservedIds = Array.from(
      { length: tokenBoundedCalls },
      (_, index) => `10000000-0000-4000-8000-00000000${String(index).padStart(4, "0")}`,
    );
    const reserved = reserveDiscoveryInterpretationBudget(
      emptyDiscoveryInterpretationBudget(),
      reservedIds,
    );
    expect(reserved).toMatchObject({
      ok: true,
      budget: {
        reservedCalls: tokenBoundedCalls,
        reservedTokens:
          tokenBoundedCalls *
          DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL,
        settledCalls: 0,
        settledTokens: 0,
      },
    });
    if (!reserved.ok) throw new Error("expected reserve");
    const remaining = remainingDiscoveryInterpretationBudget(reserved.budget);
    expect(remaining).toEqual({
      calls: DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB - tokenBoundedCalls,
      tokens: 0,
    });
    const retrySame = reserveDiscoveryInterpretationBudget(
      reserved.budget,
      reservedIds,
    );
    expect(retrySame).toEqual({ ok: true, budget: reserved.budget });
    const crashedQueue = {
      ...emptyDiscoveryInterpretationQueue(),
      pending: reservedIds.map((observationId, index) => ({
        observationId,
        sourceItemKey: `crash-${index}`,
        contentHash: "c".repeat(64),
        sourceUrl: "https://campaignme.com/latest/crash",
        title: "Crash after receipt",
        excerpt: "Majid Al Futtaim opened a regional creative review in Dubai.",
        publishedAt: "2026-09-19T00:00:00.000Z",
        kind: "news",
      })),
      calls: 0,
    };
    expect(
      planDiscoveryInterpretationTick({
        queue: crashedQueue,
        providerAvailable: true,
        remainingCalls: remaining.calls,
        remainingTokens: remaining.tokens,
      }),
    ).toEqual({ action: "ceiling" });
    const settledLow = settleDiscoveryInterpretationBudget(reserved.budget, {
      calls: 2,
      tokens: 100,
    });
    expect(settledLow.reservedCalls).toBe(
      tokenBoundedCalls,
    );
    expect(settledLow.settledCalls).toBe(2);
    expect(remainingDiscoveryInterpretationBudget(settledLow)).toEqual({
      calls: DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB - tokenBoundedCalls,
      tokens: 0,
    });

    const sourceA = reserveDiscoveryInterpretationBudget(
      emptyDiscoveryInterpretationBudget(),
      reservedIds.slice(0, tokenBoundedCalls - 1),
    );
    expect(sourceA).toMatchObject({
      ok: true,
      budget: { reservedCalls: tokenBoundedCalls - 1 },
    });
    if (!sourceA.ok) throw new Error("expected source A reserve");
    const sourceBOverflow = Array.from(
      { length: 2 },
      (_, index) =>
        `20000000-0000-4000-8000-00000000${String(index).padStart(4, "0")}`,
    );
    expect(
      reserveDiscoveryInterpretationBudget(sourceA.budget, sourceBOverflow),
    ).toEqual({ ok: false, reason: "INTERPRETATION_CEILING_REACHED" });
    const sourceB = reserveDiscoveryInterpretationBudget(
      sourceA.budget,
      reservedIds.slice(tokenBoundedCalls - 1, tokenBoundedCalls),
    );
    expect(sourceB).toMatchObject({
      ok: true,
      budget: { reservedCalls: tokenBoundedCalls },
    });
    if (!sourceB.ok) throw new Error("expected source B reserve");
    expect(remainingDiscoveryInterpretationBudget(sourceB.budget)).toEqual({
      calls: DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB - tokenBoundedCalls,
      tokens: 0,
    });
    expect(
      remainingDiscoveryInterpretationBudgetForQueue(
        sourceB.budget,
        reservedIds.slice(0, 1),
      ),
    ).toEqual({
      calls: DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB - tokenBoundedCalls + 1,
      tokens: DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL,
    });
    expect(
      planDiscoveryInterpretationTick({
        queue: {
          ...emptyDiscoveryInterpretationQueue(),
          pending: crashedQueue.pending.slice(0, 1),
          calls: 0,
        },
        providerAvailable: true,
        remainingCalls: remainingDiscoveryInterpretationBudgetForQueue(
          sourceB.budget,
          reservedIds.slice(0, 1),
        ).calls,
        remainingTokens: remainingDiscoveryInterpretationBudgetForQueue(
          sourceB.budget,
          reservedIds.slice(0, 1),
        ).tokens,
      }).action,
    ).toBe("claim");
    expect(
      planDiscoveryInterpretationTick({
        queue: {
          ...emptyDiscoveryInterpretationQueue(),
          pending: crashedQueue.pending.slice(5),
          calls: 0,
        },
        providerAvailable: true,
        remainingCalls: remainingDiscoveryInterpretationBudget(sourceB.budget)
          .calls,
        remainingTokens: remainingDiscoveryInterpretationBudget(sourceB.budget)
          .tokens,
      }),
    ).toEqual({ action: "ceiling" });
  });

  it("round-trips stored identity lineage on Review without a provider call", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        claims: [],
        relevantService: null,
        opportunityKind: "company_signal",
        awardedAppointment: false,
        unsupported: false,
        companyIdentity: {
          name: "Majid Al Futtaim",
          domain: null,
          ambiguous: false,
        },
      }),
      object: {
        claims: [],
        relevantService: null,
        opportunityKind: "company_signal",
        awardedAppointment: false,
        unsupported: false,
        companyIdentity: {
          name: "Majid Al Futtaim",
          domain: null,
          ambiguous: false,
        },
      },
      provider: "mock" as const,
      model: "mock",
      requestId: "or-lineage-1",
    }));
    const provider: LLMProvider = { name: "mock", generate };
    const named = {
      ...observation,
      companyHints: [] as [],
      excerpt: "Majid Al Futtaim opened a regional creative review in Dubai.",
    };
    const admission = admitDiscoveryCallbackObservations({
      observations: [named],
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
      maxObservations: 40,
    });
    const progressed = await continueDiscoveryInterpretationQueue({
      queue: {
        ...emptyDiscoveryInterpretationQueue(),
        pending: admission.pendingInterpretation,
      },
      provider,
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(progressed.queue.done[0]).toMatchObject({
      observationId: observation.observationId,
      semantic: "model",
      provider: "mock",
      model: "mock",
      requestId: "or-lineage-1",
      identity: { name: "Majid Al Futtaim" },
      grounded: true,
    });
    expect(progressed.queue.done[0]?.requestId).not.toBe(
      observation.observationId,
    );
    const stored = readDiscoveryIdentityLineage(
      {
        sourceOutcomes: {
          campaign_me: { interpretation: progressed.queue },
        },
      },
      observation.observationId,
    );
    expect(stored).toEqual(progressed.queue.done[0]);
    const longExcerpt = ("A group wins its first significant contract in a new market. ").repeat(40).slice(0, 2000);
    const longGenerate = vi.fn(async (options: { messages: Array<{ content: string }> }) => {
      const packet = JSON.parse(options.messages[1]!.content) as { excerpt: string };
      expect(packet.excerpt.length).toBeLessThan(2000);
      return generate.mock.results[0]!.value;
    });
    const longProgressed = await continueDiscoveryInterpretationQueue({
      queue: {
        ...emptyDiscoveryInterpretationQueue(),
        pending: [
          {
            observationId: observation.observationId,
            sourceItemKey: observation.sourceItemKey,
            excerpt: longExcerpt,
            title: observation.title,
            publishedAt: observation.publishedAt,
            sourceUrl: observation.sourceReference.url,
            kind: observation.kind,
            contentHash: observation.contentHash,
          },
        ],
      },
      provider: { name: "mock", generate: longGenerate },
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
    });
    expect(longProgressed.queue.done[0]).toMatchObject({
      boundedExcerpt: true,
      excerptHash: createHash("sha256").update(longExcerpt).digest("hex"),
    });
    expect(longProgressed.queue.done[0]?.boundedExcerptBytes).toBeLessThanOrEqual(1600);
    expect(longProgressed.queue.done[0]?.boundedRequestBytes).toBeLessThanOrEqual(1600);
    const storedLong = readDiscoveryIdentityLineage(
      {
        sourceOutcomes: {
          campaign_me: { interpretation: longProgressed.queue },
        },
      },
      observation.observationId,
    );
    expect(storedLong).toEqual(longProgressed.queue.done[0]);
    expect(storedLong?.boundedRequestBytes).toBe(longProgressed.queue.done[0]?.boundedRequestBytes);
    const evaluation = await evaluateDiscoveryEvidence({
      opportunityKind: "company_signal",
      excerpt: named.excerpt,
      whyNow: named.title,
      eventDate: "2026-09-19",
      visibilityScope: "public",
      companyName: "Majid Al Futtaim",
      sourceUrl: named.sourceReference.url,
      evidenceId: observation.observationId,
      sourceKey: "campaign_me",
      identityLineage: stored ?? undefined,
    });
    expect(evaluation.packet.identityLineage).toEqual(stored);
    expect(evaluation.packet.provider).toBe("unavailable");
  });

  it("leaves the item pending when wrapped-provider cost persistence fails", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        claims: [],
        relevantService: null,
        opportunityKind: "company_signal",
        awardedAppointment: false,
        unsupported: false,
        companyIdentity: {
          name: "Majid Al Futtaim",
          domain: null,
          ambiguous: false,
        },
      }),
      object: {
        claims: [],
        relevantService: null,
        opportunityKind: "company_signal",
        awardedAppointment: false,
        unsupported: false,
        companyIdentity: {
          name: "Majid Al Futtaim",
          domain: null,
          ambiguous: false,
        },
      },
      provider: "mock" as const,
      model: "mock",
      requestId: "or-cost-1",
      inputTokens: 20,
      outputTokens: 8,
    }));
    const provider = withMetering(
      { name: "mock", generate },
      {
        agent: "research",
        monthlyCapAed: 100,
        getMonthlySpendAed: async () => 0,
        onCost: async () => {
          throw new Error("DISCOVERY_COST_RECEIPT_UNAVAILABLE");
        },
      },
    );
    const admission = admitDiscoveryCallbackObservations({
      observations: [
        {
          ...observation,
          companyHints: [],
          excerpt:
            "Majid Al Futtaim opened a regional creative review in Dubai.",
        },
        {
          ...observation,
          observationId: "20000000-0000-4000-8000-000000000001",
          sourceItemKey: "unattempted-after-receipt-failure",
          companyHints: [],
          excerpt: "Emaar announced a regional marketing review in Dubai.",
        },
      ],
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
      maxObservations: 40,
    });
    const progressed = await continueDiscoveryInterpretationQueue({
      queue: {
        ...emptyDiscoveryInterpretationQueue(),
        pending: admission.pendingInterpretation,
      },
      provider,
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(progressed.resolved).toEqual([]);
    expect(progressed.queue.done).toHaveLength(1);
    expect(progressed.queue.done[0]).toMatchObject({
      observationId: observation.observationId,
      reason: "DISCOVERY_COST_RECEIPT_UNAVAILABLE",
      requestId: null,
    });
    expect(progressed.queue.status).toBe("unavailable");
    expect(progressed.queue.lastError).toBe("DISCOVERY_COST_RECEIPT_UNAVAILABLE");
    expect(progressed.queue.pending).toHaveLength(1);
    expect(progressed.queue.inFlight).toEqual([]);
  });

  it("stops automatic retry of a stale in-flight claim without a free replay", async () => {
    const generate = vi.fn(async () => {
      throw new Error("stale claim must not call the provider");
    });
    const item = {
      observationId: observation.observationId,
      sourceItemKey: "stale-claim",
      contentHash: "c".repeat(64),
      sourceUrl: "https://campaignme.com/latest/stale",
      title: "Stale claim",
      excerpt: "Majid Al Futtaim opened a regional creative review in Dubai.",
      publishedAt: "2026-09-19T00:00:00.000Z",
      kind: "news",
    };
    const reserved = reserveDiscoveryInterpretationBudget(
      emptyDiscoveryInterpretationBudget(),
      [item.observationId],
    );
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) throw new Error("expected reserve");
    const remaining = remainingDiscoveryInterpretationBudget(reserved.budget);
    const stale = {
      ...emptyDiscoveryInterpretationQueue(),
      inFlight: [item],
      claimedAt: new Date(
        Date.now() - DISCOVERY_INTERPRETATION_CLAIM_MS - 5,
      ).toISOString(),
      status: "continuing" as const,
      calls: 0,
    };
    expect(
      planDiscoveryInterpretationTick({
        queue: stale,
        providerAvailable: true,
        remainingCalls: remaining.calls,
        remainingTokens: remaining.tokens,
        nowMs: Date.now(),
      }),
    ).toMatchObject({ action: "uncertain", items: [item] });
    const progressed = await continueDiscoveryInterpretationQueue({
      queue: stale,
      provider: { name: "mock", generate },
      sourceKey: "campaign_me",
      configuration: effective.sources[0]!.configuration,
      remainingCalls: remaining.calls,
      remainingTokens: remaining.tokens,
      nowMs: Date.now(),
    });
    expect(generate).not.toHaveBeenCalled();
    expect(progressed.resolved).toEqual([]);
    expect(progressed.queue.done[0]).toMatchObject({
      observationId: item.observationId,
      reason: "INTERPRETATION_OUTCOME_UNCERTAIN",
      requestId: null,
    });
    expect(progressed.queue.inFlight).toEqual([]);
    expect(progressed.queue.status).toBe("unavailable");
    const retryReserve = reserveDiscoveryInterpretationBudget(
      reserved.budget,
      [item.observationId],
    );
    expect(retryReserve).toEqual({ ok: true, budget: reserved.budget });
    expect(
      planDiscoveryInterpretationTick({
        queue: progressed.queue,
        providerAvailable: true,
        remainingCalls: remainingDiscoveryInterpretationBudget(
          reserved.budget,
        ).calls,
        remainingTokens: remainingDiscoveryInterpretationBudget(
          reserved.budget,
        ).tokens,
      }),
    ).toEqual({ action: "done" });
  });

  it("keeps leftover pending items continuable after a two-source 12-call reservation", () => {
    const firstWave = Array.from(
      { length: 12 },
      (_, index) =>
        `30000000-0000-4000-8000-00000000${String(index).padStart(4, "0")}`,
    );
    const leftoverId = "40000000-0000-4000-8000-000000000001";
    const reserved = reserveDiscoveryInterpretationBudget(
      emptyDiscoveryInterpretationBudget(),
      firstWave,
    );
    expect(reserved).toMatchObject({
      ok: true,
      budget: { reservedCalls: 12 },
    });
    if (!reserved.ok) throw new Error("expected first-wave reserve");
    const leftover = reserveDiscoveryInterpretationBudget(reserved.budget, [
      leftoverId,
    ]);
    expect(leftover).toMatchObject({
      ok: true,
      budget: { reservedCalls: 13 },
    });
    if (!leftover.ok) throw new Error("expected leftover reserve");
    const remaining = remainingDiscoveryInterpretationBudgetForQueue(
      leftover.budget,
      [leftoverId],
    );
    expect(remaining.calls).toBeGreaterThan(0);
    expect(
      planDiscoveryInterpretationTick({
        queue: {
          ...emptyDiscoveryInterpretationQueue(),
          pending: [
            {
              observationId: leftoverId,
              sourceItemKey: "leftover-campaign-me",
              contentHash: "d".repeat(64),
              sourceUrl:
                "https://campaignme.com/talabat-appoints-selin-suzer-as-chief-marketing-officer/",
              title: "talabat appoints Selin Süzer as Chief Marketing Officer",
              excerpt:
                "talabat appointed Selin Süzer as Chief Marketing Officer.",
              publishedAt: "2026-09-21T00:00:00.000Z",
              kind: "news",
            },
          ],
          status: "ceiling",
          lastError: "INTERPRETATION_CEILING_REACHED",
        },
        providerAvailable: true,
        remainingCalls: remaining.calls,
        remainingTokens: remaining.tokens,
      }).action,
    ).toBe("claim");
  });
});
