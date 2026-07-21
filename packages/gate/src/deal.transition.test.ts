import { describe, expect, it, beforeEach } from "vitest";
import {
  bootstrapGateRegistry,
  clearRegistry,
  scoreBuaf,
  transition,
  type ActorContext,
  type EntitySnapshot,
  type TransitionDeps,
} from "./index";

describe("deal gate transitions", () => {
  const partner: ActorContext = {
    employeeId: "11111111-1111-1111-1111-111111111111",
    roles: ["partner"],
    permissions: ["allow:deal:transition"],
  };

  const am: ActorContext = {
    employeeId: "22222222-2222-2222-2222-222222222222",
    roles: ["am"],
    permissions: ["allow:deal:transition"],
  };

  beforeEach(() => {
    clearRegistry();
    bootstrapGateRegistry();
  });

  function deps(audits: unknown[]): TransitionDeps {
    return {
      authorize: async (_a, _e, _to) => true,
      apply: async ({ entity: e, request }) => ({
        ...e,
        state: request.to,
        data: { ...e.data, ...request.payload },
      }),
      audit: async (event) => {
        audits.push(event);
        return { auditId: `audit-${audits.length}` };
      },
    };
  }

  it("scores BUAF Hot when all four true", () => {
    expect(
      scoreBuaf({ budget: true, urgency: true, access: true, fit: true }),
    ).toEqual({ temperature: "hot", hot: true, score: 4 });
  });

  it("blocks illegal discover → close and writes blocked audit", async () => {
    const audits: unknown[] = [];
    const entity: EntitySnapshot = {
      entityType: "deal",
      entityId: "e0000000-0000-4000-8000-000000000001",
      state: "discover",
      data: { companyName: "Demo Co LLC", marginPct: "40.00" },
    };
    const result = await transition(partner, entity, { to: "close" }, deps(audits));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("GATE_BLOCKED");
      expect(result.blockedBy?.[0]?.gate).toBe("deal.legal_transition");
      expect(result.auditId).toBe("audit-1");
    }
    expect(audits).toHaveLength(1);
  });

  it("allows discover → qualify and persists audit", async () => {
    const audits: unknown[] = [];
    const entity: EntitySnapshot = {
      entityType: "deal",
      entityId: "e0000000-0000-4000-8000-000000000001",
      state: "discover",
      data: { companyName: "Demo Co LLC", marginPct: "40.00" },
    };
    const result = await transition(
      partner,
      entity,
      { to: "qualify", from: "discover" },
      deps(audits),
    );
    expect(result).toEqual({
      ok: true,
      newState: "qualify",
      auditId: "audit-1",
    });
    expect(audits).toHaveLength(1);
  });

  it("BUAF: fail Fit blocks qualify → engage", async () => {
    const audits: unknown[] = [];
    const entity: EntitySnapshot = {
      entityType: "deal",
      entityId: "e0000000-0000-4000-8000-000000000001",
      state: "qualify",
      data: {
        buafBudget: true,
        buafUrgency: true,
        buafAccess: true,
        buafFit: false,
      },
    };
    const result = await transition(am, entity, { to: "engage" }, deps(audits));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("GATE_BLOCKED");
      expect(result.blockedBy?.[0]?.gate).toBe("deal.buaf");
    }
    expect(audits).toHaveLength(1);
  });

  it("verified-email gate blocks engage → scope", async () => {
    const audits: unknown[] = [];
    const entity: EntitySnapshot = {
      entityType: "deal",
      entityId: "e0000000-0000-4000-8000-000000000001",
      state: "engage",
      data: {
        emailVerified: false,
        voiceCheckPassed: true,
      },
    };
    const result = await transition(am, entity, { to: "scope" }, deps(audits));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockedBy?.some((b) => b.gate === "deal.verified_email")).toBe(
        true,
      );
    }
  });

  it("margin below floor returns OVERRIDE_REQUIRED; partner override passes", async () => {
    const audits: unknown[] = [];
    const entity: EntitySnapshot = {
      entityType: "deal",
      entityId: "e0000000-0000-4000-8000-000000000001",
      state: "price_cost",
      data: {
        marginPct: "10.00",
        discountPct: "0",
        vendorHandlingFeePct: "20.00",
      },
    };
    const blocked = await transition(
      partner,
      entity,
      { to: "close" },
      deps(audits),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("OVERRIDE_REQUIRED");
      expect(blocked.blockedBy?.[0]?.gate).toBe("deal.margin_floor");
    }
    expect(audits).toHaveLength(1);

    const ok = await transition(
      partner,
      entity,
      { to: "close", overrideReason: "Strategic logo deal — partner approved" },
      deps(audits),
    );
    expect(ok.ok).toBe(true);
    expect(audits).toHaveLength(2);
  });

  it("won required before handover_pack", async () => {
    const audits: unknown[] = [];
    const entity: EntitySnapshot = {
      entityType: "deal",
      entityId: "e0000000-0000-4000-8000-000000000001",
      state: "close",
      data: { closeOutcome: "lost" },
    };
    const result = await transition(
      partner,
      entity,
      { to: "handover_pack" },
      deps(audits),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockedBy?.[0]?.gate).toBe("deal.won_before_handover");
    }
  });
});
