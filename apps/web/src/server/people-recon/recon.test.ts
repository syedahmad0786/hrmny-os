import { describe, expect, it } from "vitest";
import {
  reconcilePayrollCycle,
  sourceEntriesFromBayzatCsv,
  type PayrollCycleEntry,
} from "./reconcile";
import { evaluateRollbackGate, evaluateSignoff } from "./gates";

const CYCLE = { periodStart: "2026-06-01", periodEnd: "2026-06-30", label: "Jun" };

function src(
  externalId: string,
  gross: string,
  net: string,
  allowances: string,
  deductions: string,
  displayName?: string,
): PayrollCycleEntry {
  return { externalId, gross, net, allowances, deductions, displayName };
}

function nat(
  externalId: string | null,
  gross: string,
  net: string,
  allowances: string,
  deductions: string,
  displayName?: string,
): PayrollCycleEntry {
  return {
    externalId,
    employeeId: externalId ? `emp-${externalId}` : "emp-x",
    gross,
    net,
    allowances,
    deductions,
    displayName,
  };
}

const ALICE_S = src("E1", "10000.00", "9500.00", "3000.00", "500.00", "Alice");
const BOB_S = src("E2", "8000.00", "7700.00", "2000.00", "300.00", "Bob");
const ALICE_N = nat("E1", "10000.00", "9500.00", "3000.00", "500.00", "Alice");
const BOB_N = nat("E2", "8000.00", "7700.00", "2000.00", "300.00", "Bob");

describe("reconcilePayrollCycle", () => {
  it("passes when every employee matches within tolerance", () => {
    const report = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [ALICE_S, BOB_S],
      native: [ALICE_N, BOB_N],
    });
    expect(report.verdict).toBe("pass");
    expect(report.unresolved).toBe(0);
    expect(report.blockers).toEqual([]);
    expect(report.headcount).toEqual({ source: 2, native: 2, diff: 0 });
    expect(report.mappingCoverage.matched).toBe(2);
    expect(report.mappingCoverage.coveragePct).toBe(100);
    expect(report.totals.source.net).toBe("17200.00");
    expect(report.totals.native.net).toBe("17200.00");
    expect(report.totals.delta.net).toBe("0.00");
  });

  it("fails and names the employee when one salary differs", () => {
    const bobShort = nat("E2", "8000.00", "7650.00", "2000.00", "300.00", "Bob");
    const report = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [ALICE_S, BOB_S],
      native: [ALICE_N, bobShort],
    });
    expect(report.verdict).toBe("fail");
    expect(report.unresolved).toBe(1);
    const bobRow = report.perEmployee.find((r) => r.externalId === "E2");
    expect(bobRow?.status).toBe("delta");
    expect(bobRow?.delta?.net).toBe("-50.00");
    expect(report.blockers.some((b) => b.includes("Bob") && b.includes("E2"))).toBe(
      true,
    );
    expect(report.totals.delta.net).toBe("-50.00");
  });

  it("fails and flags a missing employee", () => {
    const report = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [ALICE_S, BOB_S],
      native: [ALICE_N],
    });
    expect(report.verdict).toBe("fail");
    expect(report.missingInNative).toEqual(["E2"]);
    expect(report.headcount.diff).toBe(-1);
    expect(report.blockers.some((b) => b.includes("Missing in native"))).toBe(
      true,
    );
  });

  it("fails and flags an extra native employee not in source", () => {
    const charlie = nat("E9", "5000.00", "5000.00", "0.00", "0.00", "Charlie");
    const report = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [ALICE_S],
      native: [ALICE_N, charlie],
    });
    expect(report.verdict).toBe("fail");
    expect(report.extraInNative).toEqual(["E9"]);
  });

  it("fails and reports coverage when a native line is unmapped", () => {
    const ghost = nat(null, "4000.00", "4000.00", "0.00", "0.00", "Ghost");
    const report = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [ALICE_S],
      native: [ALICE_N, ghost],
    });
    expect(report.verdict).toBe("fail");
    expect(report.mappingCoverage.nativeUnmapped).toBe(1);
    expect(report.perEmployee.some((r) => r.status === "unmapped")).toBe(true);
  });

  it("treats exactly-tolerance as pass and one fil over as fail", () => {
    const atEdge = nat("E1", "10000.00", "9500.01", "3000.00", "500.00", "Alice");
    const overEdge = nat("E1", "10000.00", "9500.02", "3000.00", "500.00", "Alice");

    const pass = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [ALICE_S],
      native: [atEdge],
    });
    expect(pass.verdict).toBe("pass");

    const fail = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [ALICE_S],
      native: [overEdge],
    });
    expect(fail.verdict).toBe("fail");
  });

  it("honours a zero-tolerance config", () => {
    const atEdge = nat("E1", "10000.00", "9500.01", "3000.00", "500.00", "Alice");
    const report = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [ALICE_S],
      native: [atEdge],
      toleranceAed: "0.00",
    });
    expect(report.verdict).toBe("fail");
  });

  it("flags duplicate source external ids", () => {
    const report = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [ALICE_S, ALICE_S],
      native: [ALICE_N],
    });
    expect(report.verdict).toBe("fail");
    expect(report.blockers.some((b) => b.includes("Duplicate source"))).toBe(true);
  });
});

describe("sourceEntriesFromBayzatCsv", () => {
  it("maps payroll columns and sanitizes thousands separators", () => {
    const csv = [
      "external_id,display_name,email,gross,net,allowances,deductions",
      "E1,Alice,alice@x.co,10000.00,9500.00,3000.00,500.00",
      'E2,Bob,bob@x.co,"8,000.00","7,700.00","2,000.00",300.00',
    ].join("\n");
    const entries = sourceEntriesFromBayzatCsv(csv);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      externalId: "E1",
      gross: "10000.00",
      net: "9500.00",
      allowances: "3000.00",
      deductions: "500.00",
    });
    expect(entries[1]).toMatchObject({ externalId: "E2", gross: "8000.00" });
  });

  it("round-trips a Bayzat CSV cycle to a passing reconciliation", () => {
    const csv = [
      "external_id,display_name,email,gross,net,allowances,deductions",
      "E1,Alice,alice@x.co,10000.00,9500.00,3000.00,500.00",
    ].join("\n");
    const report = reconcilePayrollCycle({
      cycle: CYCLE,
      source: sourceEntriesFromBayzatCsv(csv),
      native: [ALICE_N],
    });
    expect(report.verdict).toBe("pass");
  });
});

describe("evaluateRollbackGate", () => {
  it("is ready only when all gates pass", () => {
    expect(
      evaluateRollbackGate({
        parallelCyclesPassed: 2,
        unresolvedDeltas: 0,
        signoffRecorded: true,
      }),
    ).toEqual({ ready: true, blockers: [] });
  });

  it("blocks on too few parallel cycles", () => {
    const result = evaluateRollbackGate({
      parallelCyclesPassed: 1,
      unresolvedDeltas: 0,
      signoffRecorded: true,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers[0]).toContain("parallel payroll cycles");
  });

  it("blocks on unresolved deltas and missing sign-off", () => {
    const result = evaluateRollbackGate({
      parallelCyclesPassed: 2,
      unresolvedDeltas: 3,
      signoffRecorded: false,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(2);
  });

  it("respects a custom minimum cycle count", () => {
    expect(
      evaluateRollbackGate({
        parallelCyclesPassed: 3,
        unresolvedDeltas: 0,
        signoffRecorded: true,
        minParallelCycles: 3,
      }).ready,
    ).toBe(true);
  });
});

describe("evaluateSignoff (separation of duties)", () => {
  it("allows a different actor to sign a passing cycle", () => {
    expect(
      evaluateSignoff({
        signoffActor: "checker",
        payrollRunActor: "maker",
        verdict: "pass",
      }),
    ).toEqual({ allowed: true });
  });

  it("blocks the payroll run actor from signing their own cycle", () => {
    const result = evaluateSignoff({
      signoffActor: "maker",
      payrollRunActor: "maker",
      verdict: "pass",
    });
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ allowed: false });
  });

  it("blocks sign-off on a failing cycle", () => {
    expect(
      evaluateSignoff({
        signoffActor: "checker",
        payrollRunActor: "maker",
        verdict: "fail",
      }).allowed,
    ).toBe(false);
  });
});
