import type { GateFn } from "../types";

/**
 * Payroll Module E (M5 money loop).
 * HR confirms ≠ Director/partner approves; JE post only — never disburse.
 */
export const PAYROLL_TRANSITIONS: Record<string, string[]> = {
  draft: ["hr_confirmed", "void"],
  hr_confirmed: ["director_approved", "draft"],
  director_approved: ["posted", "void"],
  posted: [],
  void: [],
};

export const payrollLegalTransitionGate: GateFn = async ({ entity, request }) => {
  const allowed = PAYROLL_TRANSITIONS[entity.state] ?? [];
  if (!allowed.includes(request.to)) {
    return {
      gate: "payroll.legal_transition",
      reason: `Illegal payroll transition ${entity.state} → ${request.to}`,
    };
  }
  return null;
};

export const payrollSodGate: GateFn = async ({ actor, entity, request }) => {
  if (request.to === "hr_confirmed") {
    const isHr = actor.roles.some((r) => ["hr", "partner"].includes(r));
    if (!isHr) {
      return {
        gate: "payroll.sod_confirm",
        reason: "Only HR (or partner standing in) may confirm payroll",
      };
    }
  }

  if (request.to === "director_approved") {
    const confirmedBy = entity.data.confirmedByEmployeeId as string | undefined;
    if (confirmedBy && confirmedBy === actor.employeeId) {
      return {
        gate: "payroll.sod_separation",
        reason: "SoD: confirmer cannot approve the same payroll run",
      };
    }
    const isDirector = actor.roles.some((r) =>
      ["director", "partner"].includes(r),
    );
    if (!isDirector) {
      return {
        gate: "payroll.sod_approve",
        reason: "Only Director/partner may approve payroll",
      };
    }
  }

  if (request.to === "posted") {
    if (entity.state !== "director_approved") {
      return {
        gate: "payroll.post_order",
        reason: "Payroll must be director-approved before Xero JE post",
      };
    }
    if (request.payload?.disburse === true) {
      return {
        gate: "payroll.never_disburse",
        reason: "OS never disburses money — JE post only",
      };
    }
  }

  return null;
};
