process.env.DATABASE_URL = "";

import type { LeadSourceAdapter } from "@hrmny/integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import { listCompanies, listContacts, listDeals } from "../crm/repository";
import { resetIntegrationReceiptMemory } from "../integrations/inbox";
import {
  APOLLO_PAID_APPROVAL_ACTION,
  enrichOneApolloPerson,
  getApolloOnePersonCanaryStatus,
  type ApolloConsumedApprovalReceipt,
  type ApolloExactApprovalClaim,
} from "./apollo-one";
import {
  runScheduledApolloPeopleSearch,
  searchApolloPeopleFree,
  type ApolloPeopleSearchRetryPayload,
} from "./apollo-search";
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

const PAID_ACTOR = "20000000-0000-4000-8000-000000000009";
const PAID_APPROVAL = "43000000-0000-4000-8000-000000000001";
const PAID_NOW = new Date("2026-08-31T12:00:00.000Z");

function exactApproval() {
  return vi.fn(async (
    claim: ApolloExactApprovalClaim,
  ): Promise<ApolloConsumedApprovalReceipt> => ({
    ...claim,
    action: APOLLO_PAID_APPROVAL_ACTION,
    approvedAt: new Date(PAID_NOW.getTime() - 1_000).toISOString(),
    expiresAt: new Date(PAID_NOW.getTime() + 60_000).toISOString(),
    status: "consumed" as const,
  }));
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
    const actorEmployeeId = "20000000-0000-4000-8000-000000000001";
    let queued: ApolloPeopleSearchRetryPayload | undefined;
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

    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "10000000-0000-4000-8000-000000000001",
        titles: ["Marketing Director"],
        actorEmployeeId,
      },
      {
        scheduleRetry: async (payload, runAt) => {
          queued = payload;
          return { jobId: "job-live", nextAttemptAt: runAt.toISOString() };
        },
      },
    );
    expect(pending.status).toBe("retry_scheduled");
    const result = await runScheduledApolloPeopleSearch(queued!, {
      authorizeActor: vi.fn(async () => true),
      resolveApiKey: vi.fn(async (toolkit, employeeId) => {
        expect(toolkit).toBe("apollo");
        expect(employeeId).toBe(actorEmployeeId);
        return { apiKey: "vault-test-key", source: "vault" as const };
      }),
    });

    expect(result.mode).toBe("live");
    expect(result).toMatchObject({
      status: "completed",
      duplicate: false,
      attempts: 1,
    });
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
    const actorEmployeeId = "20000000-0000-4000-8000-000000000002";
    let queued: ApolloPeopleSearchRetryPayload | undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await searchApolloPeopleFree(
      {
        idempotencyKey: "10000000-0000-4000-8000-000000000002",
        titles: ["Marketing Director"],
        actorEmployeeId,
      },
      {
        scheduleRetry: async (payload, runAt) => {
          queued = payload;
          return { jobId: "job-missing", nextAttemptAt: runAt.toISOString() };
        },
      },
    );
    await expect(
      runScheduledApolloPeopleSearch(queued!, {
        authorizeActor: vi.fn(async () => true),
        resolveApiKey: vi.fn(async () => ({
          apiKey: null,
          source: "none" as const,
        })),
      }),
    ).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_FREE_SEARCH_CONNECTION_REQUIRED",
    });
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
        actorEmployeeId: PAID_ACTOR,
        approvalReceiptId: PAID_APPROVAL,
      },
      {
        now: () => PAID_NOW,
        consumeExactApproval: exactApproval(),
        resolveApiKey: vi.fn(async (toolkit, employeeId) => {
          expect(toolkit).toBe("apollo");
          expect(employeeId).toBe(PAID_ACTOR);
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
      actorEmployeeId: PAID_ACTOR,
      approvalReceiptId: PAID_APPROVAL,
    };

    const approval = exactApproval();
    const deps = {
      leadSource: source,
      now: () => PAID_NOW,
      consumeExactApproval: approval,
    };
    const first = await enrichOneApolloPerson(input, deps);
    const replay = await enrichOneApolloPerson(input, deps);

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
        actorEmployeeId: PAID_ACTOR,
        approvalReceiptId: PAID_APPROVAL,
      },
      {
        leadSource: source,
        now: () => PAID_NOW,
        consumeExactApproval: exactApproval(),
      },
    );
    await expect(
      enrichOneApolloPerson(
        {
          candidate: { externalId: "apollo-person-2", fullName: "Other Lead" },
          confirmCreditUse: true,
          actorEmployeeId: PAID_ACTOR,
          approvalReceiptId: PAID_APPROVAL,
        },
        {
          leadSource: source,
          now: () => PAID_NOW,
          consumeExactApproval: exactApproval(),
        },
      ),
    ).rejects.toThrow(/PAYLOAD_MISMATCH/);
    expect(source.enrichLead).toHaveBeenCalledTimes(1);
  });

  it("keeps paid People Match dormant without a fresh exact receipt verifier", async () => {
    const source = liveStub();
    await expect(
      enrichOneApolloPerson(
        {
          candidate: { externalId: "apollo-person-locked" },
          confirmCreditUse: true,
          actorEmployeeId: PAID_ACTOR,
          approvalReceiptId: PAID_APPROVAL,
        },
        { leadSource: source },
      ),
    ).rejects.toThrow(/EXACT_APPROVAL_RECEIPT/);
    expect(source.enrichLead).not.toHaveBeenCalled();
  });

  it("rejects a stale or candidate-mismatched paid approval before Apollo", async () => {
    const source = liveStub();
    await expect(
      enrichOneApolloPerson(
        {
          candidate: { externalId: "apollo-person-stale" },
          confirmCreditUse: true,
          actorEmployeeId: PAID_ACTOR,
          approvalReceiptId: PAID_APPROVAL,
        },
        {
          leadSource: source,
          now: () => PAID_NOW,
          consumeExactApproval: async (claim) => ({
            ...claim,
            candidateHash: "wrong-candidate",
            approvedAt: new Date(PAID_NOW.getTime() - 10 * 60_000).toISOString(),
            expiresAt: new Date(PAID_NOW.getTime() + 60_000).toISOString(),
            status: "consumed",
          }),
        },
      ),
    ).rejects.toThrow(/INVALID_OR_STALE/);
    expect(source.enrichLead).not.toHaveBeenCalled();
  });
});
