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


async function resolveStaffForClient(clientId: string): Promise<string | null> {
  const db = getDb();
  if (!db) {
    const { DEMO_EMPLOYEE_ID } = await import("../demo-store");
    return DEMO_EMPLOYEE_ID;
  }
  try {
    const leads = await db.execute<{ employeeId: string }>(sql`
      select employee_id as "employeeId"
      from public.account_team_member
      where client_id = ${clientId}::uuid
        and is_account_lead = true
      order by created_at asc
      limit 1
    `);
    if (leads[0]?.employeeId) return leads[0].employeeId;
    const anyStaff = await db.execute<{ employeeId: string }>(sql`
      select employee_id as "employeeId"
      from public.employee
      where is_active = true
      order by created_at asc
      limit 1
    `);
    return anyStaff[0]?.employeeId ?? null;
  } catch {
    return null;
  }
}

/** Staff OS inbox after client (or staff) signs off an onboarding phase. */
export async function notifyStaffOfOnboardingSignoff(input: {
  clientId: string;
  phaseName: string;
  phaseIndex: number;
  advanced: boolean;
  nextPhaseName?: string | null;
}): Promise<void> {
  const employeeId = await resolveStaffForClient(input.clientId);
  if (!employeeId) return;
  const nextBit =
    input.advanced && input.nextPhaseName
      ? ` Next up: ${input.nextPhaseName}.`
      : "";
  const { notifyEmployee } = await import("../notifications/store");
  await notifyEmployee({
    employeeId,
    title: `Onboarding signed off: ${input.phaseName}`,
    body: `Phase ${input.phaseIndex + 1} ("${input.phaseName}") was acknowledged.${nextBit}`,
    kind: "onboarding",
    href: `/clients/${input.clientId}`,
    entityType: "client",
    entityId: input.clientId,
  }).catch(() => undefined);
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
  const employeeId = await resolveStaffForClient(input.clientId);
  const { persistMemoryChunk } = await import("../ai/memory-db");
  await persistMemoryChunk({
    sourceType: "feedback",
    sourceId: input.clientId,
    content: `Onboarding phase signed off: ${phase.name} (index ${phase.phaseIndex}).${
      advanced && next ? ` Advanced to ${next.name}.` : ""
    }`,
    metadata: {
      clientId: input.clientId,
      employeeId: employeeId ?? undefined,
      kind: "onboarding.phase_signoff",
      phaseIndex: input.phaseIndex,
    },
  });
  await notifyStaffOfOnboardingSignoff({
    clientId: input.clientId,
    phaseName: phase.name,
    phaseIndex: input.phaseIndex,
    advanced,
    nextPhaseName: next?.name ?? null,
  });
  return { advanced, phases };
}
