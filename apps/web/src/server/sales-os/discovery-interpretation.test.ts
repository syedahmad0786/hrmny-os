import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockProvider, type LLMProvider } from "@hrmny/ai";
import {
  discoveryInterpretationResultSchema,
  evaluateDiscoveryEvidence,
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
  afterEach(() => {
    vi.unstubAllEnvs();
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
    expect(empty).toEqual({ ok: false, reason: "COMPANY_IDENTITY_MISSING" });

    const ambiguous = await resolvePublicDiscoveryCompanyIdentity({
      excerpt:
        "Majid Al Futtaim and Emaar Properties opened competing reviews.",
      provider: createMockProvider(),
    });
    expect(ambiguous).toEqual({
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
    expect(fromHeadlineOnly).toEqual({
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
    expect(resolved).toEqual({ ok: true, name: "Majid Al Futtaim" });

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
    expect(malformed).toEqual({
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
    expect(resolved).toEqual({
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
      reason: "DISCOVERY_PRICE_PROOF_MISSING",
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
    const proof = JSON.stringify({
      model: "stealth/ox-alpha",
      prompt: 0,
      completion: 0,
      request: 0,
      verifiedAt: "2026-09-20T00:00:00.000Z",
      source: "openrouter_provider_catalog",
    });
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    expect(
      verifyDiscoveryZeroPriceRoute("stealth/ox-alpha", proof, now),
    ).toEqual({ ok: true });
    expect(
      verifyDiscoveryZeroPriceRoute("vendor/unknown:free", proof, now),
    ).toEqual({ ok: false, reason: "DISCOVERY_PAID_ROUTE_REFUSED" });
    expect(
      resolveDiscoveryInterpretationRoute({
        enabled: true,
        model: "stealth/ox-alpha",
        providerName: "openrouter",
        proofJson: proof,
        monthlyCapAed: 0,
        now,
      }),
    ).toEqual({
      status: "unavailable",
      reason: "DISCOVERY_METERING_REQUIRED",
    });
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(
      resolveDiscoveryInterpretationRoute({
        enabled: true,
        model: "stealth/ox-alpha",
        providerName: "openrouter",
        proofJson: proof,
        monthlyCapAed: 100,
        now,
      }),
    ).toEqual({
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    });
  });
});
