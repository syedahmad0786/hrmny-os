import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockProvider, withMetering, type LLMProvider } from "@hrmny/ai";
import {
  discoveryInterpretationResultSchema,
  DISCOVERY_INTERPRETATION_MAX_INPUT_BYTES_PER_CALL,
  createLiveDiscoveryInterpretationProvider,
  evaluateDiscoveryEvidence,
  interpretPublicDiscoveryExcerpt,
  resolveDiscoveryInterpretationRoute,
  resolvePublicDiscoveryCompanyIdentity,
  verifyDiscoveryZeroPriceRoute,
} from "./discovery-interpretation";

const now = new Date("2026-09-20T00:00:00.000Z");

function providerFromObject(object: unknown): LLMProvider {
  return {
    name: "mock",
    async generate() {
      return {
        text: JSON.stringify(object),
        object,
        provider: "mock",
        model: "mock",
      };
    },
  };
}

describe("Discovery interpretation packet", () => {
  it("coerces Nex identity-only JSON into the Discovery result schema", async () => {
    const resolved = await resolvePublicDiscoveryCompanyIdentity({
      excerpt:
        "talabat, a leading everyday delivery app in the MENA region, has appointed Selin Suzer as Chief Marketing Officer.",
      provider: {
        name: "mock",
        async generate() {
          return {
            text: JSON.stringify({
              companyName: "talabat",
              host: null,
              confidence: "high",
            }),
            provider: "mock",
            model: "mock",
            requestId: "gen-coerce",
          };
        },
      },
    });
    expect(resolved).toMatchObject({
      ok: true,
      name: "talabat",
      receipt: { requestId: "gen-coerce" },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not invoke a provider on ordinary evaluation and labels facts separately from interpretations", async () => {
    const evaluation = await evaluateDiscoveryEvidence({
      opportunityKind: "submission",
      excerpt: "The brand opened a regional creative review in Dubai.",
      whyNow: "A dated agency review opened a relevant UAE brief.",
      eventDate: "2026-09-18",
      visibilityScope: "public",
      companyName: "Campaign House Dubai",
      website: "https://campaignme.com",
      sourceUrl: "https://campaignme.com/latest/review",
      now,
    });
    expect(evaluation.disposition).toBe("actionable");
    expect(evaluation.packet).toMatchObject({
      schemaVersion: 1,
      provider: "unavailable",
      interpretationStatus: "unavailable",
      webSearch: false,
      privateContext: false,
      excerptIncluded: true,
    });
    expect(evaluation.facts.some((fact) => fact.text.includes("2026-09-18"))).toBe(
      true,
    );
    expect(evaluation.facts.some((fact) => fact.text.includes("campaignme.com"))).toBe(
      true,
    );
    expect(evaluation.interpretations).toEqual([]);

    const mocked = await evaluateDiscoveryEvidence({
      opportunityKind: "submission",
      excerpt: "The brand opened a regional creative review in Dubai.",
      whyNow: "A dated agency review opened a relevant UAE brief.",
      eventDate: "2026-09-18",
      visibilityScope: "public",
      companyName: "Campaign House Dubai",
      website: "https://campaignme.com",
      sourceUrl: "https://campaignme.com/latest/review",
      now,
      provider: createMockProvider(),
    });
    expect(mocked.packet.provider).toBe("mock");
    expect(mocked.interpretations.length).toBeGreaterThan(0);
    expect(
      mocked.interpretations.every((claim) => !/AED|budget/i.test(claim.text)),
    ).toBe(true);

    const mock = createMockProvider();
    const generated = await mock.generate({
      task: "discovery_interpret",
      webSearch: false,
      privateContext: false,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            excerpt: "The issuer awarded the account yesterday.",
            evidenceId: "obs-1",
            opportunityKind: "company_signal",
          }),
        },
      ],
    });
    const parsed = discoveryInterpretationResultSchema.parse(generated.object);
    expect(parsed.awardedAppointment).toBe(true);
  });

  it("leaves empty or ambiguous public-news identity unresolved", async () => {
    const empty = await resolvePublicDiscoveryCompanyIdentity({
      excerpt: "A dated listing named a relevant UAE review.",
      provider: createMockProvider(),
    });
    expect(empty).toMatchObject({ ok: false, reason: "COMPANY_IDENTITY_MISSING" });

    const ambiguous = await resolvePublicDiscoveryCompanyIdentity({
      excerpt:
        "Majid Al Futtaim and Emaar Properties opened competing reviews.",
      provider: createMockProvider(),
    });
    expect(ambiguous).toMatchObject({
      ok: false,
      reason: "COMPANY_IDENTITY_AMBIGUOUS",
    });

    const fromHeadlineOnly = await resolvePublicDiscoveryCompanyIdentity({
      excerpt: "A dated listing named a relevant UAE review.",
      provider: providerFromObject({
        claims: [],
        relevantService: null,
        opportunityKind: "company_signal",
        awardedAppointment: false,
        unsupported: false,
        companyIdentity: {
          name: "Agency Opens Regional Review",
          domain: null,
          ambiguous: false,
        },
      }),
    });
    expect(fromHeadlineOnly).toMatchObject({
      ok: false,
      reason: "COMPANY_IDENTITY_MISSING",
    });
  });

  it("accepts a named company only when it is grounded in the excerpt", async () => {
    const resolved = await resolvePublicDiscoveryCompanyIdentity({
      excerpt:
        "Majid Al Futtaim opened a regional creative review in Dubai.",
      evidenceId: "obs-named",
      eventDate: "2026-09-18",
      provider: createMockProvider(),
    });
    expect(resolved).toMatchObject({ ok: true, name: "Majid Al Futtaim" });
    expect(resolved.ok ? resolved.receipt.requestId ?? null : "missing").toBe(
      null,
    );

    const evaluation = await evaluateDiscoveryEvidence({
      opportunityKind: "company_signal",
      excerpt:
        "Majid Al Futtaim opened a regional creative review in Dubai.",
      whyNow: "A dated agency review opened a relevant UAE brief.",
      eventDate: "2026-09-18",
      visibilityScope: "public",
      companyName: "Majid Al Futtaim",
      website: "https://campaignme.com",
      sourceUrl: "https://campaignme.com/latest/maf-review",
      now,
    });
    expect(evaluation.identity.companyName).toBe("majid al futtaim");
    expect(evaluation.eventDate).toBe("2026-09-18");
    expect(
      evaluation.facts.some((fact) =>
        fact.text.includes("https://campaignme.com/latest/maf-review"),
      ),
    ).toBe(true);
    expect(evaluation.disposition).toBe("actionable");
  });

  it("discards a malformed model result instead of inventing identity or claims", async () => {
    const malformed = await resolvePublicDiscoveryCompanyIdentity({
      excerpt:
        "Majid Al Futtaim opened a regional creative review in Dubai.",
      provider: providerFromObject({ not: "a discovery result" }),
    });
    expect(malformed).toMatchObject({
      ok: false,
      reason: "INTERPRETATION_MALFORMED",
    });

    const evaluation = await evaluateDiscoveryEvidence({
      opportunityKind: "company_signal",
      excerpt:
        "Majid Al Futtaim opened a regional creative review in Dubai.",
      whyNow: "A dated agency review opened a relevant UAE brief.",
      eventDate: "2026-09-18",
      visibilityScope: "public",
      companyName: "Majid Al Futtaim",
      sourceUrl: "https://campaignme.com/latest/maf-review",
      now,
      provider: providerFromObject("not-json"),
    });
    expect(evaluation.packet.interpretationStatus).toBe("malformed");
    expect(evaluation.reasons.join(" ")).toMatch(/malformed/i);
    expect(evaluation.interpretations).toEqual([]);
    expect(evaluation.eventDate).toBe("2026-09-18");
  });

  it("rejects awarded agency wins as open opportunities and keeps open pitches reviewable", async () => {
    const awarded = await evaluateDiscoveryEvidence({
      opportunityKind: "company_signal",
      excerpt: "The issuer awarded the account to another agency last week.",
      whyNow: "Campaign ME published an already-awarded appointment.",
      eventDate: "2026-09-18",
      visibilityScope: "public",
      companyName: "Awarded Signal Co",
      sourceUrl: "https://campaignme.com/latest/awarded",
      now,
    });
    expect(awarded.disposition).toBe("awarded");
    expect(awarded.reviewState).toBe("parked");
    expect(awarded.reasons.join(" ")).toMatch(/not an open pitch/i);

    const modelAwarded = await evaluateDiscoveryEvidence({
      opportunityKind: "company_signal",
      excerpt:
        "Majid Al Futtaim opened a regional creative review in Dubai.",
      whyNow: "A dated agency review opened a relevant UAE brief.",
      eventDate: "2026-09-18",
      visibilityScope: "public",
      companyName: "Majid Al Futtaim",
      sourceUrl: "https://campaignme.com/latest/maf-review",
      now,
      provider: providerFromObject({
        claims: [],
        relevantService: null,
        opportunityKind: "company_signal",
        awardedAppointment: true,
        unsupported: false,
        companyIdentity: {
          name: "Majid Al Futtaim",
          domain: null,
          ambiguous: false,
        },
      }),
    });
    expect(modelAwarded.disposition).toBe("awarded");
    expect(modelAwarded.reviewState).toBe("parked");

    const openPitch = await evaluateDiscoveryEvidence({
      opportunityKind: "company_signal",
      excerpt:
        "Majid Al Futtaim opened a regional creative review in Dubai.",
      whyNow: "A dated agency review opened a relevant UAE brief.",
      eventDate: "2026-09-18",
      visibilityScope: "public",
      companyName: "Majid Al Futtaim",
      sourceUrl: "https://campaignme.com/latest/maf-review",
      now,
    });
    expect(openPitch.disposition).toBe("actionable");
    expect(openPitch.reviewState).toBe("needs_review");
  });

  it("keeps identity unresolved when the interpretation provider is unavailable", async () => {
    const unavailable: LLMProvider = {
      name: "openrouter",
      async generate() {
        throw new Error("provider unavailable");
      },
    };
    const resolved = await resolvePublicDiscoveryCompanyIdentity({
      excerpt:
        "Majid Al Futtaim opened a regional creative review in Dubai.",
      provider: unavailable,
    });
    expect(resolved).toMatchObject({
      ok: false,
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    });

    const evaluation = await evaluateDiscoveryEvidence({
      opportunityKind: "company_signal",
      excerpt:
        "Majid Al Futtaim opened a regional creative review in Dubai.",
      whyNow: "A dated agency review opened a relevant UAE brief.",
      eventDate: "2026-09-18",
      visibilityScope: "public",
      companyName: "Majid Al Futtaim",
      sourceUrl: "https://campaignme.com/latest/maf-review",
      now,
      provider: unavailable,
    });
    expect(evaluation.packet.provider).toBe("unavailable");
    expect(evaluation.packet.interpretationStatus).toBe("unavailable");
    expect(evaluation.eventDate).toBe("2026-09-18");
    expect(evaluation.facts.some((fact) => fact.text.includes("2026-09-18"))).toBe(
      true,
    );
    expect(
      evaluation.facts.some((fact) =>
        fact.text.includes("https://campaignme.com/latest/maf-review"),
      ),
    ).toBe(true);
  });

  it("requires an explicit free zero-price model and refuses paid or local routes", () => {
    expect(verifyDiscoveryZeroPriceRoute("openai/gpt-4o")).toEqual({
      ok: false,
      reason: "DISCOVERY_PAID_ROUTE_REFUSED",
    });
    expect(verifyDiscoveryZeroPriceRoute("openrouter/free")).toEqual({
      ok: false,
      reason: "DISCOVERY_PAID_ROUTE_REFUSED",
    });
    expect(verifyDiscoveryZeroPriceRoute("stealth/ox-alpha")).toEqual({
      ok: false,
      reason: "DISCOVERY_PAID_ROUTE_REFUSED",
    });
    expect(verifyDiscoveryZeroPriceRoute("vendor/unknown:free")).toEqual({
      ok: false,
      reason: "DISCOVERY_PAID_ROUTE_REFUSED",
    });
    expect(
      resolveDiscoveryInterpretationRoute({
        enabled: true,
        model: "openai/gpt-4o",
        providerName: "openrouter",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "DISCOVERY_PAID_ROUTE_REFUSED",
    });
    expect(
      resolveDiscoveryInterpretationRoute({
        enabled: true,
        model: "stealth/ox-alpha",
        providerName: "ollama",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "DISCOVERY_LOCAL_INFERENCE_REFUSED",
    });
    expect(
      resolveDiscoveryInterpretationRoute({
        enabled: true,
        providerName: "openrouter",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "DISCOVERY_MODEL_REQUIRED",
    });
    expect(resolveDiscoveryInterpretationRoute({ enabled: false })).toEqual({
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    });
  });

  it("fails closed for unknown free models and missing spend or receipt wiring", () => {
    const catalogNow = new Date("2026-09-20T22:12:00.000Z");
    const proof = JSON.stringify({
      model: "nex-agi/nex-n2.5-pro:free",
      prompt: "0",
      completion: "0",
      verifiedAt: "2026-09-20T22:10:53.025Z",
      source: "openrouter_provider_catalog_and_runtime_probe",
      endpoint: "Nex AGI | nex-agi/nex-n2.5-pro-20260907:free",
      provider: "Nex AGI",
      runtimeRequestId: "gen-proof",
      actualCost: 0,
    });
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    expect(
      verifyDiscoveryZeroPriceRoute("nex-agi/nex-n2.5-pro:free", proof, catalogNow),
    ).toEqual({ ok: true });
    expect(
      verifyDiscoveryZeroPriceRoute("vendor/unknown:free", proof, catalogNow),
    ).toEqual({ ok: false, reason: "DISCOVERY_PAID_ROUTE_REFUSED" });
    expect(
      verifyDiscoveryZeroPriceRoute(
        "nex-agi/nex-n2.5-pro:free",
        JSON.stringify({
          model: "nex-agi/nex-n2.5-pro:free",
          prompt: "0",
          completion: "0",
          verifiedAt: "2026-09-17T00:00:00.000Z",
          source: "openrouter_provider_catalog_and_runtime_probe",
          endpoint: "Nex AGI | nex-agi/nex-n2.5-pro-20260907:free",
          provider: "Nex AGI",
          runtimeRequestId: "gen-proof",
          actualCost: 0,
        }),
        catalogNow,
      ),
    ).toEqual({ ok: false, reason: "DISCOVERY_PRICE_PROOF_STALE" });
    expect(
      resolveDiscoveryInterpretationRoute({
        enabled: true,
        model: "nex-agi/nex-n2.5-pro:free",
        providerName: "openrouter",
        proofJson: proof,
        monthlyCapAed: 0,
        now: catalogNow,
      }),
    ).toEqual({
      status: "unavailable",
      reason: "DISCOVERY_METERING_REQUIRED",
    });
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(
      resolveDiscoveryInterpretationRoute({
        enabled: true,
        model: "nex-agi/nex-n2.5-pro:free",
        providerName: "openrouter",
        proofJson: proof,
        monthlyCapAed: 100,
        now: catalogNow,
      }),
    ).toEqual({
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    });
  });

  it("pins the proved Nex upstream and requires observed zero cost", async () => {
    const model = "nex-agi/nex-n2.5-pro:free";
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    vi.stubEnv(
      "DISCOVERY_INTERPRETATION_PRICE_PROOF_JSON",
      JSON.stringify({
        model,
        prompt: "0",
        completion: "0",
        verifiedAt: new Date().toISOString(),
        source: "openrouter_provider_catalog_and_runtime_probe",
        endpoint: "Nex AGI | nex-agi/nex-n2.5-pro-20260907:free",
        provider: "Nex AGI",
        runtimeRequestId: "gen-proof",
        actualCost: 0,
      }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gen-live",
            model,
            provider: "Nex AGI",
            usage: { prompt_tokens: 12, completion_tokens: 8, cost: 0 },
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gen-unpriced",
            model,
            provider: "Nex AGI",
            usage: { prompt_tokens: 12, completion_tokens: 8 },
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gen-cost-details",
            model,
            provider: "Nex AGI",
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              cost_details: { upstream_inference_cost: 0 },
            },
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const create = () =>
      createLiveDiscoveryInterpretationProvider({
        model,
        onCost: vi.fn(),
        getMonthlySpendAed: async () => 0,
        monthlyCapAed: 100,
      });
    await expect(
      create().generate({ messages: [{ role: "user", content: "public excerpt" }] }),
    ).resolves.toMatchObject({
      model,
      upstreamProvider: "Nex AGI",
      providerCostUsd: 0,
    });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body).toMatchObject({
      model,
      max_tokens: 400,
      provider: {
        order: ["Nex AGI"],
        allow_fallbacks: false,
        max_price: { prompt: 0, completion: 0, request: 0 },
      },
    });
    await expect(
      create().generate({ messages: [{ role: "user", content: "public excerpt" }] }),
    ).rejects.toThrow("DISCOVERY_FREE_ROUTE_RUNTIME_PROOF_FAILED");
    await expect(
      create().generate({ messages: [{ role: "user", content: "public excerpt" }] }),
    ).resolves.toMatchObject({
      requestId: "gen-cost-details",
      providerCostUsd: 0,
    });

    const callsBeforeOversize = fetchMock.mock.calls.length;
    await expect(
      create().generate({
        messages: [
          {
            role: "user",
            content: "🚀".repeat(DISCOVERY_INTERPRETATION_MAX_INPUT_BYTES_PER_CALL),
          },
        ],
      }),
    ).rejects.toThrow("DISCOVERY_INTERPRETATION_INPUT_CEILING_REACHED");
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeOversize);
  });

  it("rethrows cost-receipt failure through interpretation and identity resolve", async () => {
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
      requestId: "or-receipt-1",
      inputTokens: 12,
      outputTokens: 4,
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
    await expect(
      interpretPublicDiscoveryExcerpt({
        excerpt: "Majid Al Futtaim opened a regional creative review in Dubai.",
        opportunityKind: "company_signal",
        evidenceId: "obs-receipt",
        provider,
      }),
    ).rejects.toThrow("DISCOVERY_COST_RECEIPT_UNAVAILABLE");
    await expect(
      resolvePublicDiscoveryCompanyIdentity({
        excerpt: "Majid Al Futtaim opened a regional creative review in Dubai.",
        provider,
      }),
    ).rejects.toThrow("DISCOVERY_COST_RECEIPT_UNAVAILABLE");
    expect(generate).toHaveBeenCalled();
  });
});
