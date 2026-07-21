import {
  IntegrationMisconfiguredError,
  type XeroAdapter,
  type XeroInvoiceDraft,
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

/** Mock adapter — posts get deterministic stub ids; never disburses. */
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
    async createInvoice(draft: XeroInvoiceDraft) {
      seq += 1;
      return { xeroInvoiceId: `mock-xero-inv-${draft.invoiceId.slice(0, 8)}-${seq}` };
    },
    async createJournal() {
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
 * Live-shaped adapter. Without credentials throws on every money path.
 * Wire xero-node OAuth in a follow-up when Keeper keys exist.
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
        scope: "openid profile email accounting.transactions offline_access",
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
    async createInvoice() {
      throw new IntegrationMisconfiguredError(
        "xero",
        "Live invoice POST not wired — use XERO_MODE=mock for demos",
      );
    },
    async createJournal() {
      throw new IntegrationMisconfiguredError(
        "xero",
        "Live journal POST not wired — use XERO_MODE=mock for demos",
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
