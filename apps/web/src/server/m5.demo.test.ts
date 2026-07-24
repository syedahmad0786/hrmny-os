import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { DEMO_CLIENT_ID, getDemoStore } from "./demo-store";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";

function callerFor(
  role: "partner" | "am" | "finance" | "hr" | "director",
) {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("M5 money loop", () => {
  beforeEach(() => {
    getDemoStore().resetM5Demo();
  });

  it("retainer draft → approve → Xero post → paid webhook", async () => {
    const finance = callerFor("finance");
    const period = "2026-07";
    const batch = await finance.invoices.draftRetainersForMonth({ period });
    expect(batch.created.length).toBeGreaterThanOrEqual(1);
    const inv = batch.created[0]!;
    expect(inv.billingKind).toBe("retainer");
    expect(inv.status).toBe("draft");
    expect(Number(inv.vatAmount)).toBeCloseTo(Number(inv.amount) * 0.05, 2);

    const approved = await finance.invoices.approve({ id: inv.invoiceId });
    expect(approved.result.ok).toBe(true);
    expect(approved.invoice.status).toBe("approved");

    const issued = await finance.invoices.issue({ id: inv.invoiceId });
    expect(issued.result.ok).toBe(true);
    expect(issued.invoice.xeroInvoiceId).toMatch(/^mock-xero-inv-/);

    const paid = await finance.invoices.markPaidFromWebhook({
      xeroInvoiceId: issued.invoice.xeroInvoiceId!,
    });
    expect(paid.status).toBe("paid");
  });

  it("AM denied margin dashboard (FORBIDDEN)", async () => {
    const am = callerFor("am");
    await expect(am.dashboards.margin.list()).rejects.toThrow(/FORBIDDEN/);
  });

  it("partner sees per-client margin incl. over-servicing", async () => {
    const partner = callerFor("partner");
    const board = await partner.dashboards.margin.list();
    expect(board.rows.length).toBeGreaterThanOrEqual(1);
    const demo = board.rows.find((r) => r.clientId === DEMO_CLIENT_ID);
    expect(demo).toBeTruthy();
    expect(demo!.overServicing).toBe(true);
    expect("marginPct" in demo!).toBe(true);
  });

  it("payroll SoD: submitter ≠ approver; never disburse", async () => {
    const hr = callerFor("hr");
    const director = callerFor("director");
    const draft = await hr.payroll.runs.draft({ period: "2026-07" });
    expect(draft.lines.length).toBeGreaterThanOrEqual(1);
    expect(draft.source).toBe("bayzat_mirror");
    expect(draft.disbursed).toBe(false);

    const confirmed = await hr.payroll.runs.confirm({
      id: draft.payrollRunId,
      adjustments: { note: "ok" },
    });
    expect(confirmed.result.ok).toBe(true);

    await expect(
      hr.payroll.runs.approve({ id: draft.payrollRunId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const approved = await director.payroll.runs.approve({
      id: draft.payrollRunId,
    });
    expect(approved.result.ok).toBe(true);

    const disburse = await director.payroll.runs.post({
      id: draft.payrollRunId,
      disburse: true,
    });
    expect(disburse.result.ok).toBe(false);

    const posted = await director.payroll.runs.post({
      id: draft.payrollRunId,
    });
    expect(posted.result.ok).toBe(true);
    expect(posted.run.xeroJournalId).toMatch(/^mock-xero-je-/);
    expect(posted.run.disbursed).toBe(false);
  });

  it("VAT close blocked by unread docs then succeeds", async () => {
    const finance = callerFor("finance");
    const partner = callerFor("partner");
    const period = new Date().toISOString().slice(0, 7);

    const blocked = await finance.vat.close({ period });
    expect(blocked.closed).toBe(false);
    expect(blocked.unreadDocs.length).toBeGreaterThanOrEqual(1);

    for (const docId of blocked.unreadDocs) {
      await finance.vat.docs.markRead({ docId });
    }
    const closed = await finance.vat.close({ period });
    expect(closed.closed).toBe(true);

    const prepared = await finance.vat.return.prepare({ quarter: "2026-Q3" });
    expect(prepared.status).toBe("prepared");
    const signed = await partner.vat.return.sign({ id: prepared.returnId });
    expect(signed.signed).toBe(true);
  });
});
