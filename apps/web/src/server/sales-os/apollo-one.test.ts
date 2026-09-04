process.env.DATABASE_URL = "";

import type { LeadSourceAdapter } from "@hrmny/integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import {
  getDeal,
  listCompanies,
  listContacts,
  listDeals,
} from "../crm/repository";
import { importApolloPersonToCrm } from "../crm/apollo-import";
import {
  recordIntegrationReceipt,
  resetIntegrationReceiptMemory,
} from "../integrations/inbox";
import {
  APOLLO_PAID_APPROVAL_ACTION,
  apolloExactCandidateHash,
  approveApolloExactPerson,
  consumeApolloExactApproval,
  enrichOneApolloPerson,
  getApolloOnePersonCanaryStatus,
  type ApolloConsumedApprovalReceipt,
  type ApolloExactApprovalClaim,
} from "./apollo-one";
import {
  runScheduledApolloPeopleSearchForTest,
  searchApolloPeopleFree,
  type ApolloPeopleSearchRetryPayload,
} from "./apollo-search";

const runScheduledApolloPeopleSearch = runScheduledApolloPeopleSearchForTest;
import {
  creditUsed,
  getSalesOsSettings,
  resetSalesOsStore,
  saveSalesOsSettings,
} from "./store";

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
  return vi.fn(
    async (
      claim: ApolloExactApprovalClaim,
    ): Promise<ApolloConsumedApprovalReceipt> => ({
      ...claim,
      action: APOLLO_PAID_APPROVAL_ACTION,
      approvedAt: new Date(PAID_NOW.getTime() - 1_000).toISOString(),
      expiresAt: new Date(PAID_NOW.getTime() + 60_000).toISOString(),
      status: "consumed" as const,
    }),
  );
}

describe("Apollo exact-person enrichment", () => {
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
      organization_locations: ["United Arab Emirates"],
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

  it("issues one actor-and-candidate-bound approval receipt and consumes it once", async () => {
    const candidate = {
      externalId: "apollo-approved-person",
      fullName: "Approved Person",
    };
    const approval = await approveApolloExactPerson({
      candidate,
      actorEmployeeId: PAID_ACTOR,
      now: PAID_NOW,
    });
    const claim = {
      approvalReceiptId: approval.approvalReceiptId,
      actorEmployeeId: PAID_ACTOR,
      candidateHash: apolloExactCandidateHash(candidate),
      action: APOLLO_PAID_APPROVAL_ACTION,
      requestedAt: PAID_NOW.toISOString(),
    } as const;

    await expect(
      consumeApolloExactApproval({
        ...claim,
        candidateHash: apolloExactCandidateHash({
          externalId: "another-person",
        }),
      }),
    ).rejects.toThrow(/INVALID_OR_USED/);
    await expect(consumeApolloExactApproval(claim)).resolves.toMatchObject({
      status: "consumed",
      actorEmployeeId: PAID_ACTOR,
      candidateHash: approval.candidateHash,
    });
    await expect(consumeApolloExactApproval(claim)).rejects.toThrow(
      /INVALID_OR_USED/,
    );
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
    expect(await creditUsed("apollo_contact", "2026-08")).toBe(1);
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
      status: "locked_exact_approval_required",
    });
  });

  it("upgrades the free-search contact instead of creating a duplicate", async () => {
    const externalId = "apollo-free-to-paid-1";
    const free = await importApolloPersonToCrm({
      person: {
        externalId,
        fullName: "Mina L.",
        title: "Marketing Director",
        companyName: "Upgrade Hospitality",
        companyDomain: "upgrade.example",
        source: "apollo",
        raw: { freeSearch: true },
      },
      receiptId: crypto.randomUUID(),
      ownerEmployeeId: PAID_ACTOR,
    });
    await recordIntegrationReceipt({
      provider: "apollo",
      externalEventId: `free-save:${PAID_ACTOR}:${externalId}`,
      operation: "people.search.save_candidate",
      rawBody: JSON.stringify({ employeeId: PAID_ACTOR, externalId }),
      completed: true,
      ownerEmployeeId: PAID_ACTOR,
      result: {
        dealId: free.dealId,
        companyId: free.companyId,
        contactId: free.contactId,
        companyName: free.companyName,
      },
    });
    const source = liveStub();
    source.enrichLead = vi.fn(async () => ({
      externalId,
      fullName: "Mina Lead",
      title: "Marketing Director",
      email: "mina@upgrade.example",
      emailStatus: "verified",
      companyName: "Upgrade Hospitality",
      companyDomain: "upgrade.example",
      source: "apollo",
      raw: {},
    }));

    const paid = await enrichOneApolloPerson(
      {
        candidate: {
          externalId,
          fullName: "Mina L.",
          companyName: "Upgrade Hospitality",
          companyDomain: "upgrade.example",
        },
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

    expect(paid.crm?.contactId).toBe(free.contactId);
    expect(await listContacts({ companyId: free.companyId })).toEqual([
      expect.objectContaining({
        contactId: free.contactId,
        firstName: "Mina",
        lastName: "Lead",
        email: "mina@upgrade.example",
        emailVerified: true,
      }),
    ]);
    expect((await getDeal(free.dealId))?.primaryContactId).toBe(free.contactId);
  });

  it("atomically enforces the monthly cap across different candidates", async () => {
    const settings = await getSalesOsSettings();
    await saveSalesOsSettings({
      ...settings,
      caps: { ...settings.caps, apolloContactsPerMonth: 1 },
    });
    const source = liveStub();
    const run = (externalId: string, approvalReceiptId: string) =>
      enrichOneApolloPerson(
        {
          candidate: { externalId, fullName: `Lead ${externalId}` },
          confirmCreditUse: true,
          actorEmployeeId: PAID_ACTOR,
          approvalReceiptId,
        },
        {
          leadSource: source,
          now: () => PAID_NOW,
          consumeExactApproval: exactApproval(),
        },
      );

    const outcomes = await Promise.allSettled([
      run("apollo-cap-a", "43000000-0000-4000-8000-000000000011"),
      run("apollo-cap-b", "43000000-0000-4000-8000-000000000012"),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.find((outcome) => outcome.status === "rejected"),
    ).toMatchObject({
      reason: expect.objectContaining({
        message: "APOLLO_MONTHLY_CAP_REACHED",
      }),
    });
    expect(source.enrichLead).toHaveBeenCalledTimes(1);
    expect(await creditUsed("apollo_contact", "2026-08")).toBe(1);
  });

  it("does not let one exact approval unlock a second candidate", async () => {
    const source = liveStub();
    const firstCandidate = {
      externalId: "apollo-person-1",
      fullName: "Mina Lead",
    };
    const approval = await approveApolloExactPerson({
      candidate: firstCandidate,
      actorEmployeeId: PAID_ACTOR,
      now: PAID_NOW,
    });
    await enrichOneApolloPerson(
      {
        candidate: firstCandidate,
        confirmCreditUse: true,
        actorEmployeeId: PAID_ACTOR,
        approvalReceiptId: approval.approvalReceiptId,
      },
      {
        leadSource: source,
        now: () => PAID_NOW,
        consumeExactApproval: consumeApolloExactApproval,
      },
    );
    await expect(
      enrichOneApolloPerson(
        {
          candidate: { externalId: "apollo-person-2", fullName: "Other Lead" },
          confirmCreditUse: true,
          actorEmployeeId: PAID_ACTOR,
          approvalReceiptId: approval.approvalReceiptId,
        },
        {
          leadSource: source,
          now: () => PAID_NOW,
          consumeExactApproval: consumeApolloExactApproval,
        },
      ),
    ).rejects.toThrow(/INVALID_OR_USED/);
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
            approvedAt: new Date(
              PAID_NOW.getTime() - 10 * 60_000,
            ).toISOString(),
            expiresAt: new Date(PAID_NOW.getTime() + 60_000).toISOString(),
            status: "consumed",
          }),
        },
      ),
    ).rejects.toThrow(/INVALID_OR_STALE/);
    expect(source.enrichLead).not.toHaveBeenCalled();
  });
});
