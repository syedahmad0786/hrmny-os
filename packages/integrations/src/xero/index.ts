import {
  IntegrationMisconfiguredError,
  type XeroAdapter,
  type XeroInvoiceDraft,
  type XeroMirroredInvoice,
} from "../types";

export type XeroAdapterConfig = {
  mode?: "mock" | "live";
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  /** Optional pre-authorized token (from prior OAuth or Keeper). */
  accessToken?: string;
  tenantId?: string;
};

function resolveMode(config: XeroAdapterConfig): "mock" | "live" {
  if (config.mode === "mock") return "mock";
  if (config.mode === "live") return "live";
  const envMode = process.env.XERO_MODE?.toLowerCase();
  if (envMode === "mock") return "mock";
  if (envMode === "live") return "live";
  if (
    (config.clientId ?? process.env.XERO_CLIENT_ID)?.trim() &&
    (config.clientSecret ?? process.env.XERO_CLIENT_SECRET)?.trim()
  ) {
    return "live";
  }
  return "mock";
}

/** Client lock: writes stay off unless explicitly overridden. */
export function isXeroWriteEnabled(): boolean {
  return process.env.XERO_WRITE_ENABLED?.toLowerCase() === "true";
}

function assertWritesAllowed(action: string): void {
  if (!isXeroWriteEnabled()) {
    throw new IntegrationMisconfiguredError(
      "xero",
      `Xero ${action} blocked — OS is read/mirror only (XERO_WRITE_ENABLED=false). Sync from Xero instead.`,
    );
  }
}

function assertLiveConfig(config: XeroAdapterConfig): void {
  const clientId = config.clientId ?? process.env.XERO_CLIENT_ID;
  const clientSecret = config.clientSecret ?? process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new IntegrationMisconfiguredError(
      "xero",
      "XERO_MODE=live but XERO_CLIENT_ID / XERO_CLIENT_SECRET missing — fail loud",
    );
  }
}

type TokenBundle = {
  accessToken: string;
  refreshToken?: string;
  tenantId: string;
  expiresAt?: number;
};

/** Process-local token cache after exchangeCode (demo / single-tenant). */
const tokenCache = new Map<string, TokenBundle>();

function mockMirroredInvoices(): XeroMirroredInvoice[] {
  const syncedAt = new Date().toISOString();
  return [
    {
      externalId: "xero-mirror-inv-1001",
      contactName: "ACME Supplies LLC",
      amount: "2100.00",
      currency: "AED",
      status: "AUTHORISED",
      reference: "Synced from Xero",
      syncedAt,
      payload: { source: "xero", direction: "read" },
    },
  ];
}

/** Mock adapter — mirror reads work; writes require XERO_WRITE_ENABLED=true. */
export function createXeroMock(): XeroAdapter {
  let seq = 0;
  return {
    mode: "mock",
    async getAuthorizeUrl(state) {
      return `https://login.xero.com/identity/connect/authorize?state=${encodeURIComponent(state)}&mock=1`;
    },
    async exchangeCode() {
      return { tenantId: "mock-tenant" };
    },
    async listInvoices() {
      return mockMirroredInvoices();
    },
    async createInvoice(draft: XeroInvoiceDraft) {
      assertWritesAllowed("invoice POST");
      seq += 1;
      return { xeroInvoiceId: `mock-xero-inv-${draft.invoiceId.slice(0, 8)}-${seq}` };
    },
    async createJournal() {
      assertWritesAllowed("journal POST");
      seq += 1;
      return { xeroJournalId: `mock-xero-je-${seq}` };
    },
    async disburse() {
      throw new IntegrationMisconfiguredError(
        "xero",
        "OS never disburses money via Xero",
      );
    },
  };
}

function resolveToken(config: XeroAdapterConfig): TokenBundle | null {
  const accessToken =
    config.accessToken ?? process.env.XERO_ACCESS_TOKEN?.trim();
  const tenantId = config.tenantId ?? process.env.XERO_TENANT_ID?.trim();
  if (accessToken && tenantId) {
    return { accessToken, tenantId };
  }
  const cached = tokenCache.get(config.clientId ?? process.env.XERO_CLIENT_ID ?? "");
  return cached ?? null;
}

/**
 * Live adapter — OAuth + read scopes. Writes fail closed unless override.
 */
export function createXeroLive(config: XeroAdapterConfig = {}): XeroAdapter {
  assertLiveConfig(config);
  const clientId = config.clientId ?? process.env.XERO_CLIENT_ID!;
  const clientSecret = config.clientSecret ?? process.env.XERO_CLIENT_SECRET!;
  const redirectUri =
    config.redirectUri ??
    process.env.XERO_REDIRECT_URI ??
    "http://localhost:3000/api/integrations/xero/callback";

  return {
    mode: "live",
    async getAuthorizeUrl(state) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope:
          "openid profile email accounting.transactions.read accounting.contacts.read offline_access",
        state,
      });
      return `https://login.xero.com/identity/connect/authorize?${params}`;
    },
    async exchangeCode(code: string) {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64",
      );
      const tokenRes = await fetch("https://identity.xero.com/connect/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) {
        throw new IntegrationMisconfiguredError(
          "xero",
          `Token exchange failed: HTTP ${tokenRes.status}`,
        );
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (!tokenJson.access_token) {
        throw new IntegrationMisconfiguredError(
          "xero",
          "Token exchange returned no access_token",
        );
      }
      const connRes = await fetch("https://api.xero.com/connections", {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          Accept: "application/json",
        },
      });
      if (!connRes.ok) {
        throw new IntegrationMisconfiguredError(
          "xero",
          `Connections lookup failed: HTTP ${connRes.status}`,
        );
      }
      const connections = (await connRes.json()) as Array<{
        tenantId?: string;
      }>;
      const tenantId = connections[0]?.tenantId;
      if (!tenantId) {
        throw new IntegrationMisconfiguredError(
          "xero",
          "No Xero tenant authorized for this app",
        );
      }
      tokenCache.set(clientId, {
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token,
        tenantId,
        expiresAt: tokenJson.expires_in
          ? Date.now() + tokenJson.expires_in * 1000
          : undefined,
      });
      return { tenantId };
    },
    async listInvoices() {
      const bundle = resolveToken(config);
      if (!bundle) {
        throw new IntegrationMisconfiguredError(
          "xero",
          "No Xero access token — complete OAuth or set XERO_ACCESS_TOKEN + XERO_TENANT_ID",
        );
      }
      const res = await fetch(
        "https://api.xero.com/api.xro/2.0/Invoices?page=1&unitdp=2",
        {
          headers: {
            Authorization: `Bearer ${bundle.accessToken}`,
            "Xero-Tenant-Id": bundle.tenantId,
            Accept: "application/json",
          },
        },
      );
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "xero",
          `Invoice list failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as {
        Invoices?: Array<Record<string, unknown>>;
      };
      const syncedAt = new Date().toISOString();
      return (data.Invoices ?? []).map((inv) => {
        const contact = (inv.Contact ?? {}) as Record<string, unknown>;
        const total = inv.Total ?? inv.AmountDue ?? "0";
        return {
          externalId: String(inv.InvoiceID ?? inv.InvoiceNumber ?? ""),
          contactName: String(contact.Name ?? "Unknown"),
          amount: String(total),
          currency: String(inv.CurrencyCode ?? "AED"),
          status: String(inv.Status ?? "UNKNOWN"),
          reference: inv.Reference ? String(inv.Reference) : undefined,
          syncedAt,
          payload: { source: "xero", direction: "read", raw: inv },
        } satisfies XeroMirroredInvoice;
      });
    },
    async createInvoice() {
      assertWritesAllowed("invoice POST");
      throw new IntegrationMisconfiguredError(
        "xero",
        "Live invoice POST not wired — and client lock forbids Xero writes",
      );
    },
    async createJournal() {
      assertWritesAllowed("journal POST");
      throw new IntegrationMisconfiguredError(
        "xero",
        "Live journal POST not wired — and client lock forbids Xero writes",
      );
    },
    async disburse() {
      throw new IntegrationMisconfiguredError(
        "xero",
        "OS never disburses money via Xero",
      );
    },
  };
}

/** Factory: mock by default; live when mode/keys say so. */
export function createXeroAdapter(config: XeroAdapterConfig = {}): XeroAdapter {
  const mode = resolveMode(config);
  if (mode === "live") return createXeroLive(config);
  return createXeroMock();
}

/** @deprecated Prefer createXeroAdapter / createXeroMock */
export function createXeroStub(): XeroAdapter {
  return createXeroMock();
}
