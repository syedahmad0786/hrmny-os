import { IntegrationMisconfiguredError } from "../types";

export type ApolloActivationConfig = {
  mode?: "mock" | "live";
  apiKey?: string;
  /** Explicit owner approval for Apollo operations that can consume credits. */
  allowPaidOperations?: boolean;
};

export function resolveApolloMode(
  config: ApolloActivationConfig = {},
): "mock" | "live" {
  if (config.mode === "mock") return "mock";
  if (config.mode === "live") return "live";
  const env = process.env.APOLLO_MODE?.toLowerCase();
  if (env === "live") return "live";
  return "mock";
}

export function isApolloPaidOperationAllowed(
  config: ApolloActivationConfig = {},
): boolean {
  if (config.allowPaidOperations !== undefined) {
    return config.allowPaidOperations;
  }
  return process.env.APOLLO_ALLOW_PAID_OPERATIONS?.toLowerCase() === "true";
}

export function assertApolloPaidOperationAllowed(
  config: ApolloActivationConfig,
  operation: string,
): void {
  if (isApolloPaidOperationAllowed(config)) return;
  throw new IntegrationMisconfiguredError(
    "apollo",
    `${operation} can consume Apollo credits; explicit billing approval is required (APOLLO_ALLOW_PAID_OPERATIONS=true)`,
  );
}
