/**
 * Shared OS onboarding phase signoff (active → signed_off, advance next).
 * Used by agent `onboarding.os_signoff` and mirrors staff
 * `clients.onboarding.signoff` (durable + memory).
 */
import { getDemoStore } from "../demo-store";
import { getDb } from "../db";
import { signoffOnboardingPhase } from "./onboarding";

export type OsOnboardingSignoffResult = {
  ok: boolean;
  reason?: string;
  clientId: string;
  phaseIndex: number;
  advanced?: boolean;
  phaseName?: string;
  nextPhaseName?: string | null;
  phases?: unknown[];
};

export async function signoffOsOnboardingPhase(input: {
  clientId: string;
  phaseIndex: number;
  actorEmployeeId?: string | null;
}): Promise<OsOnboardingSignoffResult> {
  const durable = await signoffOnboardingPhase({
    clientId: input.clientId,
    phaseIndex: input.phaseIndex,
  });
  if (durable) {
    const phase = durable.phases.find(
      (p) => p.phaseIndex === input.phaseIndex,
    );
    const next = durable.phases.find(
      (p) => p.phaseIndex === input.phaseIndex + 1,
    );
    return {
      ok: true,
      clientId: input.clientId,
      phaseIndex: input.phaseIndex,
      advanced: durable.advanced,
      phaseName: phase?.name,
      nextPhaseName: next?.name ?? null,
      phases: durable.phases,
    };
  }

  if (getDb()) {
    return {
      ok: false,
      reason: "NOT_FOUND",
      clientId: input.clientId,
      phaseIndex: input.phaseIndex,
    };
  }

  const store = getDemoStore();
  const phases = store.onboarding.get(input.clientId);
  if (!phases) {
    return {
      ok: false,
      reason: "NOT_FOUND",
      clientId: input.clientId,
      phaseIndex: input.phaseIndex,
    };
  }
  const phase = phases.find((p) => p.phaseIndex === input.phaseIndex);
  if (!phase) {
    return {
      ok: false,
      reason: "NOT_FOUND",
      clientId: input.clientId,
      phaseIndex: input.phaseIndex,
    };
  }
  if (phase.status === "signed_off") {
    return {
      ok: true,
      clientId: input.clientId,
      phaseIndex: input.phaseIndex,
      advanced: false,
      phaseName: phase.name,
      nextPhaseName: null,
      phases,
    };
  }
  if (phase.status !== "active") {
    return {
      ok: false,
      reason: `phase_not_active:${phase.status}`,
      clientId: input.clientId,
      phaseIndex: input.phaseIndex,
    };
  }

  phase.status = "signed_off";
  phase.signedOffAt = new Date().toISOString();
  phase.steps = phase.steps.map((s) => ({ ...s, done: true }));
  const next = phases.find((p) => p.phaseIndex === input.phaseIndex + 1);
  let advanced = false;
  if (next) {
    next.status = "active";
    advanced = true;
  }
  store.onboarding.set(input.clientId, [...phases]);
  store.appendAudit({
    actorEmployeeId:
      input.actorEmployeeId ?? "c0000000-0000-4000-8000-000000000001",
    action: "clients.onboarding.signoff",
    entityType: "onboarding_phase",
    entityId: phase.phaseId,
    before: null,
    after: {
      phaseIndex: input.phaseIndex,
      advanced,
      via: "onboarding.os_signoff",
    },
    reason: null,
  });

  return {
    ok: true,
    clientId: input.clientId,
    phaseIndex: input.phaseIndex,
    advanced,
    phaseName: phase.name,
    nextPhaseName: next?.name ?? null,
    phases: store.onboarding.get(input.clientId),
  };
}

export function parseClientIdFromPrompt(prompt: string): string | null {
  const labeled = prompt.match(
    /client(?:Id)?\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (labeled?.[1]) return labeled[1].toLowerCase();
  // Do not grab a bare UUID — settle prompts carry many IDs; prefer loopSeed.
  return null;
}

export function parsePhaseIndexFromPrompt(prompt: string): number | null {
  const labeled = prompt.match(/phase(?:Index)?\s*[:=]\s*(\d+)/i);
  if (labeled?.[1] != null) {
    const n = Number(labeled[1]);
    return Number.isFinite(n) ? n : null;
  }
  const spoken = prompt.match(/phase\s+(\d+)/i);
  if (spoken?.[1] != null) {
    const n = Number(spoken[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
