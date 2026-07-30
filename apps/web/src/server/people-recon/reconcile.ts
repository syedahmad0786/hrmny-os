/**
 * Parallel-payroll reconciliation engine (read-only).
 *
 * Compares a Bayzat-source payroll cycle against the native payroll run for the
 * same period and reports per-employee and total deltas. Pure: no DB, no I/O —
 * the tRPC layer reads both sides and feeds normalized entries in here.
 *
 * Money is compared in fils (integer minor units) via the existing payroll-core
 * helpers so reconciliation uses exactly the same arithmetic as the payroll run.
 */
import { parseBayzatCsv, type BayzatEmployeeRow } from "@hrmny/integrations";
import { filsToMoney, moneyToFils } from "../payroll-core";

const DEFAULT_TOLERANCE_AED = "0.01";

/** Gross/net/allowances/deductions for one employee-cycle, AED money strings. */
export type PayrollFigures = {
  gross: string;
  net: string;
  allowances: string;
  deductions: string;
};

/** One employee's line in a cycle. externalId is the Bayzat mapping key. */
export type PayrollCycleEntry = PayrollFigures & {
  /** Bayzat external id — the reconciliation key. null = native line with no mapping. */
  externalId: string | null;
  /** Native employee uuid when known (native side). */
  employeeId?: string | null;
  displayName?: string;
};

export type ReconCycleRef = {
  periodStart: string;
  periodEnd: string;
  label?: string;
};

export type CycleTotals = PayrollFigures & { headcount: number };

export type PerEmployeeStatus =
  | "match"
  | "delta"
  | "missing_in_native"
  | "missing_in_source"
  | "unmapped";

export type PerEmployeeDelta = {
  externalId: string | null;
  employeeId?: string | null;
  displayName?: string;
  status: PerEmployeeStatus;
  source: PayrollFigures | null;
  native: PayrollFigures | null;
  /** native - source per field; present only when both sides exist. */
  delta: PayrollFigures | null;
  withinTolerance: boolean;
};

export type ReconReport = {
  cycle: ReconCycleRef;
  tolerance: { aed: string; fils: number };
  totals: { source: CycleTotals; native: CycleTotals; delta: CycleTotals };
  headcount: { source: number; native: number; diff: number };
  mappingCoverage: {
    sourceCount: number;
    nativeCount: number;
    matched: number;
    /** External ids in source with no native line. */
    sourceUnmatched: string[];
    /** Native lines with no external id mapping. */
    nativeUnmapped: number;
    coveragePct: number;
  };
  perEmployee: PerEmployeeDelta[];
  missingInNative: string[];
  extraInNative: string[];
  /** Count of per-employee rows outside tolerance (drives the rollback gate). */
  unresolved: number;
  verdict: "pass" | "fail";
  blockers: string[];
  /** Native payroll run actor — carried through for sign-off separation-of-duties. */
  payrollRunActor: string | null;
  generatedAt: string;
};

export type ReconInput = {
  cycle: ReconCycleRef;
  source: PayrollCycleEntry[];
  native: PayrollCycleEntry[];
  toleranceAed?: string;
  payrollRunActor?: string | null;
};

const FIELDS = ["gross", "net", "allowances", "deductions"] as const;

function figuresToFils(f: PayrollFigures) {
  return {
    gross: moneyToFils(f.gross),
    net: moneyToFils(f.net),
    allowances: moneyToFils(f.allowances),
    deductions: moneyToFils(f.deductions),
  };
}

function sumFigures(entries: PayrollFigures[]): PayrollFigures {
  const acc = { gross: 0, net: 0, allowances: 0, deductions: 0 };
  for (const e of entries) {
    const f = figuresToFils(e);
    acc.gross += f.gross;
    acc.net += f.net;
    acc.allowances += f.allowances;
    acc.deductions += f.deductions;
  }
  return {
    gross: filsToMoney(acc.gross),
    net: filsToMoney(acc.net),
    allowances: filsToMoney(acc.allowances),
    deductions: filsToMoney(acc.deductions),
  };
}

type FilsFigures = { gross: number; net: number; allowances: number; deductions: number };

/** native - source, in fils (may be negative). */
function diffFils(native: PayrollFigures, source: PayrollFigures): FilsFigures {
  const n = figuresToFils(native);
  const s = figuresToFils(source);
  return {
    gross: n.gross - s.gross,
    net: n.net - s.net,
    allowances: n.allowances - s.allowances,
    deductions: n.deductions - s.deductions,
  };
}

function filsToFigures(d: FilsFigures): PayrollFigures {
  return {
    gross: filsToMoney(d.gross),
    net: filsToMoney(d.net),
    allowances: filsToMoney(d.allowances),
    deductions: filsToMoney(d.deductions),
  };
}

/** native - source, in AED strings (may be negative). */
function deltaFigures(native: PayrollFigures, source: PayrollFigures): PayrollFigures {
  return filsToFigures(diffFils(native, source));
}

function pickFigures(e: PayrollCycleEntry): PayrollFigures {
  return {
    gross: e.gross,
    net: e.net,
    allowances: e.allowances,
    deductions: e.deductions,
  };
}

/** Index entries by external id, recording duplicates as a hard error. */
function indexByExternalId(entries: PayrollCycleEntry[]) {
  const byId = new Map<string, PayrollCycleEntry>();
  const duplicates: string[] = [];
  const unmapped: PayrollCycleEntry[] = [];
  for (const e of entries) {
    const id = e.externalId?.trim();
    if (!id) {
      unmapped.push(e);
      continue;
    }
    if (byId.has(id)) duplicates.push(id);
    byId.set(id, e);
  }
  return { byId, duplicates, unmapped };
}

/**
 * Reconcile a source (Bayzat) cycle against a native payroll cycle.
 * Verdict is "pass" only when every employee matches within tolerance and there
 * are no missing / extra / unmapped / duplicate records.
 */
export function reconcilePayrollCycle(input: ReconInput): ReconReport {
  const toleranceAed = input.toleranceAed ?? DEFAULT_TOLERANCE_AED;
  const toleranceFils = moneyToFils(toleranceAed);

  const source = indexByExternalId(input.source);
  const native = indexByExternalId(input.native);

  const blockers: string[] = [];
  for (const id of source.duplicates)
    blockers.push(`Duplicate source external id: ${id}`);
  for (const id of native.duplicates)
    blockers.push(`Duplicate native external id: ${id}`);

  const perEmployee: PerEmployeeDelta[] = [];
  const missingInNative: string[] = [];
  const extraInNative: string[] = [];
  const sourceUnmatched: string[] = [];
  let matched = 0;

  const allIds = new Set<string>([...source.byId.keys(), ...native.byId.keys()]);
  for (const id of [...allIds].sort()) {
    const s = source.byId.get(id);
    const n = native.byId.get(id);
    const label = (n ?? s)?.displayName ?? id;

    if (s && n) {
      matched += 1;
      const sf = pickFigures(s);
      const nf = pickFigures(n);
      const dFils = diffFils(nf, sf);
      const delta = filsToFigures(dFils);
      const withinTolerance = FIELDS.every(
        (f) => Math.abs(dFils[f]) <= toleranceFils,
      );
      if (!withinTolerance) {
        for (const f of FIELDS) {
          if (Math.abs(dFils[f]) > toleranceFils) {
            blockers.push(
              `${label} (${id}): ${f} delta ${delta[f]} exceeds tolerance ${toleranceAed}`,
            );
          }
        }
      }
      perEmployee.push({
        externalId: id,
        employeeId: n.employeeId ?? null,
        displayName: label,
        status: withinTolerance ? "match" : "delta",
        source: sf,
        native: nf,
        delta,
        withinTolerance,
      });
    } else if (s && !n) {
      missingInNative.push(id);
      sourceUnmatched.push(id);
      blockers.push(`Missing in native payroll: ${label} (${id})`);
      perEmployee.push({
        externalId: id,
        displayName: label,
        status: "missing_in_native",
        source: pickFigures(s),
        native: null,
        delta: null,
        withinTolerance: false,
      });
    } else if (n && !s) {
      extraInNative.push(id);
      blockers.push(`Extra in native payroll, not in source: ${label} (${id})`);
      perEmployee.push({
        externalId: id,
        employeeId: n.employeeId ?? null,
        displayName: label,
        status: "missing_in_source",
        source: null,
        native: pickFigures(n),
        delta: null,
        withinTolerance: false,
      });
    }
  }

  for (const e of native.unmapped) {
    const label = e.displayName ?? e.employeeId ?? "(unknown)";
    blockers.push(`Native line unmapped to a Bayzat external id: ${label}`);
    perEmployee.push({
      externalId: null,
      employeeId: e.employeeId ?? null,
      displayName: e.displayName,
      status: "unmapped",
      source: null,
      native: pickFigures(e),
      delta: null,
      withinTolerance: false,
    });
  }
  // Source rows without an external id can never be matched — surface them too.
  for (const e of source.unmapped) {
    blockers.push(
      `Source line has no external id: ${e.displayName ?? "(unknown)"}`,
    );
    perEmployee.push({
      externalId: null,
      displayName: e.displayName,
      status: "unmapped",
      source: pickFigures(e),
      native: null,
      delta: null,
      withinTolerance: false,
    });
  }

  const sourceTotals = sumFigures(input.source.map(pickFigures));
  const nativeTotals = sumFigures(input.native.map(pickFigures));
  const totalsDelta = deltaFigures(nativeTotals, sourceTotals);

  const unresolved = perEmployee.filter((r) => !r.withinTolerance).length;
  const verdict: "pass" | "fail" =
    blockers.length === 0 && unresolved === 0 ? "pass" : "fail";

  const sourceCount = input.source.length;
  const nativeCount = input.native.length;

  return {
    cycle: input.cycle,
    tolerance: { aed: toleranceAed, fils: toleranceFils },
    totals: {
      source: { ...sourceTotals, headcount: sourceCount },
      native: { ...nativeTotals, headcount: nativeCount },
      delta: { ...totalsDelta, headcount: nativeCount - sourceCount },
    },
    headcount: {
      source: sourceCount,
      native: nativeCount,
      diff: nativeCount - sourceCount,
    },
    mappingCoverage: {
      sourceCount,
      nativeCount,
      matched,
      sourceUnmatched,
      nativeUnmapped: native.unmapped.length,
      coveragePct:
        sourceCount === 0
          ? 0
          : Math.round((matched / sourceCount) * 10000) / 100,
    },
    perEmployee,
    missingInNative,
    extraInNative,
    unresolved,
    verdict,
    blockers,
    payrollRunActor: input.payrollRunActor ?? null,
    generatedAt: new Date().toISOString(),
  };
}

// --- Source-cycle mapping from a Bayzat payroll CSV export --------------------

const MONEY_RE = /^\d+(?:\.\d{1,2})?$/;
const GROSS_KEYS = ["gross", "gross_pay", "gross_salary", "total_gross"];
const NET_KEYS = ["net", "net_pay", "net_salary", "total_net"];
const ALLOWANCE_KEYS = ["allowances", "total_allowances", "allowance"];
const DEDUCTION_KEYS = ["deductions", "total_deductions", "deduction"];

function pickMoney(raw: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const cleaned = raw[k]?.replace(/[,\s]/g, "");
    if (cleaned && MONEY_RE.test(cleaned)) return cleaned;
  }
  return "0.00";
}

/** Build source cycle entries from parsed Bayzat CSV rows (payroll columns in raw). */
export function sourceEntriesFromBayzatRows(
  rows: BayzatEmployeeRow[],
): PayrollCycleEntry[] {
  return rows.map((row) => ({
    externalId: row.externalId,
    displayName: row.displayName,
    gross: pickMoney(row.raw, GROSS_KEYS),
    net: pickMoney(row.raw, NET_KEYS),
    allowances: pickMoney(row.raw, ALLOWANCE_KEYS),
    deductions: pickMoney(row.raw, DEDUCTION_KEYS),
  }));
}

/** Parse a Bayzat payroll CSV export directly into source cycle entries. */
export function sourceEntriesFromBayzatCsv(csvText: string): PayrollCycleEntry[] {
  return sourceEntriesFromBayzatRows(parseBayzatCsv(csvText));
}
