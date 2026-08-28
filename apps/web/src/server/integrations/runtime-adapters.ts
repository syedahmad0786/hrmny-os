import {
  resolveApolloMode,
  resolveEmailVerificationMode,
  resolveEmailVerificationProvider,
  resolveHunterMode,
  type ApolloAdapterConfig,
  type EmailVerificationConfig,
  type HunterAdapterConfig,
} from "@hrmny/integrations";
import { resolveIntegrationApiKey } from "./resolve-keys";

type CredentialSource = "env" | "vault" | "memory" | "none";

/**
 * Resolve connection material without treating it as activation. `*_MODE=live`
 * remains the separate switch, and paid calls have their own approval flag in
 * the provider adapter.
 */
export async function resolveApolloRuntimeConfig(
  employeeId?: string | null,
): Promise<{
  config: ApolloAdapterConfig;
  mode: "mock" | "live";
  source: CredentialSource;
}> {
  const resolved = await resolveIntegrationApiKey("apollo", employeeId);
  const config: ApolloAdapterConfig = resolved.apiKey
    ? { apiKey: resolved.apiKey }
    : {};
  return {
    config,
    mode: resolveApolloMode(config),
    source: resolved.source,
  };
}

export async function resolveHunterRuntimeConfig(
  employeeId?: string | null,
): Promise<{
  config: HunterAdapterConfig;
  mode: "mock" | "live";
  source: CredentialSource;
}> {
  const resolved = await resolveIntegrationApiKey("hunter", employeeId);
  const config: HunterAdapterConfig = resolved.apiKey
    ? { apiKey: resolved.apiKey }
    : {};
  return {
    config,
    mode: resolveHunterMode(config),
    source: resolved.source,
  };
}

export async function resolveEmailVerificationRuntimeConfig(
  employeeId?: string | null,
): Promise<{
  config: EmailVerificationConfig;
  mode: "mock" | "live";
  source: CredentialSource;
}> {
  const provider = resolveEmailVerificationProvider();
  if (provider === "neverbounce") {
    const apiKey = process.env.NEVERBOUNCE_API_KEY?.trim();
    const config: EmailVerificationConfig = apiKey
      ? { provider, apiKey }
      : { provider };
    return {
      config,
      mode: resolveEmailVerificationMode(config, provider),
      source: apiKey ? "env" : "none",
    };
  }

  const resolved = await resolveIntegrationApiKey("hunter", employeeId);
  const config: EmailVerificationConfig = resolved.apiKey
    ? { provider, apiKey: resolved.apiKey }
    : { provider };
  return {
    config,
    mode: resolveEmailVerificationMode(config, provider),
    source: resolved.source,
  };
}
