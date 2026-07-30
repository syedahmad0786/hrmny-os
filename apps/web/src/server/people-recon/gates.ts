/**
 * Retirement readiness gates for Bayzat cutover (pure).
 *
 * These encode the BAYZAT-REPLACEMENT-PLAN cutover gate: "Payroll signs off at
 * least two parallel payroll cycles" with "zero unexplained net-pay differences",
 * plus maker/checker separation on the sign-off itself.
 */

const DEFAULT_MIN_PARALLEL_CYCLES = 2;

export type RollbackGateInput = {
  parallelCyclesPassed: number;
  unresolvedDeltas: number;
  signoffRecorded: boolean;
  /** Cutover requires at least this many passed parallel cycles. Default 2. */
  minParallelCycles?: number;
};

export type RollbackGateResult = {
  ready: boolean;
  blockers: string[];
};

/** Evaluate whether Bayzat can be retired. Ready only when every gate passes. */
export function evaluateRollbackGate(
  input: RollbackGateInput,
): RollbackGateResult {
  const min = input.minParallelCycles ?? DEFAULT_MIN_PARALLEL_CYCLES;
  const blockers: string[] = [];

  if (input.parallelCyclesPassed < min) {
    blockers.push(
      `Need ${min} passed parallel payroll cycles; have ${input.parallelCyclesPassed}`,
    );
  }
  if (input.unresolvedDeltas > 0) {
    blockers.push(
      `${input.unresolvedDeltas} unresolved reconciliation delta(s) must be zero`,
    );
  }
  if (!input.signoffRecorded) {
    blockers.push("Payroll sign-off has not been recorded");
  }

  return { ready: blockers.length === 0, blockers };
}

export type SignoffEvaluation =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Separation-of-duties check for a reconciliation sign-off: the actor recording
 * the sign-off must not be the actor who executed the native payroll run, and a
 * failing cycle can never be signed off.
 */
export function evaluateSignoff(input: {
  signoffActor: string;
  payrollRunActor: string | null;
  verdict: "pass" | "fail";
}): SignoffEvaluation {
  if (input.verdict !== "pass") {
    return {
      allowed: false,
      reason: "Cannot sign off a reconciliation that did not pass",
    };
  }
  if (
    input.payrollRunActor &&
    input.signoffActor === input.payrollRunActor
  ) {
    return {
      allowed: false,
      reason:
        "Separation of duties: the payroll run actor cannot sign off their own reconciliation",
    };
  }
  return { allowed: true };
}
