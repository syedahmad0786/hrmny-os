import { createN8nAdapter, type N8nAdapter } from "@hrmny/integrations";
import { resolveIntegrationApiKey } from "./resolve-keys";

/**
 * Resolve the staff n8n adapter.
 *
 * A key pasted into Connections in AUTH_MODE=dev lands in the process-local
 * memory store. Inferring live mode from "key present" would then POST to
 * n8n Cloud (no timeout) and hang CI after the connections e2e. Memory keys
 * stay mock unless `N8N_MODE=live` is explicit. Env/vault keys keep the
 * existing live inference.
 */
export async function createResolvedN8nAdapter(
  employeeId?: string | null,
): Promise<N8nAdapter> {
  const resolved = await resolveIntegrationApiKey("n8n", employeeId);
  const pastedDevKey =
    resolved.source === "memory" &&
    process.env.N8N_MODE?.toLowerCase() !== "live";
  return createN8nAdapter({
    ...(resolved.apiKey ? { apiKey: resolved.apiKey } : {}),
    ...(pastedDevKey ? { mode: "mock" as const } : {}),
  });
}
