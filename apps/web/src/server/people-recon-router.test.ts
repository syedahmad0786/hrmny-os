import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { createCallerFactory } from "./trpc/trpc";
import { peopleReconRouter } from "./trpc/people-recon-router";
import { reconcilePayrollCycle } from "./people-recon/reconcile";
import { reconStore } from "./people-recon/store";

const createReconCaller = createCallerFactory(peopleReconRouter);

function caller(role: "traffic" | "hr" | "director" | "partner" | "finance") {
  const user = resolveDevUser(role);
  return createReconCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  });
}

const CYCLE = { periodStart: "2026-06-01", periodEnd: "2026-06-30", label: "Jun" };
const CSV = "external_id,display_name,email,gross,net,allowances,deductions";

/** Seed a stored report for CYCLE whose payroll-run actor is `runActor`. */
function seedReport(runActor: string, verdict: "pass" | "fail") {
  const source = [
    {
      externalId: "E1",
      displayName: "Alice",
      gross: "10000.00",
      net: "9500.00",
      allowances: "3000.00",
      deductions: "500.00",
    },
  ];
  const native = [
    {
      externalId: "E1",
      employeeId: "emp-E1",
      displayName: "Alice",
      gross: "10000.00",
      net: verdict === "pass" ? "9500.00" : "9000.00",
      allowances: "3000.00",
      deductions: "500.00",
    },
  ];
  const report = reconcilePayrollCycle({
    cycle: CYCLE,
    source,
    native,
    payrollRunActor: runActor,
  });
  reconStore.save(report);
  return report;
}

describe("people reconciliation authorization", () => {
  beforeEach(() => reconStore._reset());

  it("blocks staff without payroll:confirm from running reconciliation", async () => {
    await expect(
      caller("traffic").run({ cycle: CYCLE, sourceCsv: CSV }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails clearly when Postgres is not connected", async () => {
    await expect(
      caller("hr").run({ cycle: CYCLE, sourceCsv: CSV }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("blocks sign-off for roles without payroll:approve", async () => {
    seedReport(resolveDevUser("director").employeeId, "pass");
    await expect(
      caller("hr").recordSignoff({
        periodStart: CYCLE.periodStart,
        periodEnd: CYCLE.periodEnd,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("sign-off separation of duties", () => {
  beforeEach(() => reconStore._reset());

  it("blocks the payroll run actor from signing their own reconciliation", async () => {
    const director = resolveDevUser("director");
    seedReport(director.employeeId, "pass");
    await expect(
      caller("director").recordSignoff({
        periodStart: CYCLE.periodStart,
        periodEnd: CYCLE.periodEnd,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a different approver sign a passing reconciliation", async () => {
    const director = resolveDevUser("director");
    seedReport(director.employeeId, "pass");
    const result = await caller("partner").recordSignoff({
      periodStart: CYCLE.periodStart,
      periodEnd: CYCLE.periodEnd,
      note: "Reviewed June parallel run",
    });
    expect(result.signoff.actor).toBe(resolveDevUser("partner").employeeId);
    expect(reconStore.latest()?.signoff?.actor).toBe(
      resolveDevUser("partner").employeeId,
    );
  });

  it("refuses to sign off a failing reconciliation", async () => {
    seedReport(resolveDevUser("director").employeeId, "fail");
    await expect(
      caller("partner").recordSignoff({
        periodStart: CYCLE.periodStart,
        periodEnd: CYCLE.periodEnd,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns NOT_FOUND when no reconciliation was run for the period", async () => {
    await expect(
      caller("partner").recordSignoff({
        periodStart: CYCLE.periodStart,
        periodEnd: CYCLE.periodEnd,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("rollback readiness gate wiring", () => {
  beforeEach(() => reconStore._reset());

  it("is not ready until two signed passing cycles exist", async () => {
    const gate = await caller("hr").rollbackReadiness();
    expect(gate.ready).toBe(false);

    const june = reconcilePayrollCycle({
      cycle: CYCLE,
      source: [
        {
          externalId: "E1",
          gross: "10000.00",
          net: "9500.00",
          allowances: "3000.00",
          deductions: "500.00",
        },
      ],
      native: [
        {
          externalId: "E1",
          employeeId: "emp-E1",
          gross: "10000.00",
          net: "9500.00",
          allowances: "3000.00",
          deductions: "500.00",
        },
      ],
      payrollRunActor: resolveDevUser("director").employeeId,
    });
    reconStore.save(june);
    const jfrom = reconcilePayrollCycle({
      cycle: { periodStart: "2026-07-01", periodEnd: "2026-07-31" },
      source: [
        {
          externalId: "E1",
          gross: "10000.00",
          net: "9500.00",
          allowances: "3000.00",
          deductions: "500.00",
        },
      ],
      native: [
        {
          externalId: "E1",
          employeeId: "emp-E1",
          gross: "10000.00",
          net: "9500.00",
          allowances: "3000.00",
          deductions: "500.00",
        },
      ],
      payrollRunActor: resolveDevUser("director").employeeId,
    });
    reconStore.save(jfrom);
    reconStore.recordSignoff(CYCLE.periodStart, CYCLE.periodEnd, {
      actor: resolveDevUser("partner").employeeId,
      at: new Date().toISOString(),
    });
    reconStore.recordSignoff("2026-07-01", "2026-07-31", {
      actor: resolveDevUser("partner").employeeId,
      at: new Date().toISOString(),
    });

    const ready = await caller("hr").rollbackReadiness();
    expect(ready).toEqual({ ready: true, blockers: [] });
  });
});
