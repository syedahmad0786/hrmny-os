import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAgentOverrides, setAgentEnabled } from "@hrmny/ai";
import { resetCrmMemory } from "../crm/memory";
import {
  createCompany,
  createContact,
  createDeal,
  getDeal,
  listActivities,
  listNotes,
  updateContact,
} from "../crm/repository";
import { resetIntegrationReceiptMemory } from "../integrations/inbox";
import { listOutreach, resetLeadgenStore } from "../leadgen/store";
import { createMockRunAgent } from "../leadgen/agent-run";
import {
  accountSummary,
  companyKnowledgeBrief,
  dealSummary,
  draftOutreachForDeal,
  nextBestAction,
  rescoreBuaf,
} from "./service";

async function seed() {
  const company = await createCompany({ name: "Acme LLC", sector: "Retail" });
  const contact = await createContact({
    companyId: company.companyId,
    firstName: "Sara",
    email: "sara@acme.example",
  });
  const deal = await createDeal({
    companyName: "Acme LLC",
    companyId: company.companyId,
    primaryContactId: contact.contactId,
  });
  await updateContact(contact.contactId, { emailVerified: true });
  return { company, contact, deal };
}

describe("crm-ai service (mock provider)", () => {
  beforeEach(() => {
    resetCrmMemory();
    resetLeadgenStore();
    resetIntegrationReceiptMemory();
  });
  afterEach(() => {
    resetAgentOverrides();
  });

  it("dealSummary returns output + agentRun meta", async () => {
    const { deal } = await seed();
    const res = await dealSummary({ dealId: deal.dealId });
    expect(res.output).toBeTruthy();
    expect(res.agentRun.model).toMatch(/mock/);
    expect(res.agentRun.tokens).toBe(0);
    expect(res.agentRun.costAed).toBe(0);
  });

  it("accountSummary returns output + agentRun meta", async () => {
    const { company } = await seed();
    const res = await accountSummary({ companyId: company.companyId });
    expect(res.output).toBeTruthy();
    expect(res.agentRun.model).toMatch(/mock/);
    expect(res.agentRun.costAed).toBe(0);
  });

  it("nextBestAction returns output + agentRun meta", async () => {
    const { deal } = await seed();
    const res = await nextBestAction({ dealId: deal.dealId });
    expect(res.output).toBeTruthy();
    expect(res.agentRun.model).toMatch(/mock/);
  });

  it("stores one sourced brief for one confirmed research request", async () => {
    const { deal } = await seed();
    const runAgent = vi.fn(async () => ({
      agent: "research" as const,
      model: "mock-web",
      output:
        "Verified company signal.\n\nLikely pain point: launch visibility.",
      inputTokens: 10,
      outputTokens: 20,
      costAed: 0,
      gateOutcome: "not_applicable" as const,
      providerRequestId: "provider-request-1",
      sourceCitations: [
        { url: "https://www.hrmny.co/work", title: "hrmny work" },
      ],
      webSearchRequests: 1,
    }));
    const requestId = crypto.randomUUID();
    const input = {
      dealId: deal.dealId,
      requestId,
      confirmWebResearch: true as const,
      actorEmployeeId: crypto.randomUUID(),
      roles: ["staff"],
      runAgent,
    };

    const first = await companyKnowledgeBrief(input);
    const duplicate = await companyKnowledgeBrief(input);

    expect(first).toMatchObject({
      duplicate: false,
      providerRequestId: "provider-request-1",
      webSearchRequests: 1,
    });
    expect(duplicate).toMatchObject({ duplicate: true, noteId: first.noteId });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(await listNotes({ dealId: deal.dealId })).toHaveLength(1);
  });

  it("rescoreBuaf writes the temperature back and records an activity", async () => {
    const { deal } = await seed();
    expect(deal.buafTemperature).toBeNull();

    const res = await rescoreBuaf({
      dealId: deal.dealId,
      actorEmployeeId: null,
      runAgent: createMockRunAgent(),
    });
    expect(res.output.buafScore).toBeGreaterThanOrEqual(0);
    expect(["hot", "warm", "cool", "cold"]).toContain(res.output.temperature);
    expect(res.output.deal.buafTemperature).toBe(res.output.temperature);

    const stored = await getDeal(deal.dealId);
    expect(stored?.buafTemperature).toBe(res.output.temperature);

    const activities = await listActivities({ dealId: deal.dealId });
    expect(activities.some((a) => a.subject?.startsWith("BUAF rescored"))).toBe(
      true,
    );
  });

  it("rescoreBuaf under the raw mock provider defaults to cold", async () => {
    const { deal } = await seed();
    const res = await rescoreBuaf({ dealId: deal.dealId });
    expect(res.output.buafScore).toBe(0);
    expect(res.output.temperature).toBe("cold");
  });

  it("draftOutreach lands a draft in the leadgen HITL queue", async () => {
    const { deal } = await seed();
    const res = await draftOutreachForDeal({ dealId: deal.dealId });
    expect(res.output.state).toBe("draft");
    expect(res.output.recipient).toBe("sara@acme.example");
    expect(res.output.body).toBeTruthy();
    expect(res.agentRun.model).toMatch(/mock/);
    expect(await listOutreach({ dealId: deal.dealId })).toHaveLength(1);
  });

  it("throws NOT_FOUND for a missing deal", async () => {
    await expect(dealSummary({ dealId: crypto.randomUUID() })).rejects.toThrow(
      /Deal not found/,
    );
  });

  // ── kill switch: standard disabled error on every procedure ──

  it("dealSummary refuses when crm-summary is disabled", async () => {
    const { deal } = await seed();
    setAgentEnabled("crm-summary", false);
    await expect(dealSummary({ dealId: deal.dealId })).rejects.toThrow(
      /disabled by the kill switch/,
    );
  });

  it("accountSummary refuses when crm-summary is disabled", async () => {
    const { company } = await seed();
    setAgentEnabled("crm-summary", false);
    await expect(
      accountSummary({ companyId: company.companyId }),
    ).rejects.toThrow(/disabled by the kill switch/);
  });

  it("nextBestAction refuses when next-best-action is disabled", async () => {
    const { deal } = await seed();
    setAgentEnabled("next-best-action", false);
    await expect(nextBestAction({ dealId: deal.dealId })).rejects.toThrow(
      /disabled by the kill switch/,
    );
  });

  it("rescoreBuaf refuses when research is disabled — no write happens", async () => {
    const { deal } = await seed();
    setAgentEnabled("research", false);
    await expect(rescoreBuaf({ dealId: deal.dealId })).rejects.toThrow(
      /disabled by the kill switch/,
    );
    const stored = await getDeal(deal.dealId);
    expect(stored?.buafTemperature).toBeNull();
  });

  it("draftOutreach refuses when outreach-draft is disabled — no draft inserted", async () => {
    const { deal } = await seed();
    setAgentEnabled("outreach-draft", false);
    await expect(draftOutreachForDeal({ dealId: deal.dealId })).rejects.toThrow(
      /disabled by the kill switch/,
    );
    expect(await listOutreach({ dealId: deal.dealId })).toHaveLength(0);
  });
});
