import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import { getDb } from "../db";

export type OnboardingStep = {
  stepId: string;
  title: string;
  raci: string;
  done: boolean;
};

export type OnboardingPhase = {
  phaseId: string;
  phaseIndex: number;
  name: string;
  status: "pending" | "active" | "signed_off";
  signedOffAt: string | null;
  steps: OnboardingStep[];
};

const PHASE_NAMES = [
  "Kickoff & access",
  "Immersion & discovery",
  "Strategy lock",
  "Creative foundations",
  "Channel setup",
  "First delivery sprint",
  "Steady-state handoff",
] as const;

export function seedOnboardingPhases(): OnboardingPhase[] {
  return PHASE_NAMES.map((name, i) => ({
    phaseId: randomUUID(),
    phaseIndex: i,
    name,
    status: i === 0 ? "active" : "pending",
    signedOffAt: null,
    steps: [
      {
        stepId: randomUUID(),
        title: `${name} — RACI owner confirm`,
        raci: i % 2 === 0 ? "AM" : "CS",
        done: false,
      },
      {
        stepId: randomUUID(),
        title: `${name} — artifact upload`,
        raci: "Creative",
        done: false,
      },
    ],
  }));
}

/** Persist seed (idempotent) when a client is created. */
export async function ensureClientOnboarding(
  clientId: string,
): Promise<OnboardingPhase[]> {
  const db = getDb();
  if (!db) return seedOnboardingPhases();
  const existing = await db.execute<{ phases: OnboardingPhase[] }>(sql`
    select phases from public.client_onboarding
    where client_id = ${clientId}::uuid limit 1
  `);
  if (existing[0]?.phases?.length) return existing[0].phases;
  const phases = seedOnboardingPhases();
  await db.execute(sql`
    insert into public.client_onboarding (client_id, phases)
    values (${clientId}::uuid, ${JSON.stringify(phases)}::jsonb)
    on conflict (client_id) do nothing
  `);
  return phases;
}

export async function getClientOnboarding(
  clientId: string,
): Promise<OnboardingPhase[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.execute<{ phases: OnboardingPhase[] }>(sql`
    select phases from public.client_onboarding
    where client_id = ${clientId}::uuid limit 1
  `);
  return rows[0]?.phases ?? [];
}

export async function signoffOnboardingPhase(input: {
  clientId: string;
  phaseIndex: number;
}): Promise<{ advanced: boolean; phases: OnboardingPhase[] } | null> {
  const db = getDb();
  if (!db) return null;
  const phases = await getClientOnboarding(input.clientId);
  if (!phases.length) return null;
  const phase = phases.find((p) => p.phaseIndex === input.phaseIndex);
  if (!phase) return null;
  if (phase.status !== "active" && phase.status !== "signed_off") {
    return null;
  }
  if (phase.status === "signed_off") {
    return { advanced: false, phases };
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
  await db.execute(sql`
    update public.client_onboarding
    set phases = ${JSON.stringify(phases)}::jsonb, updated_at = now()
    where client_id = ${input.clientId}::uuid
  `);
  const { persistMemoryChunk } = await import("../ai/memory-db");
  await persistMemoryChunk({
    sourceType: "feedback",
    sourceId: input.clientId,
    content: `Onboarding phase signed off: ${phase.name} (index ${phase.phaseIndex}).${
      advanced && next ? ` Advanced to ${next.name}.` : ""
    }`,
    metadata: {
      clientId: input.clientId,
      kind: "onboarding.phase_signoff",
      phaseIndex: input.phaseIndex,
    },
  });
  return { advanced, phases };
}
