import { describe, expect, it } from "vitest";
import {
  createLeadSourceAdapter,
  createLeadSourceLive,
  createLeadSourceMock,
} from "./leadsource";

describe("LeadSourceAdapter (Apollo-shaped)", () => {
  it("mock search is deterministic — same criteria, same externalIds", async () => {
    const src = createLeadSourceMock();
    const a = await src.searchLeads({ query: "Fintech Dubai", titles: ["CMO", "CEO"] });
    const b = await src.searchLeads({ query: "Fintech Dubai", titles: ["CMO", "CEO"] });
    expect(a).toHaveLength(2);
    expect(a.map((c) => c.externalId)).toEqual(b.map((c) => c.externalId));
    expect(a[0]!.source).toBe("apollo_mock");
    expect(a[0]!.email).toContain("@");
  });

  it("mock enrich returns null for a non-email", async () => {
    const src = createLeadSourceMock();
    expect(await src.enrichLead("not-an-email")).toBeNull();
    expect((await src.enrichLead("cmo@acme.example"))?.email).toBe("cmo@acme.example");
  });

  it("factory defaults to mock without APOLLO_MODE=live", () => {
    expect(createLeadSourceAdapter().mode).toBe("mock");
  });

  it("live fails loud without an API key", () => {
    const prev = process.env.APOLLO_API_KEY;
    delete process.env.APOLLO_API_KEY;
    try {
      expect(() => createLeadSourceLive({})).toThrowError(/APOLLO_API_KEY missing/);
    } finally {
      if (prev !== undefined) process.env.APOLLO_API_KEY = prev;
    }
  });
});
