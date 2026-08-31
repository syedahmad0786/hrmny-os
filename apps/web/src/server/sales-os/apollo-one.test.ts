process.env.DATABASE_URL = "";

import type { LeadSourceAdapter } from "@hrmny/integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import { listCompanies, listContacts, listDeals } from "../crm/repository";
import { resetIntegrationReceiptMemory } from "../integrations/inbox";
import {
  enrichOneApolloPerson,
  getApolloOnePersonCanaryStatus,
  searchApolloPeopleFree,
} from "./apollo-one";
import { creditUsed, resetSalesOsStore } from "./store";

function liveStub(): LeadSourceAdapter {
  return {
    mode: "live",
    searchLeads: vi.fn(async () => []),
    enrichLead: vi.fn(async (identity) => {
      const input =
        typeof identity === "string" ? { email: identity } : identity;
      return {
        externalId: input.externalId ?? "apollo-person-1",
        fullName: input.fullName ?? "Mina Lead",
        title: "Marketing Director",
        email: "mina@acme.example",
        emailStatus: "verified",
        companyName: input.companyName ?? "Acme UAE",
        companyDomain: input.companyDomain ?? "acme.example",
        linkedinUrl: input.linkedinUrl,
        source: "apollo",
        raw: {},
      };
    }),
  };
}

describe("Apollo one-person connection canary", () => {
  beforeEach(() => {
    resetCrmMemory();
    resetSalesOsStore();
    resetIntegrationReceiptMemory();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the staff vault bridge for zero-credit live People Search", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            people: [
              {
                id: "apollo-live-person-1",
                name: "Live Person",
                title: "Marketing Director",
                organization: {
                  name: "Live Company",
                  primary_domain: "live.example",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchApolloPeopleFree(
      {
        titles: ["Marketing Director"],
        actorEmployeeId: "employee-1",
      },
      {
        resolveApiKey: vi.fn(async (toolkit, employeeId) => {
          expect(toolkit).toBe("apollo");
          expect(employeeId).toBe("employee-1");
          return { apiKey: "vault-test-key", source: "vault" as const };
        }),
      },
    );

    expect(result.mode).toBe("live");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      externalId: "apollo-live-person-1",
      companyName: "Live Company",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.apollo.io/api/v1/mixed_people/api_search",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "X-Api-Key": "vault-test-key" }),
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      person_titles: ["Marketing Director"],
      include_similar_titles: true,
      person_locations: ["United Arab Emirates"],
    });
  });

  it("fails closed instead of returning synthetic people when Apollo is absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchApolloPeopleFree(
        { titles: ["Marketing Director"], actorEmployeeId: "employee-1" },
        {
          resolveApiKey: vi.fn(async () => ({
            apiKey: null,
            source: "none" as const,
          })),
        },
      ),
    ).rejects.toThrow(/APOLLO_FREE_SEARCH_CONNECTION_REQUIRED/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the same staff vault bridge for the bounded People Match canary", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            person: {
              id: "apollo-live-person-2",
              name: "Canary Person",
              title: "Marketing Director",
              email: "canary@live.example",
              email_status: "verified",
              organization: {
                name: "Live Company",
                primary_domain: "live.example",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichOneApolloPerson(
      {
        candidate: {
          externalId: "apollo-live-person-2",
          fullName: "Canary Person",
          companyName: "Live Company",
          companyDomain: "live.example",
        },
        confirmCreditUse: true,
        actorEmployeeId: "employee-2",
      },
      {
        resolveApiKey: vi.fn(async (toolkit, employeeId) => {
          expect(toolkit).toBe("apollo");
          expect(employeeId).toBe("employee-2");
          return { apiKey: "vault-test-key", source: "vault" as const };
        }),
      },
    );

    expect(result).toMatchObject({
      mode: "live",
      matched: true,
      imported: true,
      creditsRecorded: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.apollo.io/api/v1/people/match",
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      id: "apollo-live-person-2",
      reveal_personal_emails: false,
      reveal_phone_number: false,
      run_waterfall_email: false,
      run_waterfall_phone: false,
    });
  });

  it("uses one call, records one conservative credit, and reconciles CRM", async () => {
    const source = liveStub();
    const input = {
      candidate: {
        externalId: "apollo-person-1",
        fullName: "Mina Lead",
        companyName: "Acme UAE",
        companyDomain: "acme.example",
      },
      confirmCreditUse: true as const,
    };

    const first = await enrichOneApolloPerson(input, { leadSource: source });
    const replay = await enrichOneApolloPerson(input, { leadSource: source });

    expect(first).toMatchObject({
      mode: "live",
      matched: true,
      imported: true,
      creditsRecorded: 1,
      duplicate: false,
    });
    expect(replay).toMatchObject({
      receiptId: first.receiptId,
      duplicate: true,
      imported: true,
    });
    expect(source.enrichLead).toHaveBeenCalledTimes(1);
    expect(await creditUsed("apollo_contact")).toBe(1);
    expect((await listCompanies()).some((row) => row.name === "Acme UAE")).toBe(
      true,
    );
    expect(
      (await listContacts()).some((row) => row.email === "mina@acme.example"),
    ).toBe(true);
    expect(
      (await listDeals()).some((row) => row.companyName === "Acme UAE"),
    ).toBe(true);
    expect(await getApolloOnePersonCanaryStatus()).toMatchObject({
      available: false,
      status: "completed",
    });
  });

  it("locks the one-shot allowance to the first exact candidate", async () => {
    const source = liveStub();
    await enrichOneApolloPerson(
      {
        candidate: { externalId: "apollo-person-1", fullName: "Mina Lead" },
        confirmCreditUse: true,
      },
      { leadSource: source },
    );
    await expect(
      enrichOneApolloPerson(
        {
          candidate: { externalId: "apollo-person-2", fullName: "Other Lead" },
          confirmCreditUse: true,
        },
        { leadSource: source },
      ),
    ).rejects.toThrow(/PAYLOAD_MISMATCH/);
    expect(source.enrichLead).toHaveBeenCalledTimes(1);
  });
});
