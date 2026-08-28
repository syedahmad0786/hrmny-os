import type { EmailVerificationProvider } from "../contracts";
import { IntegrationMisconfiguredError } from "../types";

export type PaidVerificationConfig = {
  allowPaidOperations?: boolean;
};

export function isPaidVerificationAllowed(
  provider: EmailVerificationProvider,
  config: PaidVerificationConfig = {},
): boolean {
  if (config.allowPaidOperations !== undefined) {
    return config.allowPaidOperations;
  }
  const envName =
    provider === "neverbounce"
      ? "NEVERBOUNCE_ALLOW_PAID_OPERATIONS"
      : "HUNTER_ALLOW_PAID_OPERATIONS";
  return process.env[envName]?.toLowerCase() === "true";
}

export function assertPaidVerificationAllowed(
  provider: EmailVerificationProvider,
  config: PaidVerificationConfig,
): void {
  if (isPaidVerificationAllowed(provider, config)) return;
  const envName =
    provider === "neverbounce"
      ? "NEVERBOUNCE_ALLOW_PAID_OPERATIONS"
      : "HUNTER_ALLOW_PAID_OPERATIONS";
  throw new IntegrationMisconfiguredError(
    provider,
    `Email verification can consume credits; explicit billing approval is required (${envName}=true)`,
  );
}
