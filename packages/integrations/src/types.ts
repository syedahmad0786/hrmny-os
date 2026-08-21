/** Integration adapter interfaces — mock by default; live SDKs fail-loud when misconfigured. */

export type OAuthStartResult = { redirectUrl: string };

export type ConnectionStatus = {
  connected: boolean;
  expiresAt?: string | null;
};

export interface ComposioAdapter {
  listToolkits(): Promise<string[]>;
  startOAuth(toolkit: string, redirectUri: string): Promise<OAuthStartResult>;
  disconnect(connectionId: string): Promise<void>;
  status(toolkit: string, ownerId: string): Promise<ConnectionStatus>;
  /** Optional HITL send — stub or live Gmail after approval. */
  sendAfterApproval?(input: {
    toolkit: "gmail" | "linkedin";
    to: string;
    subject?: string;
    body: string;
    connectionId?: string;
  }): Promise<{
    sent: boolean;
    mode: "stub" | "copy_draft" | "live";
    externalId: string;
    channel: "gmail" | "linkedin";
  }>;
}

export type XeroInvoiceDraft = {
  invoiceId: string;
  contactName: string;
  amount: string;
  vatAmount: string;
  currency: string;
  reference?: string;
  /** Source evidence attached on post (email ref, attachment path). */
  sourceAttached?: Record<string, unknown>;
  trn?: string | null;
};

export type XeroAdapterMode = "mock" | "live";

export type XeroMirroredInvoice = {
  externalId: string;
  contactName: string;
  amount: string;
  currency: string;
  status: string;
  reference?: string;
  syncedAt: string;
  payload: Record<string, unknown>;
};

export interface XeroAdapter {
  readonly mode: XeroAdapterMode;
  getAuthorizeUrl(state: string): Promise<string>;
  exchangeCode(code: string): Promise<{
    tenantId: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  /**
   * Client lock (14 Aug 2026): OS reads/mirrors Xero only.
   * Writes throw unless XERO_WRITE_ENABLED=true (explicit override).
   */
  createInvoice(draft: XeroInvoiceDraft): Promise<{ xeroInvoiceId: string }>;
  createJournal(entry: Record<string, unknown>): Promise<{ xeroJournalId: string }>;
  /** Pull invoices from Xero into OS mirror snapshots. */
  listInvoices(): Promise<XeroMirroredInvoice[]>;
  /** Explicitly rejected — Xero adapter never moves money. */
  disburse?(amount: string): Promise<never>;
}

export type BayzatSource = "api" | "csv";

export type BayzatEmployeeRow = {
  externalId: string;
  displayName: string;
  email: string;
  department?: string;
  basicSalaryAed?: string;
  leaveBalanceDays?: string;
  raw: Record<string, string>;
};

export interface BayzatAdapter {
  readonly source: BayzatSource;
  /** Read-only — OS never writes Bayzat master data. */
  listEmployees(): Promise<BayzatEmployeeRow[]>;
  importCsv(csvText: string): Promise<BayzatEmployeeRow[]>;
}

export interface ApolloAdapter {
  enrichPerson(email: string): Promise<Record<string, unknown> | null>;
  searchCompanies(query: string): Promise<Record<string, unknown>[]>;
}

export interface HunterAdapter {
  verifyEmail(email: string): Promise<{
    emailVerified: boolean;
    verdict: string;
    provider: "hunter";
  }>;
}

/** n8n Cloud — list / propose / trigger / execution status. */
export type N8nWorkflowSummary = {
  id: string;
  name: string;
  active: boolean;
  updatedAt?: string;
};

export type N8nHealthResult = {
  ok: boolean;
  mode: "mock" | "live";
  baseUrl: string;
  apiKeyConfigured: boolean;
  allowProductionTrigger: boolean;
  detail: string;
};

export type N8nExecutionStatus = {
  id: string;
  finished: boolean;
  status: string;
  mode?: string;
};

export type N8nProposeResult = {
  proposed: boolean;
  event: string;
  workflowName?: string;
  webhookPath?: string;
  webhookUrl?: string;
  requiresHitl?: boolean;
  payload?: Record<string, unknown>;
  reason?: string;
};

export type N8nTriggerResult = {
  triggered: boolean;
  mode: "mock" | "live";
  blocked: boolean;
  executionId?: string;
  webhookUrl?: string;
  reason?: string;
};

export interface N8nAdapter {
  readonly readonlyMode: "mock" | "live";
  readonly baseUrl: string;
  health(): Promise<N8nHealthResult>;
  listWorkflows(): Promise<N8nWorkflowSummary[]>;
  getExecutionStatus(executionId: string): Promise<N8nExecutionStatus>;
  proposeWorkflow(input: {
    event: string;
    payload?: Record<string, unknown>;
  }): Promise<N8nProposeResult>;
  triggerWebhook(input: {
    webhookPath: string;
    payload?: Record<string, unknown>;
    /** Explicit HITL allow — required to fire production webhooks. */
    allowProductionTrigger?: boolean;
  }): Promise<N8nTriggerResult>;
}

export const STUB_TOOLKITS = ["gmail", "linkedin", "canva", "calendar"] as const;

export class IntegrationMisconfiguredError extends Error {
  readonly code = "INTEGRATION_MISCONFIGURED" as const;
  constructor(
    readonly integration: string,
    message: string,
  ) {
    super(`[${integration}] ${message}`);
    this.name = "IntegrationMisconfiguredError";
  }
}
