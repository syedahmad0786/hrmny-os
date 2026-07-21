import type { GateFn } from "../types";

/**
 * 9-phase employee lifecycle (schema employee_lifecycle_enum).
 * Offer accept spawns hire_packet → … → probation → active.
 */
export const EMPLOYEE_LIFECYCLE_PHASES = [
  "requisition",
  "sourcing",
  "interview",
  "offer",
  "hire_packet",
  "onboarding",
  "probation",
  "active",
  "offboarding",
] as const;

export type EmployeeLifecyclePhase = (typeof EMPLOYEE_LIFECYCLE_PHASES)[number];

export const EMPLOYEE_TRANSITIONS: Record<string, string[]> = {
  requisition: ["sourcing"],
  sourcing: ["interview", "requisition"],
  interview: ["offer", "sourcing"],
  offer: ["hire_packet", "interview"],
  hire_packet: ["onboarding"],
  onboarding: ["probation"],
  probation: ["active", "offboarding"],
  active: ["offboarding"],
  offboarding: [],
};

/** Gate checklist keys required to leave each phase (G1–G9 lite). */
export const PHASE_GATE_REQUIREMENTS: Record<string, string[]> = {
  requisition: ["requisition_approved"],
  sourcing: ["shortlist_ready"],
  interview: ["interview_complete"],
  offer: ["offer_accepted"],
  hire_packet: ["docs_signed", "access_triggered"],
  onboarding: ["week1_checkin"],
  probation: ["probation_decision"],
  active: [],
  offboarding: ["exit_checklist"],
};

export const employeeLegalTransitionGate: GateFn = async ({ entity, request }) => {
  const allowed = EMPLOYEE_TRANSITIONS[entity.state] ?? [];
  if (!allowed.includes(request.to)) {
    return {
      gate: "employee.legal_transition",
      reason: `Illegal HR transition ${entity.state} → ${request.to}. Allowed: [${allowed.join(", ") || "none"}]`,
    };
  }
  return null;
};

export const employeePhaseChecklistGate: GateFn = async ({ entity, request }) => {
  const required = PHASE_GATE_REQUIREMENTS[entity.state] ?? [];
  if (required.length === 0) return null;
  const checklist = (entity.data.checklist ?? {}) as Record<string, boolean>;
  const payloadChecks = (request.payload?.checklist ?? {}) as Record<string, boolean>;
  const merged = { ...checklist, ...payloadChecks };
  const missing = required.filter((k) => !merged[k]);
  if (missing.length > 0) {
    return {
      gate: "employee.phase_gate",
      reason: `Phase ${entity.state} incomplete — missing: ${missing.join(", ")}`,
    };
  }
  return null;
};
