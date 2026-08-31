import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApolloProviderRequestError,
  createLeadSourceAdapter,
  createLeadSourceLive,
  createLeadSourceMock,
  mapApolloSearchPerson,
} from "./leadsource";

describe("LeadSourceAdapter (Apollo-shaped)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("mock search is deterministic — same criteria, same externalIds", async () => {
    const src = createLeadSourceMock();
    const a = await src.searchLeads({
      query: "Fintech Dubai",
      titles: ["CMO", "CEO"],
    });
    const b = await src.searchLeads({
      query: "Fintech Dubai",
      titles: ["CMO", "CEO"],
    });
    expect(a).toHaveLength(2);
    expect(a.map((c) => c.externalId)).toEqual(b.map((c) => c.externalId));
    expect(a[0]!.source).toBe("apollo_mock");
    expect(a[0]!.email).toContain("@");
  });

  it("mock enrich returns null for a non-email", async () => {
    const src = createLeadSourceMock();
    expect(await src.enrichLead("not-an-email")).toBeNull();
    expect((await src.enrichLead("cmo@acme.example"))?.email).toBe(
      "cmo@acme.example",
    );
    expect(
      (await src.enrichLead({ externalId: "person-1", fullName: "Mina Lead" }))
        ?.externalId,
    ).toBe("person-1");
  });

  it("factory defaults to mock without APOLLO_MODE=live", () => {
    expect(createLeadSourceAdapter().mode).toBe("mock");
  });

  it("maps Apollo's documented search identity without de-obfuscating it", () => {
    expect(
      mapApolloSearchPerson({
        id: "person-1",
        first_name: "Elena",
        last_name_obfuscated: "Mo***s",
        last_name: "Morris",
        name: "Elena Morris",
        title: "Marketing Director",
        email: "must-not-cross-search-boundary@example.com",
        email_status: "verified",
        linkedin_url: "https://linkedin.example/in/elena",
        phone_numbers: [{ raw_number: "+971000000000" }],
        organization: {
          name: "Northwind Systems",
          primary_domain: "northwind.example",
          confidential: "must-not-persist",
        },
      }),
    ).toMatchObject({
      externalId: "person-1",
      fullName: "Elena Mo***s",
      title: "Marketing Director",
      companyName: "Northwind Systems",
      source: "apollo",
      raw: {},
    });
    const mapped = mapApolloSearchPerson({
      id: "person-1",
      first_name: "Elena",
      last_name_obfuscated: "Mo***s",
      email: "must-not-persist@example.com",
      linkedin_url: "https://linkedin.example/in/elena",
    });
    expect(mapped).not.toHaveProperty("email");
    expect(mapped).not.toHaveProperty("emailStatus");
    expect(mapped).not.toHaveProperty("linkedinUrl");
  });

  it("a connected key does not activate live mode", () => {
    vi.stubEnv("APOLLO_API_KEY", "connected-not-activated");
    vi.stubEnv("APOLLO_MODE", "");
    expect(createLeadSourceAdapter().mode).toBe("mock");
  });

  it("live fails loud without an API key", () => {
    const prev = process.env.APOLLO_API_KEY;
    delete process.env.APOLLO_API_KEY;
    try {
      expect(() => createLeadSourceLive({})).toThrowError(
        /APOLLO_API_KEY missing/,
      );
    } finally {
      if (prev !== undefined) process.env.APOLLO_API_KEY = prev;
    }
  });

  it("uses Apollo's current official people search and enrichment paths", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ people: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ person: null }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const source = createLeadSourceLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: true,
    });
    await source.searchLeads({ query: "UAE creative" });
    await source.enrichLead({
      externalId: "person-1",
      fullName: "Mina Lead",
      companyName: "Example",
      companyDomain: "example.com",
      linkedinUrl: "https://linkedin.com/in/mina-lead",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.apollo.io/api/v1/mixed_people/api_search",
    );
    const searchRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(searchRequest.redirect).toBe("error");
    expect(JSON.parse(String(searchRequest.body))).toEqual({
      q_keywords: "UAE creative",
      page: 1,
      per_page: 25,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.apollo.io/api/v1/people/match",
    );
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(request.redirect).toBe("error");
    expect(JSON.parse(String(request.body))).toEqual({
      id: "person-1",
      name: "Mina Lead",
      organization_name: "Example",
      domain: "example.com",
      linkedin_url: "https://linkedin.com/in/mina-lead",
      reveal_personal_emails: false,
      reveal_phone_number: false,
      run_waterfall_email: false,
      run_waterfall_phone: false,
    });
  });

  it("maps explicit title and location fields to Apollo's documented filters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ people: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const source = createLeadSourceLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });

    await source.searchLeads({
      titles: ["Marketing Director"],
      locations: ["United Arab Emirates"],
      page: 1,
      perPage: 8,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      person_titles: ["Marketing Director"],
      include_similar_titles: true,
      person_locations: ["United Arab Emirates"],
      page: 1,
      per_page: 8,
    });
  });

  it("fails loud instead of inventing an undocumented Apollo industry field", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const source = createLeadSourceLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });

    await expect(
      source.searchLeads({ industries: ["hospitality"] }),
    ).rejects.toThrow(/does not document a direct industry parameter/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows zero-credit people search but gates paid enrichment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ people: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const source = createLeadSourceLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });
    await expect(source.searchLeads({ query: "UAE" })).resolves.toEqual([]);
    await expect(source.enrichLead("person@example.com")).rejects.toThrow(
      /APOLLO_ALLOW_PAID_OPERATIONS=true/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("captures Apollo's documented rate-limit headers without raw payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ people: [{ id: "person-2" }] }), {
        status: 200,
        headers: {
          "x-rate-limit-minute": "50",
          "x-minute-usage": "1",
          "x-minute-requests-left": "49",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const source = createLeadSourceLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });

    const result = await source.searchLeadsWithReceipt!({ query: "UAE" });

    expect(result).toMatchObject({
      candidates: [{ externalId: "person-2" }],
      providerReceipt: {
        provider: "apollo",
        operation: "people.search",
        httpStatus: 200,
        rateLimit: {
          minuteLimit: 50,
          minuteUsed: 1,
          minuteRemaining: 49,
        },
      },
    });
    expect(result.providerReceipt.responseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.providerReceipt).not.toHaveProperty("rawBody");
  });

  it("never returns more identities than the requested page bound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            people: [{ id: "person-allowed" }, { id: "person-excess" }],
          }),
          { status: 200 },
        ),
      ),
    );
    const source = createLeadSourceLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });

    await expect(
      source.searchLeadsWithReceipt!({ query: "UAE", perPage: 1 }),
    ).resolves.toMatchObject({
      candidates: [{ externalId: "person-allowed" }],
    });
  });

  it("classifies 429 with Retry-After for bounded durable retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "23" },
        }),
      ),
    );
    const source = createLeadSourceLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });

    const error = await source.searchLeadsWithReceipt!({ query: "UAE" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApolloProviderRequestError);
    if (!(error instanceof ApolloProviderRequestError)) {
      throw new Error("expected ApolloProviderRequestError");
    }
    expect(error).toMatchObject({
      httpStatus: 429,
      retryable: true,
      retryAfterSeconds: 23,
      providerReceipt: {
        provider: "apollo",
        httpStatus: 429,
        rateLimit: { retryAfterSeconds: 23 },
      },
    });
    expect(error.providerReceipt?.responseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(String(error)).not.toContain("rate limited");
  });

  it("dead-letters a malformed successful people collection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ people: { id: "not-an-array" } }), {
          status: 200,
        }),
      ),
    );
    const source = createLeadSourceLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });

    const error = await source.searchLeadsWithReceipt!({ query: "UAE" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      httpStatus: 200,
      retryable: false,
      providerReceipt: { provider: "apollo", httpStatus: 200 },
    });
    expect(String(error)).not.toContain("not-an-array");
  });

  it("dead-letters a successful response with no people collection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ pagination: { total_entries: 0 } }), {
          status: 200,
        }),
      ),
    );
    const source = createLeadSourceLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });

    const error = await source.searchLeadsWithReceipt!({ query: "UAE" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      httpStatus: 200,
      retryable: false,
      providerReceipt: { provider: "apollo", httpStatus: 200 },
    });
    expect(String(error)).not.toContain("pagination");
  });
});
