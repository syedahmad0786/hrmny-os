import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapGateRegistry } from "../bootstrap";
import { transition } from "../transition";
import type { ActorContext, EntitySnapshot } from "../types";

const hr: ActorContext = {
  employeeId: "c0000000-0000-4000-8000-000000000010",
  roles: ["hr"],
  permissions: ["allow:*:*"],
};

beforeAll(() => {
  bootstrapGateRegistry();
});

describe("HR phase transition gates", () => {
  it("blocks skip from offer to active", async () => {
    const entity: EntitySnapshot = {
      entityType: "employee",
      entityId: "e1",
      state: "offer",
      data: { checklist: { offer_accepted: true } },
    };
    const result = await transition(hr, entity, { to: "active" }, {
      authorize: async () => true,
      apply: async () => entity,
      audit: async () => ({ auditId: "a1" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockedBy?.some((b) => b.gate === "employee.legal_transition")).toBe(
        true,
      );
    }
  });

  it("blocks hire_packet without checklist; allows when complete", async () => {
    const base: EntitySnapshot = {
      entityType: "employee",
      entityId: "e2",
      state: "hire_packet",
      data: { checklist: {} },
    };
    const blocked = await transition(hr, base, { to: "onboarding" }, {
      authorize: async () => true,
      apply: async () => base,
      audit: async () => ({ auditId: "a2" }),
    });
    expect(blocked.ok).toBe(false);

    const ready: EntitySnapshot = {
      ...base,
      data: { checklist: { docs_signed: true, access_triggered: true } },
    };
    const ok = await transition(hr, ready, { to: "onboarding" }, {
      authorize: async () => true,
      apply: async ({ request }) => ({ ...ready, state: request.to }),
      audit: async () => ({ auditId: "a3" }),
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.newState).toBe("onboarding");
  });
});
