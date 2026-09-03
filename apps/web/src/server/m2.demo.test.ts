import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { getDemoStore } from "./demo-store";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";

function callerFor(
  role: "partner" | "am" | "finance" | "hr" | "director" | "traffic",
) {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("M2 finance propose-approve-post + HR", () => {
  beforeEach(() => {
    getDemoStore().resetM2Demo();
  });

  it("propose → approve → mark issued in OS (Xero write disabled)", async () => {
    const finance = callerFor("finance");
    const proposal = await finance.invoices.intake({
      emailRef: "msg-test-1",
      bodyHint: "ACME Supplies LLC invoice AED 2100.00",
    });
    expect(proposal.status).toBe("pending");
    expect(proposal.payload.ruleCited).toBeTruthy();

    const decided = await finance.invoices.intakeDecide({
      proposalId: proposal.proposalId,
      decision: "approve",
    });
    expect(decided.invoice?.status).toBe("proposed");
    expect(decided.invoice?.sourceAttached).toBeTruthy();

    const approved = await finance.invoices.approve({
      id: decided.invoice!.invoiceId,
    });
    expect(approved.result.ok).toBe(true);
    expect(approved.invoice.status).toBe("approved");

    const issued = await finance.invoices.issue({
      id: decided.invoice!.invoiceId,
    });
    expect(issued.result.ok).toBe(true);
    expect(issued.invoice.status).toBe("issued");
    expect(issued.invoice.xeroInvoiceId).toBeNull();
    expect(issued.xeroWrite).toBe(false);

    const mirror = await finance.invoices.mirrorFromXero();
    expect(mirror.writeEnabled).toBe(false);
    expect(mirror.invoices.length).toBeGreaterThan(0);
  });

  it("holds unknown TRN on issue", async () => {
    const finance = callerFor("finance");
    const proposal = await finance.invoices.intake({
      emailRef: "msg-trn",
      bodyHint: "Vendor invoice AED 100 unknown TRN",
    });
    const decided = await finance.invoices.intakeDecide({
      proposalId: proposal.proposalId,
      decision: "approve",
    });
    expect(decided.invoice?.trnStatus).toBe("unknown_held");
    await finance.invoices.approve({ id: decided.invoice!.invoiceId });
    const issued = await finance.invoices.issue({
      id: decided.invoice!.invoiceId,
    });
    expect(issued.result.ok).toBe(false);
  });

  it("HR accept offer spawns bundle; escalation job fires", async () => {
    const hr = callerFor("hr");
    const empId = "e1000000-0000-4000-8000-000000000001";
    const accepted = await hr.employees.acceptOffer({ id: empId });
    expect(accepted.result.ok).toBe(true);
    expect(accepted.employee.lifecycleStatus).toBe("hire_packet");
    expect(accepted.employee.spawnedBundle).toBe(true);

    const esc = await hr.employees.runEscalationJob();
    expect(esc.count).toBeGreaterThanOrEqual(1);
    const list = await hr.employees.escalations();
    expect(list.some((e) => e.kind === "probation_deadline_missed")).toBe(true);
  });

  it("blocks illegal HR phase skip", async () => {
    const hr = callerFor("hr");
    const empId = "e1000000-0000-4000-8000-000000000001";
    const blocked = await hr.employees.lifecycle.transition({
      id: empId,
      to: "active",
    });
    expect(blocked.ok).toBe(false);
  });

  it("Bayzat CSV import fills mirror (read-only)", async () => {
    const hr = callerFor("hr");
    const result = await hr.employees.importBayzatCsv({
      csvText: `external_id,display_name,email,department
bz-9,Sam Lee,sam@hrmny.local,Ops
`,
    });
    expect(result.imported).toBe(1);
    expect(result.mirror[0]?.externalId).toBe("bz-9");
  });

  it("payroll SoD: HR confirm then partner approve; disburse blocked", async () => {
    const hr = callerFor("hr");
    const partner = callerFor("partner");
    const draft = await hr.payroll.runs.draft({ period: "2026-07" });
    const confirmed = await hr.payroll.runs.confirm({ id: draft.payrollRunId });
    expect(confirmed.result.ok).toBe(true);

    await expect(
      hr.payroll.runs.approve({ id: draft.payrollRunId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const approved = await partner.payroll.runs.approve({
      id: draft.payrollRunId,
    });
    expect(approved.result.ok).toBe(true);

    const disburse = await partner.payroll.runs.post({
      id: draft.payrollRunId,
      disburse: true,
    });
    expect(disburse.result.ok).toBe(false);

    const posted = await partner.payroll.runs.post({ id: draft.payrollRunId });
    expect(posted.result.ok).toBe(true);
    expect(posted.run.xeroJournalId).toBeNull();
    expect(posted.xeroWrite).toBe(false);
  });

  it("blocks ordinary staff from HR administration and payroll data", async () => {
    const staff = callerFor("traffic");

    await expect(staff.invoices.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(staff.payroll.runs.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      staff.employees.importBayzatCsv({
        csvText: "external_id,display_name,email\n1,Test,test@hrmny.co",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
