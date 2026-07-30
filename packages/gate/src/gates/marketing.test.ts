import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapGateRegistry } from "../bootstrap";
import { transition } from "../transition";
import type { ActorContext, EntitySnapshot } from "../types";

const staff: ActorContext = {
  employeeId: "sales-1",
  roles: ["account_manager"],
  permissions: [],
};
const client: ActorContext = {
  employeeId: "portal-1",
  roles: ["portal_client"],
  permissions: [],
};

const deps = (next: EntitySnapshot) => ({
  authorize: async () => true,
  apply: async () => next,
  audit: async () => ({ auditId: "m1" }),
});

beforeAll(() => {
  bootstrapGateRegistry();
});

describe("outreach send gates", () => {
  it("blocks send straight from draft (approve required first)", async () => {
    const entity: EntitySnapshot = {
      entityType: "outreach",
      entityId: "o-1",
      state: "draft",
      data: {},
    };
    const result = await transition(staff, entity, { to: "sent" }, deps(entity));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Illegal-transition gate fires first; approve-before-send backs it up.
      expect(
        result.blockedBy?.some((b) => b.gate.startsWith("outreach.")),
      ).toBe(true);
    }
  });

  it("allows send once approved", async () => {
    const entity: EntitySnapshot = {
      entityType: "outreach",
      entityId: "o-1",
      state: "approved",
      data: {},
    };
    const result = await transition(
      staff,
      entity,
      { to: "sent" },
      deps({ ...entity, state: "sent" }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("campaign publish gate", () => {
  it("blocks publish before approve", async () => {
    const entity: EntitySnapshot = {
      entityType: "campaign",
      entityId: "c-1",
      state: "draft",
      data: {},
    };
    const result = await transition(
      staff,
      entity,
      { to: "published" },
      deps(entity),
    );
    expect(result.ok).toBe(false);
  });
});

describe("portal item client approver gate", () => {
  it("blocks a staff actor from approving a client item", async () => {
    const entity: EntitySnapshot = {
      entityType: "portal_item",
      entityId: "p-1",
      state: "pending_client",
      data: {},
    };
    const result = await transition(
      staff,
      entity,
      { to: "approved" },
      deps({ ...entity, state: "approved" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.blockedBy?.some((b) => b.gate === "portal_item.client_approver"),
      ).toBe(true);
    }
  });

  it("allows the client (portal actor) to approve", async () => {
    const entity: EntitySnapshot = {
      entityType: "portal_item",
      entityId: "p-1",
      state: "pending_client",
      data: {},
    };
    const result = await transition(
      client,
      entity,
      { to: "approved" },
      deps({ ...entity, state: "approved" }),
    );
    expect(result.ok).toBe(true);
  });
});
