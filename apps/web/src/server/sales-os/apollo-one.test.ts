process.env.DATABASE_URL = "";

import type { LeadSourceAdapter } from "@hrmny/integrations";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import { listCompanies, listContacts, listDeals } from "../crm/repository";
import { resetIntegrationReceiptMemory } from "../integrations/inbox";
import {
  enrichOneApolloPerson,
  getApolloOnePersonCanaryStatus,
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
