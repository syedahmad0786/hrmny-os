import { describe, expect, it, beforeEach } from "vitest";
import {
  clearRegistry,
  demoConfirmGate,
  registerGates,
  transition,
  type ActorContext,
  type EntitySnapshot,
  type TransitionDeps,
} from "./index";

describe("gate transition pipeline", () => {
  const actor: ActorContext = {
    employeeId: "11111111-1111-1111-1111-111111111111",
    roles: ["partner"],
    permissions: ["demo.transition"],
  };

  const entity: EntitySnapshot = {
    entityType: "demo",
    entityId: "22222222-2222-2222-2222-222222222222",
    state: "open",
    data: { label: "demo entity" },
  };

  beforeEach(() => {
    clearRegistry();
    registerGates("demo", [demoConfirmGate]);
  });

  it("blocks closed without confirm, then applies + audits when confirmed", async () => {
    const audits: unknown[] = [];
    const emits: unknown[] = [];

    const deps: TransitionDeps = {
      authorize: async () => true,
      apply: async ({ entity: e, request }) => ({
        ...e,
        state: request.to,
        data: { ...e.data, ...request.payload },
      }),
      audit: async (event) => {
        audits.push(event);
        return { auditId: "audit-demo-1" };
      },
      emit: async (event) => {
        emits.push(event);
      },
    };

    const blocked = await transition(actor, entity, { to: "closed" }, deps);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("GATE_BLOCKED");
      expect(blocked.blockedBy?.[0]?.gate).toBe("demo.confirm");
      expect(blocked.auditId).toBe("audit-demo-1");
    }
    expect(audits).toHaveLength(1);
    expect(emits).toHaveLength(1);

    const ok = await transition(
      actor,
      entity,
      { to: "closed", from: "open", payload: { confirmed: true } },
      deps,
    );
    expect(ok).toEqual({
      ok: true,
      newState: "closed",
      auditId: "audit-demo-1",
    });
    expect(audits).toHaveLength(2);
    expect(emits).toHaveLength(2);
  });
});
