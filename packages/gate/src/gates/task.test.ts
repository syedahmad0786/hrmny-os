import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapGateRegistry } from "../bootstrap";
import { clearRegistry } from "../registry";
import { transition } from "../transition";
import type { ActorContext, EntitySnapshot } from "../types";
import { validateDor, dorLockBlockedReason } from "./brief";
import { evaluateShootLock } from "./calendar";

const actor: ActorContext = {
  employeeId: "c0000000-0000-4000-8000-000000000001",
  roles: ["creative_director"],
  permissions: ["allow:*:*"],
};

const deps = {
  authorize: async () => true,
  apply: async ({ entity, request }: { entity: EntitySnapshot; request: { to: string } }) => ({
    ...entity,
    state: request.to,
  }),
  audit: async () => ({ auditId: "audit-1" }),
};

describe("M4 DoR / QC / T-48h gates", () => {
  beforeEach(() => {
    clearRegistry();
    bootstrapGateRegistry();
  });

  it("DoR blocks lock when >2 required missing", () => {
    const v = validateDor({ objective: "Grow retail" });
    expect(v.missingRequiredCount).toBeGreaterThan(2);
    expect(v.canLock).toBe(false);
    expect(dorLockBlockedReason(v)).toMatch(/DoR lock blocked/);
  });

  it("DoR allows lock when ≤2 missing", () => {
    const v = validateDor({
      objective: "Grow",
      audience: "UAE retail",
      deliverables: "3 reels",
      deadline: "2026-09-30",
      brandAssets: { logo: true },
      // channels + successMetric missing = 2
    });
    expect(v.missingRequiredCount).toBe(2);
    expect(v.canLock).toBe(true);
    expect(dorLockBlockedReason(v)).toBeNull();
  });

  it("QC gate blocks qc → client_review without approve", async () => {
    const entity: EntitySnapshot = {
      entityType: "task",
      entityId: "t1",
      state: "qc",
      data: { qcPassed: false },
    };
    const blocked = await transition(
      actor,
      entity,
      { to: "client_review", from: "qc" },
      deps,
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockedBy?.some((b) => b.gate === "task.creative_qc")).toBe(
        true,
      );
    }
  });

  it("QC approve unlocks client_review", async () => {
    const entity: EntitySnapshot = {
      entityType: "task",
      entityId: "t1",
      state: "qc",
      data: { qcPassed: true },
    };
    const ok = await transition(
      actor,
      entity,
      { to: "client_review", from: "qc" },
      deps,
    );
    expect(ok.ok).toBe(true);
  });

  it("T-48h shoot lock flags late shoot changes", async () => {
    const shoot = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    const status = evaluateShootLock({
      shootDate: shoot,
      refApprovalState: "approved",
    });
    expect(status.locked).toBe(true);

    const entity: EntitySnapshot = {
      entityType: "calendar",
      entityId: "c1",
      state: "shoot_locked",
      data: { shootDate: shoot, refApprovalState: "approved" },
    };
    const blocked = await transition(
      actor,
      entity,
      {
        to: "reschedule",
        from: "shoot_locked",
        payload: { changeShootDate: true, newShootDate: "2099-01-01" },
      },
      deps,
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(
        blocked.blockedBy?.some((b) => b.gate === "calendar.t48_shoot_lock"),
      ).toBe(true);
    }
  });

  it("T-24h escalate when ref not approved", () => {
    const shoot = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const status = evaluateShootLock({
      shootDate: shoot,
      refApprovalState: "pending",
    });
    expect(status.escalateT24).toBe(true);
    expect(status.locked).toBe(true);
  });
});
