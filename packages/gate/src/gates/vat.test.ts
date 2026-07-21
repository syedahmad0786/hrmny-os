import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapGateRegistry } from "../bootstrap";
import { transition } from "../transition";
import type { ActorContext, EntitySnapshot } from "../types";

const finance: ActorContext = {
  employeeId: "fin-1",
  roles: ["finance"],
  permissions: [],
};

beforeAll(() => {
  bootstrapGateRegistry();
});

describe("VAT close gates", () => {
  it("blocks close when unread docs remain", async () => {
    const entity: EntitySnapshot = {
      entityType: "vat_period",
      entityId: "2026-07",
      state: "open",
      data: { unreadDocIds: ["doc-1"] },
    };
    const result = await transition(finance, entity, { to: "closed" }, {
      authorize: async () => true,
      apply: async () => entity,
      audit: async () => ({ auditId: "v1" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockedBy?.some((b) => b.gate === "vat.unread_docs")).toBe(
        true,
      );
    }
  });

  it("allows close when all docs read", async () => {
    const entity: EntitySnapshot = {
      entityType: "vat_period",
      entityId: "2026-07",
      state: "open",
      data: { unreadDocIds: [] },
    };
    const result = await transition(finance, entity, { to: "closed" }, {
      authorize: async () => true,
      apply: async () => ({ ...entity, state: "closed" }),
      audit: async () => ({ auditId: "v2" }),
    });
    expect(result.ok).toBe(true);
  });
});
