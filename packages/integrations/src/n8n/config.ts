/** n8n Cloud config — hrmny OS instance only (not personal). */

export const N8N_DEFAULT_BASE_URL = "https://hrmny.app.n8n.cloud";

/** Webhook path → optional full-URL env override (no API key needed). */
export const N8N_WEBHOOK_URL_ENV_BY_PATH: Readonly<Record<string, string>> = {
  "hrmny-deal-won": "N8N_WEBHOOK_DEAL_WON",
  "hrmny-ticket-created": "N8N_WEBHOOK_TICKET_CREATED",
  "hrmny-error-alert": "N8N_WEBHOOK_ERROR_ALERT",
  "hrmny-ticket-triage-assist": "N8N_WEBHOOK_TICKET_TRIAGE",
  "hrmny-outreach-draft": "N8N_WEBHOOK_OUTREACH_DRAFT",
};

/** Strip trailing slashes so URL joins stay consistent. */
export function normalizeN8nBaseUrl(raw?: string | null): string {
  const fallback = N8N_DEFAULT_BASE_URL;
  const value = (raw ?? process.env.N8N_BASE_URL ?? fallback).trim();
  return value.replace(/\/+$/, "") || fallback;
}

export function getN8nApiKey(override?: string): string | undefined {
  const key = (override ?? process.env.N8N_API_KEY)?.trim();
  return key || undefined;
}

/** Explicit allow for live webhook/API triggers (HITL / ops gate). */
export function n8nProductionTriggerAllowed(override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  const env = process.env.N8N_ALLOW_PRODUCTION_TRIGGER?.toLowerCase();
  return env === "1" || env === "true" || env === "yes";
}

/**
 * Optional full webhook URL from env (free-trial path: fire without API key).
 * Prefer these over `{baseUrl}/webhook/{path}` when set.
 */
export function getN8nWebhookUrlOverride(
  webhookPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const path = webhookPath.replace(/^\/+/, "");
  const envName = N8N_WEBHOOK_URL_ENV_BY_PATH[path];
  if (!envName) return undefined;
  const value = env[envName]?.trim();
  return value || undefined;
}

/** Resolve production webhook URL: env override → constructed path. */
export function resolveN8nWebhookUrl(
  baseUrl: string,
  webhookPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = getN8nWebhookUrlOverride(webhookPath, env);
  if (override) return override;
  const path = webhookPath.replace(/^\/+/, "");
  return `${normalizeN8nBaseUrl(baseUrl)}/webhook/${path}`;
}

export type N8nConfig = {
  baseUrl: string;
  apiKey?: string;
  mode: "mock" | "live";
  allowProductionTrigger: boolean;
};

export function resolveN8nConfig(partial: {
  baseUrl?: string;
  apiKey?: string;
  mode?: "mock" | "live";
  allowProductionTrigger?: boolean;
} = {}): N8nConfig {
  const baseUrl = normalizeN8nBaseUrl(partial.baseUrl);
  const apiKey = getN8nApiKey(partial.apiKey);
  let mode: "mock" | "live" = partial.mode ?? "mock";
  if (!partial.mode) {
    const env = process.env.N8N_MODE?.toLowerCase();
    if (env === "live") mode = "live";
  }
  // Live without key still constructs but health/list fail-loud or mock-fallback in client.
  if (mode === "live" && !apiKey) {
    mode = "mock";
  }
  return {
    baseUrl,
    apiKey,
    mode,
    allowProductionTrigger: n8nProductionTriggerAllowed(
      partial.allowProductionTrigger,
    ),
  };
}
