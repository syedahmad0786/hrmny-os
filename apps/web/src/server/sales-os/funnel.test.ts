process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import {
  createCompany,
  createDeal,
  createNote,
  updateDeal,
} from "../crm/repository";
import {
  insertOutreach,
  patchOutreach,
  resetLeadgenStore,
} from "../leadgen/store";
import { getSalesFunnel } from "./funnel";
import { recordEmailEvent, resetSalesOsStore } from "./store";

describe("sales funnel", () => {
  beforeEach(() => {
    resetCrmMemory();
    resetLeadgenStore();
    resetSalesOsStore();
  });

  it("builds a filterable evidence funnel without treating acceptance as delivery", async () => {
    const company = await createCompany({ name: "Gulf Co", market: "KSA" });
    const deal = await createDeal({
      companyName: company.name,
      companyId: company.companyId,
      leadSourceLane: "apollo_search",
    });
    await createNote({
      dealId: deal.dealId,
      body: "SALES KNOWLEDGE BRIEF — Gulf Co\nVerified signal.",
    });
    const outreach = await insertOutreach({
      dealId: deal.dealId,
      channel: "gmail",
      recipient: "person@gulf.ae",
      body: "Approved message",
    });
    await patchOutreach(outreach.id, {
      state: "sent",
      sentAt: new Date().toISOString(),
    });
    await recordEmailEvent({
      outreachItemId: outreach.id,
      kind: "sent",
      externalId: "gmail-accepted-1",
      payload: { providerAccepted: true },
    });
    await recordEmailEvent({
      outreachItemId: outreach.id,
      kind: "replied",
      externalId: "gmail-reply-1",
    });
    await updateDeal(deal.dealId, { closeOutcome: "won" });

    const syntheticCompany = await createCompany({
      name: "E2E Funnel Noise",
      market: "KSA",
    });
    const syntheticDeal = await createDeal({
      companyName: syntheticCompany.name,
      companyId: syntheticCompany.companyId,
      leadSourceLane: "apollo_search",
      ownerEmployeeId: "99999999-9999-4999-8999-999999999999",
    });
    const syntheticOutreach = await insertOutreach({
      dealId: syntheticDeal.dealId,
      channel: "synthetic_fixture_channel",
      recipient: "noise@example.com",
      body: "Synthetic message",
    });
    await patchOutreach(syntheticOutreach.id, {
      state: "sent",
      sentAt: new Date().toISOString(),
    });
    await recordEmailEvent({
      outreachItemId: syntheticOutreach.id,
      kind: "sent",
      externalId: "synthetic-accepted-1",
      payload: { providerAccepted: true },
    });
    await recordEmailEvent({
      outreachItemId: syntheticOutreach.id,
      kind: "bounced",
      externalId: "synthetic-bounce-1",
    });

    const funnel = await getSalesFunnel({
      market: "KSA",
      campaign: "apollo_search",
    });
    expect(funnel.total).toBe(1);
    expect(funnel.steps.map((step) => step.count)).toEqual([
      1, 1, 1, 1, 1, 1, 1,
    ]);
    expect(funnel.evidence).toMatchObject({
      providerAccepted: 1,
      bounced: 0,
    });
    expect(funnel.options.channels).not.toContain("synthetic_fixture_channel");
    expect(funnel.options.owners.map((item) => item.value)).not.toContain(
      syntheticDeal.ownerEmployeeId,
    );
    await expect(
      getSalesFunnel({ market: "UAE", campaign: "apollo_search" }),
    ).resolves.toMatchObject({ total: 0 });
  });
});
