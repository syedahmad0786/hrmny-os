import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLeadSourceAdapter,
  createLeadSourceLive,
  createLeadSourceMock,
  mapApolloLeadPerson,
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
      mapApolloLeadPerson({
        id: "person-1",
        first_name: "Elena",
        last_name_obfuscated: "Mo***s",
        title: "Marketing Director",
        organization: { name: "Northwind Systems" },
      }),
    ).toMatchObject({
      externalId: "person-1",
      fullName: "Elena Mo***s",
      title: "Marketing Director",
      companyName: "Northwind Systems",
      source: "apollo",
    });
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
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.apollo.io/api/v1/people/match",
    );
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
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
});
