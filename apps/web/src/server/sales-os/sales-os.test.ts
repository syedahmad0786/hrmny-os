process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import { createDeal, getDeal } from "../crm/repository";
import { qualifyCompany, matchesNoGo } from "./qualify";
import { DEFAULT_SALES_OS_SETTINGS, sectorForDate, contactsForTemperature } from "./sops";
import {
  assertEmailSendAllowed,
  assertLinkedInAssistAllowed,
  buildComplianceFooter,
  ensureFooter,
  FOOTER_MARKER,
  weekKey,
} from "./compliance";
import { runDailyResearch } from "./research";
import { decideCompany, decideContact } from "./gates";
import { enrichApprovedCompany } from "./enrich";
import { draftChannelsForApprovedContact, failsSpecificityTest } from "./drafts";
import { buildSalesOsDigest } from "./digest";
import { applySalesOsReplyIntent } from "./replies";
import { parseIntentCsv, processIntentLeads } from "./intent-csv";
import { proposeEvolve, applyEvolve } from "./evolve";
import { flagStaleEmails } from "./stale";
import {
  addCredit,
  addSuppression,
  getSalesOsSettings,
  resetSalesOsStore,
  saveSalesOsSettings,
} from "./store";
import { resetLeadgenStore, insertOutreach, listOutreach } from "../leadgen/store";

async function resetAll() {
  resetCrmMemory();
  resetSalesOsStore();
  resetLeadgenStore();
}

describe("Sales OS SOPs + qualification", () => {
  it("rotates sectors by weekday", () => {
    expect(sectorForDate(DEFAULT_SALES_OS_SETTINGS, new Date("2026-08-24T08:00:00Z"))).toBe(
      "retail",
    ); // Monday
    expect(sectorForDate(DEFAULT_SALES_OS_SETTINGS, new Date("2026-08-25T08:00:00Z"))).toBe(
      "sports",
    );
    expect(contactsForTemperature("hot")).toBe(3);
    expect(contactsForTemperature("cool")).toBe(0);
  });

  it("rejects no-go industries", () => {
    expect(matchesNoGo({ name: "Cool Crypto Labs", whyThis: "web3 launch" })).toBe(
      "Crypto / Web3",
    );
    const ok = qualifyCompany({
      name: "On Running",
      sector: "Retail",
      whyThis: "Dubai Mall flagship launch and hiring Head of Marketing MENA",
      employeesGlobal: 2000,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.buaf.temperature).not.toBe("cold");
  });
});

describe("compliance", () => {
  beforeEach(resetAll);

  it("appends identity + unsubscribe footer once", () => {
    const body = ensureFooter("Hello there");
    expect(body).toContain(FOOTER_MARKER);
    expect(body).toContain("unsubscribe");
    expect(ensureFooter(body)).toBe(body);
    expect(buildComplianceFooter().split("\n").length).toBeGreaterThan(3);
  });

  it("blocks send to suppressed addresses and honors the daily cap", async () => {
    await addSuppression({ email: "stop@brand.com", reason: "unsubscribe" });
    const blocked = await assertEmailSendAllowed({ email: "stop@brand.com" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("SUPPRESSED");

    await saveSalesOsSettings({
      ...(await getSalesOsSettings()),
      caps: { ...(await getSalesOsSettings()).caps, emailPerDay: 1 },
    });
    const now = new Date();
    await insertOutreach({
      dealId: "00000000-0000-4000-8000-000000000099",
      channel: "gmail",
      recipient: "ok@brand.com",
      body: "x",
    }).then((item) =>
      import("../leadgen/store").then(({ patchOutreach }) =>
        patchOutreach(item.id, { state: "sent", sentAt: now.toISOString() }),
      ),
    );
    const capped = await assertEmailSendAllowed({ email: "fresh@brand.com", now });
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.code).toBe("DAILY_CAP");
  });

  it("blocks LinkedIn assists after the weekly cap", async () => {
    await saveSalesOsSettings({
      ...(await getSalesOsSettings()),
      caps: { ...(await getSalesOsSettings()).caps, linkedinConnectsPerWeek: 1 },
    });
    await addCredit("linkedin_assist", 1, weekKey());
    const blocked = await assertLinkedInAssistAllowed();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("WEEKLY_CAP");
  });
});

describe("research → enrich → draft gates", () => {
  beforeEach(resetAll);

  it("runs sector research, gates company/contact, and drafts channels", async () => {
    const run = await runDailyResearch({
      sector: "automotive",
      date: new Date("2026-08-26T08:00:00Z"),
    });
    expect(run.sector).toBe("automotive");
    expect(run.created.length).toBeGreaterThan(0);
    const company = run.created[0]!;
    const approved = await decideCompany(company.id, "approve", { actorId: "emp-1" });
    expect(approved.approvalState).toBe("approved");

    const enrich = await enrichApprovedCompany(company.id);
    expect(enrich.created.length).toBeGreaterThan(0);
    const contact = enrich.created[0]!;
    const gated = await decideContact(contact.id, "approve");
    expect(gated.approvalState).toBe("approved");
    expect(gated.dealId).toBeTruthy();

    const drafts = await draftChannelsForApprovedContact(gated.id);
    expect(drafts.created.some((d) => d.channel === "linkedin_connect")).toBe(true);
    expect(drafts.created.some((d) => d.channel === "linkedin_followup")).toBe(true);
    const email = drafts.created.find((d) => d.channel === "gmail");
    if (email) expect(email.body).toContain(FOOTER_MARKER);
  });

  it("fails the specificity test when the company name is missing", () => {
    expect(failsSpecificityTest("Great work on the launch.", "Lucid Motors")).toBe(true);
    expect(
      failsSpecificityTest("Loved Lucid Motors opening in Dubai.", "Lucid Motors"),
    ).toBe(false);
  });
});

describe("digest, replies, intent CSV, evolve, stale", () => {
  beforeEach(resetAll);

  it("builds a coverage digest and flags stalls", async () => {
    await runDailyResearch({ sector: "retail" });
    const digest = await buildSalesOsDigest();
    expect(digest.researchedWaiting).toBeGreaterThan(0);
    expect(digest.coverage.targetX).toBe(3);
  });

  it("suppresses and closes a deal on unsubscribe", async () => {
    const deal = await createDeal({
      companyName: "Unsubscribe Co",
      leadSourceLane: "industry_scanning",
    });
    const res = await applySalesOsReplyIntent({
      dealId: deal.dealId,
      intent: "unsubscribe",
      email: "leave@brand.com",
    });
    expect(res.suppressed).toBe(true);
    expect(res.dealClosed).toBe(true);
    const updated = await getDeal(deal.dealId);
    expect(updated?.closeOutcome).toBe("lost");
    expect(updated?.lostReason).toBe("unsubscribe");
    const allowed = await assertEmailSendAllowed({ email: "leave@brand.com" });
    expect(allowed.ok).toBe(false);
  });

  it("parses Apollo intent CSV and skips no-go rows", async () => {
    const parsed = parseIntentCsv(
      "company,domain,intent,employees\nOn Running,on.com,marketing,2000\nCrypto Casino,bad.io,ads,12",
    );
    expect(parsed).toHaveLength(2);
    const out = await processIntentLeads(
      "company,domain,intent,employees\nOn Running,on.com,marketing,2000\nCrypto Casino,bad.io,ads,12",
    );
    expect(out.created.length).toBeGreaterThan(0);
    expect(out.skipped.some((s) => s.company.includes("Crypto"))).toBe(true);
  });

  it("proposes and applies an evolve diff", async () => {
    const proposal = await proposeEvolve("test");
    expect(proposal.id).toBeTruthy();
    const next = await applyEvolve(proposal.id);
    expect(next.caps.emailPerDay).toBeGreaterThan(0);
  });

  it("flags 7-day stale emails", async () => {
    const item = await insertOutreach({
      dealId: "00000000-0000-4000-8000-000000000088",
      channel: "gmail",
      recipient: "old@brand.com",
      body: "hi",
    });
    const { patchOutreach } = await import("../leadgen/store");
    await patchOutreach(item.id, {
      state: "sent",
      sentAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });
    expect(await flagStaleEmails()).toBe(1);
    expect((await listOutreach())[0]?.reworkFeedback).toBe("no_response");
  });
});
