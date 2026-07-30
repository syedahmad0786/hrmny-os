import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import {
  getDemoStore,
  type DemoOnboardingPhase,
  type DemoOnboardingStep,
} from "../demo-store";
import { getDb } from "../db";

const ONBOARDING_PHASE_NAMES = [
  "Kickoff & access",
  "Immersion & discovery",
  "Strategy lock",
  "Creative foundations",
  "Channel setup",
  "First delivery sprint",
  "Steady-state handoff",
] as const;

type PhaseRow = {
  phase_id: string;
  client_id: string;
  phase_index: number;
  name: string;
  status: DemoOnboardingPhase["status"];
  steps: DemoOnboardingStep[] | null;
  signed_off_at: Date | string | null;
};

function seedPhases(): DemoOnboardingPhase[] {
  return ONBOARDING_PHASE_NAMES.map((name, i) => ({
    phaseId: randomUUID(),
    phaseIndex: i,
    name,
    status: i === 0 ? ("active" as const) : ("pending" as const),
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

function mapPhase(row: PhaseRow): DemoOnboardingPhase {
  return {
    phaseId: row.phase_id,
    phaseIndex: row.phase_index,
    name: row.name,
    status: row.status,
    signedOffAt: row.signed_off_at
      ? new Date(row.signed_off_at).toISOString()
      : null,
    steps: Array.isArray(row.steps) ? row.steps : [],
  };
}

export async function getOnboarding(
  clientId: string,
): Promise<DemoOnboardingPhase[]> {
  const db = getDb();
  if (!db) return getDemoStore().onboarding.get(clientId) ?? [];

  const rows = (await db.execute(sql`
    select phase_id, client_id, phase_index, name, status, steps, signed_off_at
    from public.client_onboarding_phase
    where client_id = ${clientId}::uuid
    order by phase_index asc
  `)) as unknown as PhaseRow[];
  return rows.map(mapPhase);
}

export async function saveOnboarding(
  clientId: string,
  phases: DemoOnboardingPhase[],
): Promise<DemoOnboardingPhase[]> {
  const db = getDb();
  if (!db) {
    getDemoStore().onboarding.set(clientId, phases);
    return phases;
  }

  await db.execute(sql`
    delete from public.client_onboarding_phase
    where client_id = ${clientId}::uuid
  `);

  for (const phase of phases) {
    await db.execute(sql`
      insert into public.client_onboarding_phase (
        phase_id, client_id, phase_index, name, status, steps, signed_off_at
      ) values (
        ${phase.phaseId}::uuid,
        ${clientId}::uuid,
        ${phase.phaseIndex},
        ${phase.name},
        ${phase.status},
        ${JSON.stringify(phase.steps)}::jsonb,
        ${phase.signedOffAt}::timestamptz
      )
    `);
  }
  return phases;
}

/** Return existing phases, or seed the 7-phase pack if none. */
export async function ensureOnboarding(
  clientId: string,
): Promise<DemoOnboardingPhase[]> {
  const existing = await getOnboarding(clientId);
  if (existing.length > 0) return existing;
  return saveOnboarding(clientId, seedPhases());
}
