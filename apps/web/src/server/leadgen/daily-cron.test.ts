import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutonomyPolicy } from "@hrmny/ai";
import { resetCrmMemory } from "../crm/memory";
import { listCompanies, listContacts, listDeals } from "../crm/repository";
import { listHealthSignals } from "../m1-persistence";
import {
  LEADGEN_DAILY_SIGNAL,
  LEADGEN_UTC_HOUR,
  resetLeadgenDailyMemory,
  runLeadgenDailyCron,
} from "./daily-cron";

async function crmSnapshot() {
  const [companies, contacts, deals] = await Promise.all([
    listCompanies(),
    listContacts(),
    listDeals(),
  ]);

  return {
    companyIds: companies.map((company) => company.companyId).sort(),
    contactIds: contacts.map((contact) => contact.contactId).sort(),
    dealIds: deals.map((deal) => deal.dealId).sort(),
  };
}

describe("leadgen daily cron", () => {
  beforeEach(() => {
    resetCrmMemory();
  });

  afterEach(() => {
    resetLeadgenDailyMemory();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const scheduledPolicy: AutonomyPolicy = {
    mode: "scheduled_research",
    allowedScheduledAgents: ["research"],
    updatedBy: "employee-1",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };

  it("skips before the Dubai morning window", async () => {
    const early = new Date("2026-08-21T01:00:00.000Z");
    expect(early.getUTCHours()).toBeLessThan(LEADGEN_UTC_HOUR);
    const result = await runLeadgenDailyCron(early);
    expect(result).toEqual({ ran: false, skipped: "before_window" });
  });

  it("fails closed in manual mode before any network-capable work", async () => {
    vi.stubEnv("APOLLO_MODE", "live");
    vi.stubEnv("APOLLO_API_KEY", "must-not-be-used");
    vi.stubEnv("HUNTER_MODE", "live");
    vi.stubEnv("HUNTER_API_KEY", "must-not-be-used");
    vi.stubEnv("HUNTER_ALLOW_PAID_OPERATIONS", "true");
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "must-not-be-used");
    vi.stubEnv("DATABASE_MODE", "memory");
    vi.stubEnv(
      "GOOGLE_CHAT_WEBHOOK_URL",
      "https://chat.invalid/must-not-be-used",
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must remain unreachable"));
    const crmBefore = await crmSnapshot();
    const healthBefore = await listHealthSignals(10_000);

    const result = await runLeadgenDailyCron(
      new Date("2026-08-21T02:00:00.000Z"),
      {
        readPolicy: async () => ({
          ...scheduledPolicy,
          mode: "manual",
          allowedScheduledAgents: [],
        }),
      },
    );

    expect(result).toEqual({
      ran: false,
      skipped: "policy_denied",
      policyViolation: "mode_not_scheduled",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(crmSnapshot()).resolves.toEqual(crmBefore);
    const healthAfter = await listHealthSignals(10_000);
    expect(healthAfter).toHaveLength(healthBefore.length + 1);
    expect(healthAfter[0]).toMatchObject({
      signalKey: LEADGEN_DAILY_SIGNAL,
      severity: "warn",
      notifiedAt: null,
      payload: expect.objectContaining({ reason: "policy_denied" }),
    });
  });

  it("does not let an allow-listed policy activate the unsafe legacy pipeline", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must remain unreachable"));
    const recordSignal = vi.fn().mockResolvedValue(undefined);
    const crmBefore = await crmSnapshot();

    const first = await runLeadgenDailyCron(
      new Date("2026-08-21T02:00:00.000Z"),
      { readPolicy: async () => scheduledPolicy, recordSignal },
    );
    const replay = await runLeadgenDailyCron(
      new Date("2026-08-21T03:00:00.000Z"),
      { readPolicy: async () => scheduledPolicy, recordSignal },
    );

    expect(first).toEqual({
      ran: false,
      skipped: "proposal_runtime_unavailable",
    });
    expect(replay).toEqual({ ran: false, skipped: "already_ran" });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(crmSnapshot()).resolves.toEqual(crmBefore);
    expect(recordSignal).toHaveBeenCalledTimes(1);
  });

  it("requires the research agent to be explicitly allow-listed", async () => {
    const result = await runLeadgenDailyCron(
      new Date("2026-08-21T02:00:00.000Z"),
      {
        readPolicy: async () => ({
          ...scheduledPolicy,
          allowedScheduledAgents: ["outreach-draft"],
        }),
        recordSignal: vi.fn().mockResolvedValue(undefined),
      },
    );
    expect(result).toMatchObject({
      ran: false,
      skipped: "policy_denied",
      policyViolation: "agent_not_allowlisted",
    });
  });
});
