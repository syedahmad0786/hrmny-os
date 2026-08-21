import {
  createApolloLive,
  createHunterLive,
} from "@hrmny/integrations";
import type { ApiKeyToolkit } from "./resolve-keys";

/**
 * Cheap live check after paste. Fail-loud so Connections never marks a dead
 * key as connected (Hunt /api/ready would otherwise look green).
 */
export async function probeIntegrationApiKey(
  toolkit: ApiKeyToolkit,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = apiKey.trim();
  if (key.length < 6) {
    return { ok: false, reason: "API key too short" };
  }
  try {
    if (toolkit === "apollo") {
      await createApolloLive({ mode: "live", apiKey: key }).searchCompanies(
        "hrmny-probe",
      );
      return { ok: true };
    }
    if (toolkit === "hunter") {
      await createHunterLive({ mode: "live", apiKey: key }).verifyEmail(
        "probe@example.com",
      );
      return { ok: true };
    }
    // bayzat / n8n: accept shape-only for now (no cheap public probe wired).
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : `${toolkit}_probe_failed`,
    };
  }
}
