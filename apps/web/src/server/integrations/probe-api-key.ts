import { normalizeN8nBaseUrl } from "@hrmny/integrations";
import type { ApiKeyToolkit } from "./resolve-keys";

/**
 * Free, read-only live check after paste. Never use a credit-consuming search
 * or verifier merely to validate a credential.
 */
export async function probeIntegrationApiKey(
  toolkit: ApiKeyToolkit,
  apiKey: string,
  options: { allowConfiguredMock?: boolean } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = apiKey.trim();
  if (key.length < 6) {
    return { ok: false, reason: "API key too short" };
  }
  const configuredMode = process.env[`${toolkit.toUpperCase()}_MODE`]
    ?.trim()
    .toLowerCase();
  if (options.allowConfiguredMock && configuredMode === "mock") {
    return { ok: true };
  }
  try {
    if (toolkit === "apollo") {
      const response = await fetch("https://api.apollo.io/api/v1/auth/health", {
        headers: { "x-api-key": key },
      });
      if (!response.ok) throw new Error(`Apollo auth health: HTTP ${response.status}`);
      return { ok: true };
    }
    if (toolkit === "hunter") {
      const response = await fetch("https://api.hunter.io/v2/account", {
        headers: { "X-API-KEY": key },
      });
      if (!response.ok) throw new Error(`Hunter account: HTTP ${response.status}`);
      return { ok: true };
    }
    if (toolkit === "n8n") {
      const response = await fetch(
        `${normalizeN8nBaseUrl()}/api/v1/workflows?limit=1`,
        { headers: { "X-N8N-API-KEY": key } },
      );
      if (!response.ok) throw new Error(`n8n workflows: HTTP ${response.status}`);
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        "UNVERIFIED_INTERFACE: Bayzat API keys cannot be accepted until the tenant supplies an official employee-list contract; use CSV.",
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : `${toolkit}_probe_failed`,
    };
  }
}
