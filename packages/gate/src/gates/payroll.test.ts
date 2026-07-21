import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapGateRegistry } from "../bootstrap";
import { transition } from "../transition";
import type { ActorContext, EntitySnapshot } from "../types";

const hr: ActorContext = {
  employeeId: "hr-1",
  roles: ["hr"],
  permissions: [],
};
const partner: ActorContext = {
  employeeId: "partner-1",
  roles: ["partner"],
  permissions: [],
};

beforeAll(() => {
  bootstrapGateRegistry();
});

describe("Payroll SoD scaffolding", () => {
  it("blocks HR from approving own confirmation", async () => {
    const entity: EntitySnapshot = {
      entityType: "payroll_run",
      entityId: "pr1",
      state: "hr_confirmed",
      data: { confirmedByEmployeeId: "hr-1" },
    };
    const result = await transition(hr, entity, { to: "director_approved" }, {
      authorize: async () => true,
      apply: async () => entity,
      audit: async () => ({ auditId: "x" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.blockedBy?.some((b) => b.gate === "payroll.sod_separation"),
      ).toBe(true);
    }
  });

  it("blocks disbursement flag on post", async () => {
    const entity: EntitySnapshot = {
      entityType: "payroll_run",
      entityId: "pr2",
      state: "director_approved",
      data: { confirmedByEmployeeId: "hr-1" },
    };
    const result = await transition(
      partner,
      entity,
      { to: "posted", payload: { disburse: true } },
      {
        authorize: async () => true,
        apply: async () => entity,
        audit: async () => ({ auditId: "y" }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.blockedBy?.some((b) => b.gate === "payroll.never_disburse"),
      ).toBe(true);
    }
  });
});
