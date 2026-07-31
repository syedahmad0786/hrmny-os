import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { createCaller } from "../trpc/root";
import { getDemoStore } from "../demo-store";
import { resetCrmMemory } from "./memory";
import {
  createCompany,
  createContact,
  createDeal,
  listActivities,
  listDeals,
  moveDealStage,
  pipelineStages,
} from "./repository";
import { redactDealMargin } from "./types";

describe("CRM durable layer", () => {
  beforeEach(() => {
    resetCrmMemory();
  });

  it("exposes full pipeline stages", () => {
    const stages = pipelineStages();
    expect(stages.map((s) => s.key)).toEqual([
      "discover",
      "qualify",
      "engage",
      "scope",
      "propose",
      "price_cost",
      "close",
      "handover_pack",
    ]);
  });

  it("creates company → contact → deal and moves stage", async () => {
    const co = await createCompany({
      name: "Test Brand LLC",
      sector: "Hospitality",
      market: "UAE",
    });
    const person = await createContact({
      companyId: co.companyId,
      firstName: "Sara",
      lastName: "Khan",
      email: "sara@example.test",
      isPrimary: true,
    });
    const deal = await createDeal({
      companyName: co.name,
      companyId: co.companyId,
      primaryContactId: person.contactId,
      leadSourceLane: "relationship_led",
      ownerEmployeeId: "c0000000-0000-4000-8000-000000000002",
    });
    expect(deal.stage).toBe("discover");
    const moved = await moveDealStage({
      dealId: deal.dealId,
      to: "qualify",
      actorEmployeeId: "c0000000-0000-4000-8000-000000000002",
    });
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.deal.stage).toBe("qualify");
    const listed = await listDeals({ companyId: co.companyId });
    expect(listed.some((d) => d.dealId === deal.dealId)).toBe(true);
  });

  it("redacts margin for non-margin viewers", () => {
    const deal = {
      dealId: "x",
      companyId: null,
      primaryContactId: null,
      companyName: "X",
      sector: null,
      stage: "discover",
      closeOutcome: null,
      lostReason: null,
      leadSourceLane: "relationship_led",
      buafBudget: null,
      buafUrgency: null,
      buafAccess: null,
      buafFit: null,
      buafTemperature: null,
      emailVerified: false,
      quoteValue: "100",
      internalCost: "60",
      marginPct: "40",
      discountPct: null,
      discountApprovalTier: null,
      vendorHandlingFeePct: "20.00",
      ownerEmployeeId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const redacted = redactDealMargin(deal, false);
    expect("internalCost" in redacted).toBe(false);
    expect("marginPct" in redacted).toBe(false);
    const full = redactDealMargin(deal, true);
    expect("marginPct" in full && full.marginPct).toBe("40");
  });

  it("crm tRPC router lists seeded deals and health", async () => {
    const user = resolveDevUser("partner");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });
    const health = await caller.crm.health();
    expect(health.backend).toBe("memory");
    expect(health.deals).toBeGreaterThanOrEqual(4);
    const deals = await caller.crm.deals.list();
    expect(deals.length).toBeGreaterThanOrEqual(4);
    const companies = await caller.crm.companies.list();
    expect(companies.length).toBeGreaterThanOrEqual(4);
  });

  it("crm moveStage via tRPC is gate-enforced", async () => {
    const user = resolveDevUser("partner");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });
    const deals = await caller.crm.deals.list();
    const deal = deals.find((d) => d.stage === "discover");
    expect(deal).toBeTruthy();
    const blocked = await caller.crm.deals.moveStage({
      id: deal!.dealId,
      to: "close",
    });
    expect(blocked.ok).toBe(false);
    const legal = await caller.crm.deals.moveStage({
      id: deal!.dealId,
      to: "qualify",
    });
    expect(legal.ok).toBe(true);
  });

  it("serializes repeated stage changes and audits a stale second click", async () => {
    const user = resolveDevUser("partner");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });
    const deal = await caller.crm.deals.create({
      companyName: "Concurrent transition test",
      leadSourceLane: "relationship_led",
    });

    const results = await Promise.all([
      caller.crm.deals.moveStage({
        id: deal.dealId,
        from: "discover",
        to: "qualify",
      }),
      caller.crm.deals.moveStage({
        id: deal.dealId,
        from: "discover",
        to: "qualify",
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const stale = results.find((result) => !result.ok);
    expect(stale?.ok).toBe(false);
    if (stale && !stale.ok) {
      expect(stale.code).toBe("GATE_BLOCKED");
      expect(stale.blockedBy?.[0]?.gate).toBe("validate");
    }
    expect((await caller.crm.deals.get({ id: deal.dealId }))?.stage).toBe(
      "qualify",
    );
    expect(
      (await listActivities({ dealId: deal.dealId })).filter(
        (row) => row.type === "stage_change",
      ),
    ).toHaveLength(1);
    expect(
      getDemoStore().audits.filter(
        (row) =>
          row.entityId === deal.dealId &&
          ["deal.transition", "deal.transition.blocked"].includes(row.action),
      ),
    ).toHaveLength(2);
  });

  it("audits and rejects a transition without deal permission", async () => {
    const partner = resolveDevUser("partner");
    const partnerCaller = createCaller({
      user: partner,
      employeeId: partner.employeeId,
      roles: partner.roles,
      canViewMargin: sessionCanViewMargin(partner),
    });
    const deal = await partnerCaller.crm.deals.create({
      companyName: "Permission boundary test",
      leadSourceLane: "relationship_led",
    });
    const hr = resolveDevUser("hr");
    const hrCaller = createCaller({
      user: hr,
      employeeId: hr.employeeId,
      roles: hr.roles,
      canViewMargin: sessionCanViewMargin(hr),
    });

    const result = await hrCaller.crm.deals.moveStage({
      id: deal.dealId,
      from: "discover",
      to: "qualify",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockedBy?.[0]?.gate).toBe("authorize");
      expect(result.auditId).toBeTruthy();
    }
    expect((await partnerCaller.crm.deals.get({ id: deal.dealId }))?.stage).toBe(
      "discover",
    );
  });
});
