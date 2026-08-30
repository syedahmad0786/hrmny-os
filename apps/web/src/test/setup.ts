import { afterEach, beforeEach, vi } from "vitest";

const forbiddenFetch: typeof globalThis.fetch = async (input) => {
  const raw =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url;
  let host = "external";
  try {
    host = new URL(raw).hostname || host;
  } catch {
    // Keep errors secret-safe: never echo the complete URL or request body.
  }
  throw new Error(`LIVE_NETWORK_FORBIDDEN_IN_ORDINARY_TEST:${host}`);
};

function applyDeterministicEnvironment() {
  const values: Record<string, string> = {
    DATABASE_MODE: "memory",
    DATABASE_URL: "",
    DIRECT_URL: "",
    HRMNY_PRODUCTION_DATABASE_URL: "",
    AUTH_MODE: "dev",
    ALLOW_DEV_AUTH: "true",
    LLM_PROVIDER: "mock",
    OPENROUTER_LIVE_SMOKE: "0",
    EMBEDDING_PROVIDER: "none",
    APOLLO_MODE: "mock",
    APOLLO_ALLOW_PAID_OPERATIONS: "false",
    HUNTER_MODE: "mock",
    HUNTER_ALLOW_PAID_OPERATIONS: "false",
    NEVERBOUNCE_MODE: "mock",
    NEVERBOUNCE_ALLOW_PAID_OPERATIONS: "false",
    RESEND_MODE: "mock",
    N8N_MODE: "mock",
    N8N_ALLOW_PRODUCTION_TRIGGER: "false",
    XERO_MODE: "mock",
    XERO_WRITE_ENABLED: "false",
    WORK_ENVIRONMENT_KIND: "sandbox",
    OPENROUTER_API_KEY: "",
    OPENROUTER_PRIVILEGED_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    APOLLO_API_KEY: "",
    HUNTER_API_KEY: "",
    NEVERBOUNCE_API_KEY: "",
    RESEND_API_KEY: "",
    COMPOSIO_API_KEY: "",
    GOOGLE_CHAT_WEBHOOK_URL: "",
    INNGEST_EVENT_KEY: "",
    INNGEST_SIGNING_KEY: "",
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", forbiddenFetch);
}

applyDeterministicEnvironment();
beforeEach(applyDeterministicEnvironment);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
