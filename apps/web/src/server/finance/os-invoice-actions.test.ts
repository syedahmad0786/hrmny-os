import { describe, expect, it, beforeEach } from "vitest";
import {
  approveOsInvoice,
  issueOsInvoice,
  parseInvoiceIdFromPrompt,
} from "./os-invoice-actions";
import { getDemoStore, vatOnAmount } from "../demo-store";

describe("os-invoice-actions", () => {
  beforeEach(() => {
    getDemoStore().resetM2Demo();
  });

  it("parseInvoiceIdFromPrompt reads labeled and bare UUIDs", () => {
    expect(
      parseInvoiceIdFromPrompt(
        "Approve OS invoice invoiceId: A1000000-0000-4000-8000-000000000099",
      ),
    ).toBe("a1000000-0000-4000-8000-000000000099");
    expect(
      parseInvoiceIdFromPrompt(
        "issue a1000000-0000-4000-8000-000000000088 please",
      ),
    ).toBe("a1000000-0000-4000-8000-000000000088");
    expect(parseInvoiceIdFromPrompt("no id here")).toBeNull();
  });

  it("approve then issue (OS-only when Xero write off)", async () => {
    const store = getDemoStore();
    const invoiceId = crypto.randomUUID();
    store.invoices.set(invoiceId, {
      invoiceId,
      status: "proposed",
      contactName: "Action Co",
      amount: "1000.00",
      vatAmount: vatOnAmount(1000),
      currency: "AED",
      invoiceType: "first",
      billingKind: "first",
      clientId: null,
      period: "2026-08",
      trn: "100000000000003",
      trnStatus: "known",
      ruleCited: "test",
      sourceAttached: { kind: "test" },
      xeroInvoiceId: null,
      proposedByEmployeeId: "c0000000-0000-4000-8000-000000000001",
      approvedByEmployeeId: null,
      createdAt: new Date().toISOString(),
    });

    const approved = await approveOsInvoice({
      invoiceId,
      actor: { employeeId: "c0000000-0000-4000-8000-000000000001" },
    });
    expect(approved.ok).toBe(true);
    expect(approved.invoice?.status).toBe("approved");

    const issued = await issueOsInvoice({
      invoiceId,
      actor: { employeeId: "c0000000-0000-4000-8000-000000000001" },
    });
    expect(issued.ok).toBe(true);
    expect(issued.invoice?.status).toBe("issued");
    expect(issued.xeroWrite).toBe(false);
    expect(issued.invoice?.xeroInvoiceId).toBeNull();
  });

  it("issue blocked until approved", async () => {
    const store = getDemoStore();
    const invoiceId = crypto.randomUUID();
    store.invoices.set(invoiceId, {
      invoiceId,
      status: "proposed",
      contactName: "Blocked Co",
      amount: "500.00",
      vatAmount: vatOnAmount(500),
      currency: "AED",
      invoiceType: "first",
      billingKind: "first",
      clientId: null,
      period: "2026-08",
      trn: "100000000000003",
      trnStatus: "known",
      ruleCited: "test",
      sourceAttached: { kind: "test" },
      xeroInvoiceId: null,
      proposedByEmployeeId: "c0000000-0000-4000-8000-000000000001",
      approvedByEmployeeId: null,
      createdAt: new Date().toISOString(),
    });

    const issued = await issueOsInvoice({
      invoiceId,
      actor: { employeeId: "c0000000-0000-4000-8000-000000000001" },
    });
    expect(issued.ok).toBe(false);
    expect(issued.invoice?.status).toBe("proposed");
  });
});
