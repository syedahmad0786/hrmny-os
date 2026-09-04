process.env.DATABASE_URL = "";

import { createLeadSourceMock } from "@hrmny/integrations";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import {
  createDeal,
  getDeal,
  listCompanies,
  listContacts,
  listDeals,
  listNotes,
} from "../crm/repository";
import { getDemoStore } from "../demo-store";
import {
  resolveDevUser,
  sessionCanViewMargin,
  type SessionUser,
} from "../auth/session";
import { createCaller } from "../trpc/root";
import { qualifyCompany, matchesNoGo } from "./qualify";
import {
  DEFAULT_SALES_OS_SETTINGS,
  sectorForDate,
  contactsForTemperature,
} from "./sops";
import {
  assertEmailSendAllowed,
  assertLinkedInAssistAllowed,
  buildComplianceFooter,
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  ensureFooter,
  FOOTER_MARKER,
  hasValidUnsubscribeLink,
  weekKey,
} from "./compliance";
import { ingestManualResearch, type ResearchProposalInput } from "./research";
import { decideCompany, decideContact } from "./gates";
import { enrichApprovedCompany } from "./enrich";
import {
  draftChannelsForApprovedContact,
  failsSpecificityTest,
} from "./drafts";
import { buildSalesOsDigest } from "./digest";
import { applySalesOsReplyIntent } from "./replies";
import { parseIntentCsv, processIntentLeads } from "./intent-csv";
import { proposeEvolve, applyEvolve } from "./evolve";
import { flagStaleEmails } from "./stale";
import {
  addCredit,
  addSuppression,
  creditUsed,
  getSalesOsSettings,
  insertCompanyResearch,
  listCompanyResearch,
  listContactResearch,
  listEmailEvents,
  recordEmailEvent,
  listIntelSignals,
  resetSalesOsStore,
  saveSalesOsSettings,
} from "./store";
import {
  resetLeadgenStore,
  insertOutreach,
  listOutreach,
} from "../leadgen/store";
import { resetIntegrationReceiptMemory } from "../integrations/inbox";
import type { RunAgent } from "../leadgen/agent-run";

async function resetAll() {
  resetCrmMemory();
  resetSalesOsStore();
  resetLeadgenStore();
  resetIntegrationReceiptMemory();
  getDemoStore().audits = [];
}

async function proposeSignal(overrides: Partial<ResearchProposalInput> = {}) {
  return ingestManualResearch({
    requestId: crypto.randomUUID(),
    actorEmployeeId: "c0000000-0000-4000-8000-000000000002",
    name: "Northstar Retail Fixture",
    sector: "Retail",
    whyThis:
      "Synthetic Dubai flagship launch with a Head of Marketing hiring signal.",
    website: "https://northstar-retail.example",
    evidence: "https://sources.hrmny.co/fixtures/northstar-retail",
    employeesGlobal: 600,
    leadSourceLane: "staff_signal",
    ...overrides,
  });
}

function salesCaller(user: SessionUser) {
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("Sales OS SOPs + qualification", () => {
  it("rotates sectors by weekday", () => {
    expect(
      sectorForDate(
        DEFAULT_SALES_OS_SETTINGS,
        new Date("2026-08-24T08:00:00Z"),
      ),
    ).toBe("retail"); // Monday
    expect(
      sectorForDate(
        DEFAULT_SALES_OS_SETTINGS,
        new Date("2026-08-25T08:00:00Z"),
      ),
    ).toBe("sports");
    expect(contactsForTemperature("hot")).toBe(3);
    expect(contactsForTemperature("cool")).toBe(0);
  });

  it("rejects no-go industries", () => {
    expect(
      matchesNoGo({ name: "Cool Crypto Labs", whyThis: "web3 launch" }),
    ).toBe("Crypto / Web3");
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

  it("builds a recipient-bound absolute unsubscribe URL", () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://hrmny-os.vercel.app";
    try {
      const url = buildUnsubscribeUrl(
        "/api/sales-os/unsubscribe",
        "person@example.com",
      );
      expect(url).toMatch(
        /^https:\/\/hrmny-os\.vercel\.app\/api\/sales-os\/unsubscribe\?token=/,
      );
      expect(hasValidUnsubscribeLink(`Unsubscribe: ${url}`, "person@example.com")).toBe(true);
      expect(
        hasValidUnsubscribeLink(
          `Unsubscribe: /api/sales-os/unsubscribe?token=${createUnsubscribeToken("person@example.com")}`,
          "person@example.com",
        ),
      ).toBe(false);
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = previous;
    }
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
    const capped = await assertEmailSendAllowed({
      email: "fresh@brand.com",
      now,
    });
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.code).toBe("DAILY_CAP");
  });

  it("blocks unsupported agency proof claims at send time", async () => {
    const blocked = await assertEmailSendAllowed({
      email: "sana@tracehospitality.ae",
      emailVerified: true,
      companyName: "Trace Hospitality",
      body: [
        "Hi Sana,",
        "Trace Hospitality appears to be expanding in Abu Dhabi.",
        "Our proven track record in hospitality can support that growth.",
      ].join("\n\n"),
    });

    expect(blocked).toMatchObject({
      ok: false,
      code: "VOICE_CHECK_FAILED",
    });
  });

  it("blocks LinkedIn assists after the weekly cap", async () => {
    await saveSalesOsSettings({
      ...(await getSalesOsSettings()),
      caps: {
        ...(await getSalesOsSettings()).caps,
        linkedinConnectsPerWeek: 1,
      },
    });
    await addCredit("linkedin_assist", 1, weekKey());
    const blocked = await assertLinkedInAssistAllowed();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("WEEKLY_CAP");
  });
});

describe("research → enrich → draft gates", () => {
  beforeEach(resetAll);

  it("stores one proposal, signal, audit, and receipt without canonical CRM writes", async () => {
    const companyCount = (await listCompanies()).length;
    const dealCount = (await listDeals()).length;
    const requestId = "00000000-0000-4000-8000-000000000201";
    const first = await proposeSignal({ requestId });
    const replay = await proposeSignal({ requestId });

    expect(first).toMatchObject({ duplicate: false, replayed: false });
    expect(replay).toMatchObject({
      proposal: { id: first.proposal.id, companyId: null },
      receiptId: first.receiptId,
      signalId: first.signalId,
      auditId: first.auditId,
      duplicate: true,
      replayed: true,
    });
    expect(await listCompanyResearch()).toHaveLength(1);
    expect(await listIntelSignals()).toHaveLength(1);
    expect(await listCompanies()).toHaveLength(companyCount);
    expect(await listDeals()).toHaveLength(dealCount);
    expect(
      getDemoStore().audits.some(
        (audit) =>
          audit.auditEventId === first.auditId &&
          audit.action === "sales.research.proposed",
      ),
    ).toBe(true);
  });

  it("rejects concurrent payload reuse for the same request ID", async () => {
    const requestId = "00000000-0000-4000-8000-000000000202";
    const results = await Promise.allSettled([
      proposeSignal({ requestId }),
      proposeSignal({
        requestId,
        evidence: "https://sources.hrmny.co/fixtures/different-source",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected" });
    if (rejected?.status === "rejected") {
      expect(String(rejected.reason)).toContain("PAYLOAD_MISMATCH");
    }
    expect(await listCompanyResearch()).toHaveLength(1);
    expect(await listIntelSignals()).toHaveLength(1);
  });

  it("keeps each distinct source event while reusing one pending proposal", async () => {
    const first = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000203",
    });
    const second = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000204",
    });

    expect(second).toMatchObject({
      proposal: { id: first.proposal.id },
      duplicate: true,
      replayed: false,
    });
    expect(second.signalId).not.toBe(first.signalId);
    expect(await listCompanyResearch()).toHaveLength(1);
    expect(await listIntelSignals()).toHaveLength(2);
  });

  it("promotes once under concurrent approval and links only receipt signals", async () => {
    const companyCount = (await listCompanies()).length;
    const first = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000205",
    });
    const second = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000206",
    });
    expect(second.proposal.id).toBe(first.proposal.id);

    const approvals = await Promise.all([
      decideCompany(first.proposal.id, "approve", {
        actorId: "c0000000-0000-4000-8000-000000000002",
      }),
      decideCompany(first.proposal.id, "approve", {
        actorId: "c0000000-0000-4000-8000-000000000002",
      }),
    ]);
    expect(new Set(approvals.map((row) => row.companyId)).size).toBe(1);
    expect(await listCompanies()).toHaveLength(companyCount + 1);
    const signals = await listIntelSignals();
    expect(signals).toHaveLength(2);
    expect(
      signals.every((signal) => signal.companyId === approvals[0]!.companyId),
    ).toBe(true);
    await expect(
      decideCompany(first.proposal.id, "rework", { feedback: "reverse it" }),
    ).rejects.toThrow(/governed correction/i);
  });

  it("fails closed when matching names carry conflicting domains", async () => {
    const companyCount = (await listCompanies()).length;
    const first = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000207",
      evidence: "https://sources.hrmny.co/fixtures/identity-one",
      website: "https://northstar-one.example",
    });
    const second = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000208",
      evidence: "https://sources.hrmny.co/fixtures/identity-two",
      website: "https://northstar-two.example",
    });
    expect(second.proposal.id).not.toBe(first.proposal.id);

    const approvals = await Promise.allSettled([
      decideCompany(first.proposal.id, "approve", {
        actorId: "c0000000-0000-4000-8000-000000000002",
      }),
      decideCompany(second.proposal.id, "approve", {
        actorId: "c0000000-0000-4000-8000-000000000002",
      }),
    ]);

    expect(
      approvals.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = approvals.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected" });
    if (rejected?.status === "rejected") {
      expect(String(rejected.reason)).toContain(
        "COMPANY_IDENTITY_CONFLICT_REQUIRES_REVIEW",
      );
    }
    expect(await listCompanies()).toHaveLength(companyCount + 1);
    const signals = await listIntelSignals();
    expect(signals.filter((signal) => signal.companyId !== null)).toHaveLength(
      1,
    );
    expect(signals.filter((signal) => signal.companyId === null)).toHaveLength(
      1,
    );
  });

  it("does not attach another company's signal that cites the same source", async () => {
    const sharedEvidence =
      "https://sources.hrmny.co/fixtures/shared-market-report";
    const first = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000209",
      name: "Northstar Shared Source",
      evidence: sharedEvidence,
    });
    const second = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000210",
      name: "Southstar Shared Source",
      evidence: sharedEvidence,
    });
    expect(second.proposal.id).not.toBe(first.proposal.id);

    const approved = await decideCompany(first.proposal.id, "approve", {
      actorId: "c0000000-0000-4000-8000-000000000002",
    });
    const signals = await listIntelSignals();
    expect(
      signals.find((signal) => signal.id === first.signalId)?.companyId,
    ).toBe(approved.companyId);
    expect(
      signals.find((signal) => signal.id === second.signalId)?.companyId,
    ).toBeNull();
  });

  it("serializes opposite Gate 1 decisions without a split state", async () => {
    const receipt = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000211",
      name: "Decision Race Fixture",
      evidence: "https://sources.hrmny.co/fixtures/decision-race",
    });
    const results = await Promise.allSettled([
      decideCompany(receipt.proposal.id, "approve", {
        actorId: "c0000000-0000-4000-8000-000000000002",
      }),
      decideCompany(receipt.proposal.id, "reject", {
        actorId: "c0000000-0000-4000-8000-000000000002",
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const final = (await listCompanyResearch()).find(
      (row) => row.id === receipt.proposal.id,
    );
    expect(["approved", "rejected"]).toContain(final?.approvalState);
    if (final?.approvalState === "approved") {
      expect(final.companyId).toBeTruthy();
      expect(
        (await listIntelSignals()).find(
          (signal) => signal.id === receipt.signalId,
        )?.companyId,
      ).toBe(final.companyId);
    } else {
      expect(final?.companyId).toBeNull();
    }
  });

  it("rejects missing or placeholder evidence before any write", async () => {
    await expect(
      proposeSignal({ evidence: "https://example.com/unverified" }),
    ).rejects.toThrow(/non-placeholder public HTTPS source/i);
    await expect(
      proposeSignal({ evidence: "https://127.0.0.1/internal" }),
    ).rejects.toThrow(/non-placeholder public HTTPS source/i);
    await expect(
      proposeSignal({ evidence: "https://news.example.com/unverified" }),
    ).rejects.toThrow(/non-placeholder public HTTPS source/i);
    await expect(
      proposeSignal({ evidence: "https://[fd00::1]/internal" }),
    ).rejects.toThrow(/non-placeholder public HTTPS source/i);
    await expect(
      proposeSignal({ evidence: "https://192.0.2.10/documentation" }),
    ).rejects.toThrow(/non-placeholder public HTTPS source/i);
    await expect(
      proposeSignal({ evidence: "https://100.64.0.10/carrier-network" }),
    ).rejects.toThrow(/non-placeholder public HTTPS source/i);
    expect(await listCompanyResearch()).toHaveLength(0);
    expect(await listIntelSignals()).toHaveLength(0);
  });

  it("refuses Gate 1 for a legacy row without a proposal receipt", async () => {
    const legacy = await insertCompanyResearch({
      companyId: null,
      name: "Legacy Receiptless Fixture",
      sector: "Retail",
      market: "UAE",
      website: "https://legacy-receiptless.example",
      whyThis: "Synthetic UAE launch signal retained from a legacy row.",
      evidence: "https://sources.hrmny.co/fixtures/legacy-receiptless",
      leadSourceLane: "staff_signal",
      estimatedValueAed: null,
      suggestedServices: null,
      buafBudget: 7,
      buafUrgency: 7,
      buafAccess: 7,
      buafFit: 7,
      buafTotal: 28,
      temperature: "hot",
      approvalState: "researched",
      reworkFeedback: null,
      decidedBy: null,
      decidedAt: null,
    });

    await expect(decideCompany(legacy.id, "approve")).rejects.toThrow(
      /RESEARCH_PROPOSAL_RECEIPT_REQUIRED/,
    );
    expect((await listCompanyResearch())[0]).toMatchObject({
      id: legacy.id,
      companyId: null,
      approvalState: "researched",
    });
  });

  it("captures a proposal, then gates company/contact and drafts channels", async () => {
    const companyCount = (await listCompanies()).length;
    const receipt = await proposeSignal();
    const company = receipt.proposal;
    expect(company.companyId).toBeNull();
    expect(await listCompanies()).toHaveLength(companyCount);
    const approved = await decideCompany(company.id, "approve", {
      actorId: "c0000000-0000-4000-8000-000000000002",
    });
    expect(approved.approvalState).toBe("approved");
    expect(approved.companyId).toBeTruthy();
    expect(await listCompanies()).toHaveLength(companyCount + 1);

    const enrich = await enrichApprovedCompany(company.id, {
      leadSource: createLeadSourceMock(),
      allowSynthetic: true,
    });
    expect(enrich.created.length).toBeGreaterThan(0);
    const contact = enrich.created[0]!;
    const gated = await decideContact(contact.id, "approve");
    expect(gated.approvalState).toBe("approved");
    expect(gated.dealId).toBeTruthy();

    const runAgent: RunAgent = vi.fn(async (input) => ({
      agent: input.agent,
      model: "test",
      output: `Hi Mina — I noticed ${approved.name}'s new UAE launch.`,
      inputTokens: 1,
      outputTokens: 1,
      costAed: 0,
      gateOutcome: "pending" as const,
    }));
    const drafts = await draftChannelsForApprovedContact(gated.id, {
      runAgent,
    });
    expect(drafts.created.some((d) => d.channel === "linkedin_connect")).toBe(
      true,
    );
    expect(drafts.created.some((d) => d.channel === "linkedin_followup")).toBe(
      true,
    );
    const email = drafts.created.find((d) => d.channel === "gmail");
    if (email) {
      expect(email.body).toContain(FOOTER_MARKER);
      expect(email.body).toContain(approved.name);
      expect(email.body).not.toContain("mock outreach");
    }

    const replay = await draftChannelsForApprovedContact(gated.id, {
      runAgent,
    });
    expect(replay).toMatchObject({ replayed: true, created: [] });
    expect(runAgent).toHaveBeenCalledTimes(email ? 1 : 0);
    expect(await listOutreach({ dealId: gated.dealId! })).toHaveLength(
      drafts.created.length,
    );
  });

  it("refuses to persist synthetic contact discovery on the visible path", async () => {
    const receipt = await proposeSignal({
      requestId: "00000000-0000-4000-8000-000000000212",
      name: "Synthetic Discovery Boundary",
      evidence: "https://sources.hrmny.co/fixtures/synthetic-discovery",
    });
    const approved = await decideCompany(receipt.proposal.id, "approve", {
      actorId: "c0000000-0000-4000-8000-000000000002",
    });

    await expect(
      enrichApprovedCompany(approved.id, {
        leadSource: createLeadSourceMock(),
      }),
    ).rejects.toThrow(/SYNTHETIC_CONTACT_DISCOVERY_FORBIDDEN/);
    expect(await listContactResearch()).toHaveLength(0);
  });

  it("fails the specificity test when the company name is missing", () => {
    expect(
      failsSpecificityTest("Great work on the launch.", "Lucid Motors"),
    ).toBe(true);
    expect(
      failsSpecificityTest(
        "Loved Lucid Motors opening in Dubai.",
        "Lucid Motors",
      ),
    ).toBe(false);
  });
});

describe("digest, replies, intent CSV, evolve, stale", () => {
  beforeEach(resetAll);

  it("builds a coverage digest and flags stalls", async () => {
    await proposeSignal();
    const digest = await buildSalesOsDigest();
    expect(digest.researchedWaiting).toBeGreaterThan(0);
    expect(digest.coverage.targetX).toBe(3);
  });

  it("calculates reply rate from durable Gmail events", async () => {
    const outreach = await insertOutreach({
      dealId: "00000000-0000-4000-8000-000000000089",
      channel: "gmail",
      recipient: "reply@brand.com",
      body: "Hi",
    });
    await recordEmailEvent({
      outreachItemId: outreach.id,
      kind: "sent",
      externalId: "gmail-sent-1",
    });
    await recordEmailEvent({
      outreachItemId: outreach.id,
      kind: "replied",
      externalId: "gmail-reply-1",
    });
    await recordEmailEvent({
      outreachItemId: outreach.id,
      kind: "replied",
      externalId: "gmail-reply-2",
    });

    await expect(buildSalesOsDigest()).resolves.toMatchObject({
      replyRate: { sent: 1, replied: 1, rate: 1 },
    });
  });

  it("keeps synthetic follow-ups out of business monitoring", async () => {
    const deal = await createDeal({ companyName: "Inbound Proof 123" });
    const outreach = await insertOutreach({
      dealId: deal.dealId,
      channel: "gmail",
      recipient: "fixture@example.com",
      body: "Hi",
    });
    const { patchOutreach } = await import("../leadgen/store");
    await patchOutreach(outreach.id, {
      state: "sent",
      sentAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(
      buildSalesOsDigest(new Date("2026-02-01T00:00:00.000Z")),
    ).resolves.toMatchObject({ followUps: { due: 0 } });
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
      "company,domain,intent,evidence,employees\nNorthstar Retail Fixture,northstar.example,marketing,https://sources.hrmny.co/fixtures/intent-northstar,2000\nCrypto Casino,bad.io,ads,https://sources.hrmny.co/fixtures/intent-no-go,12",
    );
    expect(parsed).toHaveLength(2);
    const out = await processIntentLeads(
      "company,domain,intent,evidence,employees\nNorthstar Retail Fixture,northstar.example,marketing,https://sources.hrmny.co/fixtures/intent-northstar,2000\nCrypto Casino,bad.io,ads,https://sources.hrmny.co/fixtures/intent-no-go,12",
    );
    expect(out.created.length).toBeGreaterThan(0);
    expect(out.skipped.some((s) => s.company.includes("Crypto"))).toBe(true);
  });

  it("keeps intent rows without source evidence out of the proposal ledger", async () => {
    const parsed = parseIntentCsv(
      "company,domain,intent,evidence,employees\nMissing Source,missing.example,launch,,not-a-number",
    );
    expect(parsed[0]?.employees).toBeUndefined();
    const out = await processIntentLeads(
      "company,domain,intent,evidence,employees\nMissing Source,missing.example,launch,,not-a-number",
    );
    expect(out.created).toHaveLength(0);
    expect(out.skipped).toEqual([
      { company: "Missing Source", reason: "missing_evidence" },
    ]);
    expect(await listCompanyResearch()).toHaveLength(0);
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
    expect(await listEmailEvents({ kind: "delivered" })).toHaveLength(0);
  });
});

describe("Sales research authorization", () => {
  beforeEach(resetAll);

  it("denies non-Sales staff before proposal persistence", async () => {
    const hr = resolveDevUser("hr");
    await expect(
      salesCaller(hr).salesOs.research.ingest({
        requestId: "00000000-0000-4000-8000-000000000207",
        name: "Denied Research Fixture",
        whyThis: "Synthetic UAE launch signal for an authorization test.",
        evidence: "https://sources.hrmny.co/fixtures/denied-research",
      }),
    ).rejects.toThrow(/Sales operator role required/i);
    expect(await listCompanyResearch()).toHaveLength(0);
  });

  it("accepts the provisioned account-manager persona and attributes its audit", async () => {
    const accountManager = resolveDevUser("am");
    const receipt = await salesCaller(accountManager).salesOs.research.ingest({
      requestId: "00000000-0000-4000-8000-000000000208",
      name: "Account Manager Persona Fixture",
      whyThis: "Synthetic Dubai campaign signal for an AM role test.",
      evidence: "https://sources.hrmny.co/fixtures/am-persona",
    });
    expect(receipt.proposal.companyId).toBeNull();
    expect(
      getDemoStore().audits.find(
        (audit) => audit.auditEventId === receipt.auditId,
      )?.actorEmployeeId,
    ).toBe(accountManager.employeeId);
  });

  it("denies non-Sales staff from free and paid Apollo operations", async () => {
    const hr = salesCaller(resolveDevUser("hr"));
    await expect(
      hr.salesOs.apollo.search({
        idempotencyKey: "40000000-0000-4000-8000-000000000001",
        titles: ["Marketing Director"],
      }),
    ).rejects.toThrow(/Sales operator role required/i);
    await expect(
      hr.salesOs.apollo.approveExact({
        candidate: { externalId: "apollo-denied-person" },
        confirmCreditUse: true,
      }),
    ).rejects.toThrow(/Sales operator role required/i);
    await expect(
      hr.salesOs.apollo.enrichOne({
        candidate: { externalId: "apollo-denied-person" },
        confirmCreditUse: true,
        approvalReceiptId: "43000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toThrow(/Sales operator role required/i);
    await expect(
      hr.salesOs.apollo.saveCandidate({
        candidate: { externalId: "apollo-denied-save" },
      }),
    ).rejects.toThrow(/Sales operator role required/i);
    expect(await creditUsed("apollo_contact")).toBe(0);
  });

  it("saves a free-search candidate to the pipeline once without using credits", async () => {
    const partner = salesCaller(resolveDevUser("partner"));
    const candidate = {
      externalId: "apollo-free-save-1",
      fullName: "Mina Lead",
      title: "Marketing Director",
      companyName: "Northstar Hospitality",
      companyDomain: "northstar.example",
    };
    const first = await partner.salesOs.apollo.saveCandidate({
      candidate,
      market: "Oman",
    });
    const replay = await partner.salesOs.apollo.saveCandidate({
      candidate,
      market: "Oman",
    });
    expect(first.duplicate).toBe(false);
    expect(replay).toMatchObject({
      dealId: first.dealId,
      duplicate: true,
    });
    expect(
      await partner.salesOs.apollo.savedCandidates({
        externalIds: [candidate.externalId, "not-saved"],
      }),
    ).toEqual([
      {
        externalId: candidate.externalId,
        dealId: first.dealId,
        companyName: candidate.companyName,
        fullName: candidate.fullName,
        email: null,
        emailVerified: false,
      },
    ]);
    const savedDeal = await getDeal(first.dealId);
    expect(savedDeal?.primaryContactId).toBe(first.contactId);
    expect(
      (await listCompanies()).find(
        (company) => company.companyId === first.companyId,
      )?.market,
    ).toBe("Oman");
    expect(await listContacts({ companyId: first.companyId })).toEqual([
      expect.objectContaining({
        contactId: first.contactId,
        firstName: "Mina",
        lastName: "Lead",
        email: null,
        title: "Marketing Director",
      }),
    ]);
    expect(
      (await listDeals()).filter((deal) => deal.dealId === first.dealId),
    ).toHaveLength(1);
    expect(await listNotes({ dealId: first.dealId })).toEqual([
      expect.objectContaining({
        body: "Added Mina Lead (Marketing Director) from Apollo to Northstar Hospitality. No email was unlocked. Target market: Oman. No phone, personal email, or waterfall lookup was used.",
      }),
    ]);
    expect(await creditUsed("apollo_contact")).toBe(0);
  });

  it("creates a bounded paid approval but rejects an unknown receipt before Apollo", async () => {
    const partner = salesCaller(resolveDevUser("partner"));
    const approval = await partner.salesOs.apollo.approveExact({
      candidate: { externalId: "apollo-approved-but-not-run" },
      confirmCreditUse: true,
    });
    expect(approval).toMatchObject({ creditsMaximum: 1 });
    expect(approval.approvalReceiptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await expect(
      partner.salesOs.apollo.enrichOne({
        candidate: { externalId: "apollo-visible-but-unapproved" },
        confirmCreditUse: true,
        approvalReceiptId: "43000000-0000-4000-8000-000000000098",
      }),
    ).rejects.toThrow(/INVALID_OR_USED/);
    expect(await creditUsed("apollo_contact")).toBe(0);
  });

  it("denies non-Sales staff from intent proposal import", async () => {
    const hr = salesCaller(resolveDevUser("hr"));
    await expect(
      hr.salesOs.intentCsv({
        csv: "company,domain,intent,evidence,employees\nDenied CSV,denied.example,launch,https://sources.hrmny.co/fixtures/denied-csv,200",
      }),
    ).rejects.toThrow(/Sales operator role required/i);
    expect(await listCompanyResearch()).toHaveLength(0);
  });
});
