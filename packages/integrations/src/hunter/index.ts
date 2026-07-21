import {
  IntegrationMisconfiguredError,
  type HunterAdapter,
} from "../types";

export type HunterAdapterConfig = {
  mode?: "mock" | "live";
  apiKey?: string;
};

function resolveMode(config: HunterAdapterConfig): "mock" | "live" {
  if (config.mode === "mock") return "mock";
  if (config.mode === "live") return "live";
  const env = process.env.HUNTER_MODE?.toLowerCase();
  if (env === "live") return "live";
  return "mock";
}

/**
 * Mock Hunter — verifies emails that look real; rejects known-bad domains.
 * Demo waiver: mock mode is an explicit recorded path when keys absent.
 */
export function createHunterMock(): HunterAdapter {
  return {
    async verifyEmail(email: string) {
      const lower = email.toLowerCase();
      const bad =
        lower.includes("invalid") ||
        lower.endsWith("@example.invalid") ||
        !lower.includes("@");
      return {
        emailVerified: !bad,
        verdict: bad ? `mock-undeliverable:${email}` : `mock-valid:${email}`,
        provider: "hunter",
      };
    },
  };
}

export function createHunterLive(config: HunterAdapterConfig = {}): HunterAdapter {
  const apiKey = config.apiKey ?? process.env.HUNTER_API_KEY;
  if (!apiKey) {
    throw new IntegrationMisconfiguredError(
      "hunter",
      "HUNTER_MODE=live but HUNTER_API_KEY missing — fail loud",
    );
  }
  return {
    async verifyEmail(email: string) {
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
        data?: { result?: string; status?: string };
      };
      const result = data.data?.result ?? data.data?.status ?? "unknown";
      const emailVerified = result === "deliverable" || result === "valid";
      return {
        emailVerified,
        verdict: String(result),
        provider: "hunter",
      };
    },
  };
}

export function createHunterStub(): HunterAdapter {
  return createHunterMock();
}

export function createHunterAdapter(
  config: HunterAdapterConfig = {},
): HunterAdapter {
  return resolveMode(config) === "live"
    ? createHunterLive(config)
    : createHunterMock();
}
