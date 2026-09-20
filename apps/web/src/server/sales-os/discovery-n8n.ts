import { createN8nLive } from "@hrmny/integrations";
import { z } from "zod";
import { resolveOwnedIntegrationApiKey } from "../integrations/resolve-keys";
import { authorizeDiscoveryOutboundStep, type DiscoveryN8nTriggerV1 } from "./discovery-runs";

export const DISCOVERY_N8N_CLOUD_BASE_URL = "https://hrmny.app.n8n.cloud";
export const DISCOVERY_N8N_WEBHOOK_PATH_PATTERN =
  /^hrmny-discovery-[a-z0-9-]{1,80}$/;
export const DISCOVERY_N8N_PUBLIC_NEWS_WEBHOOK_PATH =
  "hrmny-discovery-public-news";

/** The runtime account is explicit infrastructure; it grants no access to source accounts. */
export async function triggerDiscoveryN8n(trigger: DiscoveryN8nTriggerV1) {
  const ownerEmployeeId = z.string().uuid().parse(process.env.DISCOVERY_N8N_OWNER_EMPLOYEE_ID);
  const connectionAccountId = z.string().uuid().parse(process.env.DISCOVERY_N8N_CONNECTION_ACCOUNT_ID);
  const webhookPath = z
    .string()
    .regex(DISCOVERY_N8N_WEBHOOK_PATH_PATTERN)
    .parse(process.env.DISCOVERY_N8N_WEBHOOK_PATH);
  const outboundWebhookSecret = process.env.DISCOVERY_N8N_TRIGGER_SECRET?.trim();
  if (!outboundWebhookSecret || Buffer.byteLength(outboundWebhookSecret) < 32)
    throw new Error("DISCOVERY_N8N_TRIGGER_CREDENTIAL_UNAVAILABLE");
  const resolved = await resolveOwnedIntegrationApiKey("n8n", ownerEmployeeId, connectionAccountId);
  if (!resolved.apiKey || resolved.source !== "vault" || resolved.connectionAccountId !== connectionAccountId || !resolved.credentialVersion || !resolved.secretVersion)
    throw new Error("DISCOVERY_N8N_CONNECTION_UNAVAILABLE");
  await authorizeDiscoveryOutboundStep({
    runId: trigger.runId,
    attemptToken: trigger.attemptToken,
    attemptGeneration: trigger.attemptGeneration,
    operation: "n8n_trigger",
    runtimeRevision: { connectionAccountId, ownerEmployeeId, credentialVersion: resolved.credentialVersion, secretVersion: resolved.secretVersion },
    cost: { classification: "included" },
  });
  // Use the existing bounded adapter, with a fixed owned origin and separate webhook credential.
  const adapter = createN8nLive({
    baseUrl: DISCOVERY_N8N_CLOUD_BASE_URL,
    apiKey: resolved.apiKey,
    outboundWebhookSecret,
    allowProductionTrigger: true,
  });
  const result = await adapter.triggerWebhook({ webhookPath, payload: { ...trigger }, allowProductionTrigger: true });
  if (!result.triggered || result.mode !== "live") throw new Error("DISCOVERY_N8N_DELIVERY_UNCERTAIN");
  // An HTTP receipt is not a successful run. The n8n claim callback owns that transition.
  return { accepted: true as const };
}
