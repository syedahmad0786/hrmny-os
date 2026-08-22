/**
 * Shared OS Month-1 phase advance (active → done, next → active).
 * Used by agent `clients.os_month1_advance` and mirrors staff
 * `clients.month1.transition` (durable onboarding map + memory month1).
 */
import { getDemoStore, seedMonth1Phases } from "../demo-store";
import { getDb } from "../db";
import {
  ensureClientOnboarding,
  getClientOnboarding,
  signoffOnboardingPhase,
} from "./onboarding";
import { parseClientIdFromPrompt, parsePhaseIndexFromPrompt } from "./os-onboarding-signoff";

export type OsMonth1AdvanceResult = {
  ok: boolean;
  reason?: string;
  code?: string;
  clientId: string;
  fromPhase: number;
  toPhase: number;
  phases?: Array<{
    phaseIndex: number;
    name: string;
    status: "pending" | "active" | "done";
    gate: string;
  }>;
};

export async function advanceOsMonth1(input: {
  clientId: string;
  /** Target phase index (active + 1). Defaults to next after active. */
  toPhase?: number;
  actorEmployeeId?: string | null;
}): Promise<OsMonth1AdvanceResult> {
  const clientId = input.clientId;

  if (getDb()) {
    let phases = await getClientOnboarding(clientId);
    if (!phases.length) {
      phases = await ensureClientOnboarding(clientId);
    }
    const active = phases.find((p) => p.status === "active");
    if (!active) {
      return {
        ok: false,
        reason: "NO_ACTIVE_PHASE",
        code: "NO_ACTIVE_PHASE",
        clientId,
        fromPhase: -1,
        toPhase: input.toPhase ?? -1,
      };
    }
    const toPhase = input.toPhase ?? active.phaseIndex + 1;
    if (toPhase !== active.phaseIndex + 1 && toPhase !== active.phaseIndex) {
      return {
        ok: false,
        code: "GATE_BLOCKED",
        reason: `Month-1 gate: advance only to next phase (active P${active.phaseIndex})`,
        clientId,
        fromPhase: active.phaseIndex,
        toPhase,
      };
    }
    if (toPhase === active.phaseIndex + 1) {
      const signed = await signoffOnboardingPhase({
        clientId,
        phaseIndex: active.phaseIndex,
      });
      phases = signed?.phases ?? phases;
    }
    return {
      ok: true,
      clientId,
      fromPhase: active.phaseIndex,
      toPhase,
      phases: phases.map((p) => ({
        phaseIndex: p.phaseIndex,
        name: p.name,
        status:
          p.status === "signed_off"
            ? ("done" as const)
            : (p.status as "active" | "pending"),
        gate: `month1.g${p.phaseIndex}`,
      })),
    };
  }

  const store = getDemoStore();
  let phases = store.month1.get(clientId);
  if (!phases?.length) {
    // Closed-loop clients historically missed month1 seed — heal on advance.
    if (!store.clients.get(clientId)) {
      return {
        ok: false,
        reason: "NOT_FOUND",
        code: "NOT_FOUND",
        clientId,
        fromPhase: -1,
        toPhase: input.toPhase ?? -1,
      };
    }
    phases = seedMonth1Phases();
    store.month1.set(clientId, phases);
  }
  const active = phases.find((p) => p.status === "active");
  if (!active) {
    return {
      ok: false,
      reason: "NO_ACTIVE_PHASE",
      code: "NO_ACTIVE_PHASE",
      clientId,
      fromPhase: -1,
      toPhase: input.toPhase ?? -1,
    };
  }
  const toPhase = input.toPhase ?? active.phaseIndex + 1;
  if (toPhase !== active.phaseIndex + 1 && toPhase !== active.phaseIndex) {
    return {
      ok: false,
      code: "GATE_BLOCKED",
      reason: `Month-1 gate: advance only to next phase (active P${active.phaseIndex})`,
      clientId,
      fromPhase: active.phaseIndex,
      toPhase,
    };
  }
  if (toPhase === active.phaseIndex + 1) {
    active.status = "done";
    const next = phases.find((p) => p.phaseIndex === toPhase);
    if (next) next.status = "active";
  }
  store.month1.set(clientId, [...phases]);
  store.appendAudit({
    actorEmployeeId:
      input.actorEmployeeId ?? "c0000000-0000-4000-8000-000000000001",
    action: "clients.month1.transition",
    entityType: "client",
    entityId: clientId,
    before: null,
    after: { toPhase, via: "clients.os_month1_advance" },
    reason: null,
  });
  return {
    ok: true,
    clientId,
    fromPhase: active.phaseIndex,
    toPhase,
    phases,
  };
}

export { parseClientIdFromPrompt, parsePhaseIndexFromPrompt };
