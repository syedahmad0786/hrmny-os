import { describe, expect, it } from "vitest";
import { IntegrationMisconfiguredError } from "../types";
import { createXeroAdapter, createXeroMock } from "./index";

describe("Xero adapter", () => {
  it("mock posts invoice and rejects disbursement", async () => {
    const xero = createXeroMock();
    expect(xero.mode).toBe("mock");
    const posted = await xero.createInvoice({
      invoiceId: "a0000000-0000-4000-8000-000000000099",
      contactName: "Vendor LLC",
      amount: "1000.00",
      vatAmount: "50.00",
      currency: "AED",
      sourceAttached: { emailRef: "msg-1" },
    });
    expect(posted.xeroInvoiceId).toMatch(/^mock-xero-inv-/);
    await expect(xero.disburse!("1.00")).rejects.toBeInstanceOf(
      IntegrationMisconfiguredError,
    );
  });

  it("live mode without keys fails loud", () => {
    const prevId = process.env.XERO_CLIENT_ID;
    const prevSecret = process.env.XERO_CLIENT_SECRET;
    delete process.env.XERO_CLIENT_ID;
    delete process.env.XERO_CLIENT_SECRET;
    expect(() => createXeroAdapter({ mode: "live" })).toThrow(
      IntegrationMisconfiguredError,
    );
    if (prevId) process.env.XERO_CLIENT_ID = prevId;
    if (prevSecret) process.env.XERO_CLIENT_SECRET = prevSecret;
  });
});
