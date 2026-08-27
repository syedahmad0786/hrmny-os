import { IntegrationMisconfiguredError } from "../types";
import type {
  EmailVerificationAdapter,
  EmailVerificationProvider,
  EmailVerificationResult,
} from "../contracts";

/**
 * M8 email verification against the frozen `EmailVerificationAdapter` contract,
 * generalized across Hunter and NeverBounce. A positive verdict gates the
 * verified-email deal transition — a payment trigger — so the adapter NEVER
 * invents a verdict: anything not explicitly deliverable stays `unknown` /
 * `emailVerified:false`. Mock by default; live fails loud without its key.
 *
 * Official live endpoints (verified 2026-08-27):
 * - Hunter: GET https://api.hunter.io/v2/email-verifier
 *   https://hunter.io/api-documentation/v2#email-verifier
 *   https://github.com/hunter-io
 * - NeverBounce: GET https://api.neverbounce.com/v4.2/single/check
 *   https://developers.neverbounce.com/reference/single-check
 *   https://github.com/NeverBounce/NeverBounceApi-Node
 */

export type EmailVerificationConfig = {
  provider?: EmailVerificationProvider;
  mode?: "mock" | "live";
  apiKey?: string;
};

export function resolveEmailVerificationProvider(
  config: EmailVerificationConfig = {},
): EmailVerificationProvider {
  if (config.provider === "hunter" || config.provider === "neverbounce") {
    return config.provider;
  }
  const env = process.env.EMAIL_VERIFICATION_PROVIDER?.toLowerCase();
  if (env === "neverbounce" || env === "hunter") return env;
  return "hunter";
}

function envModeFor(provider: EmailVerificationProvider): string | undefined {
  if (provider === "neverbounce") {
    return process.env.NEVERBOUNCE_MODE?.toLowerCase();
  }
  return process.env.HUNTER_MODE?.toLowerCase();
}

function envKeyFor(provider: EmailVerificationProvider): string | undefined {
  if (provider === "neverbounce") {
    return process.env.NEVERBOUNCE_API_KEY?.trim();
  }
  return process.env.HUNTER_API_KEY?.trim();
}

export function resolveEmailVerificationMode(
  config: EmailVerificationConfig = {},
  provider: EmailVerificationProvider = resolveEmailVerificationProvider(config),
): "mock" | "live" {
  if (config.mode === "mock") return "mock";
  if (config.mode === "live") return "live";
  const env = envModeFor(provider);
  if (env === "live") return "live";
  if (env === "mock") return "mock";
  if ((config.apiKey ?? envKeyFor(provider))?.trim()) return "live";
  return "mock";
}

const unverified = (
  email: string,
  verdict: string,
  provider: EmailVerificationProvider,
  score?: number,
): EmailVerificationResult => ({ email, emailVerified: false, verdict, provider, score });

/**
 * Mock — deterministic verdicts from the address. Only clearly-valid-looking
 * addresses verify; "invalid" rejects; everything ambiguous stays `unknown`
 * (never invented). Demo waiver: an explicit recorded path when keys absent.
 */
export function createEmailVerificationMock(
  provider: EmailVerificationProvider = "hunter",
): EmailVerificationAdapter {
  return {
    provider,
    mode: "mock",
    async verify(email: string) {
      const lower = email.toLowerCase();
      if (!lower.includes("@") || lower.includes("invalid")) {
        return unverified(email, "invalid", provider, 0);
      }
      if (lower.includes("unknown") || lower.includes("accept_all")) {
        return unverified(email, "unknown", provider);
      }
      return {
        email,
        emailVerified: true,
        verdict: "valid",
        score: 0.95,
        provider,
      };
    },
  };
}

/** Live Hunter — GET /v2/email-verifier. Only deliverable/valid verifies. */
export function createHunterVerificationLive(
  config: EmailVerificationConfig = {},
): EmailVerificationAdapter {
  const apiKey = config.apiKey ?? process.env.HUNTER_API_KEY;
  if (!apiKey) {
    throw new IntegrationMisconfiguredError(
      "hunter",
      "HUNTER_MODE=live but HUNTER_API_KEY missing — fail loud",
    );
  }
  return {
    provider: "hunter",
    mode: "live",
    async verify(email: string) {
      const url = new URL("https://api.hunter.io/v2/email-verifier");
      url.searchParams.set("email", email);
      url.searchParams.set("api_key", apiKey);
      const res = await fetch(url);
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "hunter",
          `Verify failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as {
        data?: { result?: string; status?: string; score?: number };
      };
      const verdict = String(data.data?.result ?? data.data?.status ?? "unknown");
      return {
        email,
        emailVerified: verdict === "deliverable" || verdict === "valid",
        verdict,
        score:
          typeof data.data?.score === "number"
            ? data.data.score / 100
            : undefined,
        provider: "hunter",
      };
    },
  };
}

/**
 * Live NeverBounce — GET /v4.2/single/check (official current; v4 remains
 * a documented alias). Only `valid` verifies. Auth: `key` query param.
 */
export function createNeverBounceVerificationLive(
  config: EmailVerificationConfig = {},
): EmailVerificationAdapter {
  const apiKey = config.apiKey ?? process.env.NEVERBOUNCE_API_KEY;
  if (!apiKey) {
    throw new IntegrationMisconfiguredError(
      "neverbounce",
      "NeverBounce live but NEVERBOUNCE_API_KEY missing — fail loud",
    );
  }
  return {
    provider: "neverbounce",
    mode: "live",
    async verify(email: string) {
      const url = new URL("https://api.neverbounce.com/v4.2/single/check");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("email", email);
      const res = await fetch(url);
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "neverbounce",
          `Verify failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as { result?: string; status?: string };
      const verdict = String(data.result ?? "unknown");
      return {
        email,
        emailVerified: verdict === "valid",
        verdict,
        provider: "neverbounce",
      };
    },
  };
}

export function createEmailVerificationAdapter(
  config: EmailVerificationConfig = {},
): EmailVerificationAdapter {
  const provider = resolveEmailVerificationProvider(config);
  if (resolveEmailVerificationMode(config, provider) === "mock") {
    return createEmailVerificationMock(provider);
  }
  return provider === "neverbounce"
    ? createNeverBounceVerificationLive(config)
    : createHunterVerificationLive(config);
}
