/**
 * In-memory store for reconciliation reports and sign-offs.
 *
 * ponytail: process-memory only, no persistence. Reconciliation output is not a
 * domain table and this harness must not add migrations. Swap for a
 * `payroll_reconciliation` table + audit-backed sign-off when reports need to
 * survive restarts or be shared across instances.
 */
import type { ReconReport } from "./reconcile";
import { type RollbackGateInput } from "./gates";

export type SignoffRecord = {
  actor: string;
  at: string;
  note?: string;
};

type StoredCycle = {
  report: ReconReport;
  signoff: SignoffRecord | null;
};

function cycleKey(periodStart: string, periodEnd: string): string {
  return `${periodStart}..${periodEnd}`;
}

const cycles = new Map<string, StoredCycle>();
let latestKey: string | null = null;

export const reconStore = {
  save(report: ReconReport): void {
    const key = cycleKey(report.cycle.periodStart, report.cycle.periodEnd);
    // Re-running a cycle replaces its report but preserves an existing sign-off
    // only when the new report still passes; otherwise the sign-off is cleared.
    const prior = cycles.get(key);
    const signoff =
      prior?.signoff && report.verdict === "pass" ? prior.signoff : null;
    cycles.set(key, { report, signoff });
    latestKey = key;
  },

  get(periodStart: string, periodEnd: string): StoredCycle | null {
    return cycles.get(cycleKey(periodStart, periodEnd)) ?? null;
  },

  latest(): StoredCycle | null {
    return latestKey ? (cycles.get(latestKey) ?? null) : null;
  },

  recordSignoff(
    periodStart: string,
    periodEnd: string,
    signoff: SignoffRecord,
  ): StoredCycle | null {
    const key = cycleKey(periodStart, periodEnd);
    const stored = cycles.get(key);
    if (!stored) return null;
    stored.signoff = signoff;
    return stored;
  },

  /** Derive rollback-gate inputs from every stored cycle. */
  readiness(minParallelCycles = 2): RollbackGateInput {
    const all = [...cycles.values()];
    return {
      minParallelCycles,
      parallelCyclesPassed: all.filter((c) => c.report.verdict === "pass")
        .length,
      unresolvedDeltas: all.reduce((n, c) => n + c.report.unresolved, 0),
      signoffRecorded:
        all.filter((c) => c.signoff).length >= minParallelCycles,
    };
  },

  /** Test hook — reset the in-memory store. */
  _reset(): void {
    cycles.clear();
    latestKey = null;
  },
};
