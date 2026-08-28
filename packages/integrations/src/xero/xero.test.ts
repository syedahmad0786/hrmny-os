import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationMisconfiguredError } from "../types";
import {
  createXeroAdapter,
  createXeroLive,
  createXeroMock,
  isXeroWriteEnabled,
} from "./index";

describe("Xero adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("defaults to write-disabled (client lock)", () => {
    const prev = process.env.XERO_WRITE_ENABLED;
    delete process.env.XERO_WRITE_ENABLED;
    expect(isXeroWriteEnabled()).toBe(false);
    if (prev !== undefined) process.env.XERO_WRITE_ENABLED = prev;
  });

  it("mock mirrors invoices and blocks writes by default", async () => {
    const prev = process.env.XERO_WRITE_ENABLED;
    delete process.env.XERO_WRITE_ENABLED;
    const xero = createXeroMock();
    expect(xero.mode).toBe("mock");
    const mirrored = await xero.listInvoices();
    expect(mirrored.length).toBeGreaterThan(0);
    expect(mirrored[0]?.externalId).toMatch(/^xero-mirror-/);
    await expect(
      xero.createInvoice({
        invoiceId: "a0000000-0000-4000-8000-000000000099",
        contactName: "Vendor LLC",
        amount: "1000.00",
        vatAmount: "50.00",
        currency: "AED",
        sourceAttached: { emailRef: "msg-1" },
      }),
    ).rejects.toBeInstanceOf(IntegrationMisconfiguredError);
    await expect(xero.disburse!("1.00")).rejects.toBeInstanceOf(
      IntegrationMisconfiguredError,
    );
    if (prev !== undefined) process.env.XERO_WRITE_ENABLED = prev;
    else delete process.env.XERO_WRITE_ENABLED;
  });

  it("mock posts invoice only when XERO_WRITE_ENABLED=true", async () => {
    const prev = process.env.XERO_WRITE_ENABLED;
    process.env.XERO_WRITE_ENABLED = "true";
    const xero = createXeroMock();
    const posted = await xero.createInvoice({
      invoiceId: "a0000000-0000-4000-8000-000000000099",
      contactName: "Vendor LLC",
      amount: "1000.00",
      vatAmount: "50.00",
      currency: "AED",
      sourceAttached: { emailRef: "msg-1" },
    });
    expect(posted.xeroInvoiceId).toMatch(/^mock-xero-inv-/);
    if (prev !== undefined) process.env.XERO_WRITE_ENABLED = prev;
    else delete process.env.XERO_WRITE_ENABLED;
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

  it("does not choose implicitly when OAuth returns multiple Xero tenants", async () => {
    vi.stubEnv("XERO_TENANT_ID", "");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 1800,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ tenantId: "tenant-a" }, { tenantId: "tenant-b" }]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const xero = createXeroLive({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost:3000/api/integrations/xero/callback",
    });
    await expect(xero.exchangeCode("auth-code")).rejects.toThrow(
      /XERO_TENANT_ID/,
    );
  });
});
