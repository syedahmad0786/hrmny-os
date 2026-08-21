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
};

function resolveMode(config: XeroAdapterConfig): "mock" | "live" {
  if (config.mode === "mock") return "mock";
  if (config.mode === "live") return "live";
  const envMode = process.env.XERO_MODE?.toLowerCase();
  if (envMode === "mock") return "mock";
  if (envMode === "live") return "live";
  // Default mock so AUTH_MODE=dev demos work without OAuth keys
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

/**
 * Live adapter — OAuth + read scopes. Writes fail closed unless override.
 * Token exchange / live listInvoices wire when Keeper keys exist.
 */
export function createXeroLive(config: XeroAdapterConfig = {}): XeroAdapter {
  assertLiveConfig(config);
  const clientId = config.clientId ?? process.env.XERO_CLIENT_ID!;
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
        // Read-oriented scopes — no write accounting.transactions
        scope:
          "openid profile email accounting.transactions.read accounting.contacts.read offline_access",
        state,
      });
      return `https://login.xero.com/identity/connect/authorize?${params}`;
    },
    async exchangeCode() {
      throw new IntegrationMisconfiguredError(
        "xero",
        "Live token exchange not wired — use XERO_MODE=mock for demos",
      );
    },
    async listInvoices() {
      throw new IntegrationMisconfiguredError(
        "xero",
        "Live Xero invoice list not wired — use XERO_MODE=mock until OAuth tokens exist",
      );
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

/** Factory: mock by default; live fails loud when misconfigured. */
export function createXeroAdapter(config: XeroAdapterConfig = {}): XeroAdapter {
  const mode = resolveMode(config);
  if (mode === "live") return createXeroLive(config);
  return createXeroMock();
}

/** @deprecated Prefer createXeroAdapter / createXeroMock */
export function createXeroStub(): XeroAdapter {
  return createXeroMock();
}
