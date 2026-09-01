export {};

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("CI_POSTGRES_DATABASE_URL_REQUIRED");

const target = new URL(databaseUrl);
if (!new Set(["127.0.0.1", "localhost", "postgres"]).has(target.hostname)) {
  throw new Error("CI_POSTGRES_NONLOCAL_TARGET_FORBIDDEN");
}
if (
  process.env.CI !== "true" ||
  process.env.HRMNY_CI_POSTGRES_WRITE !== "true"
) {
  throw new Error("CI_POSTGRES_EXPLICIT_WRITE_GATE_REQUIRED");
}

Object.assign(process.env, {
  DATABASE_MODE: "postgres",
  HRMNY_DATABASE_SSL_MODE: "disable",
  AUTH_MODE: "dev",
  ALLOW_DEV_AUTH: "true",
  WORK_ENVIRONMENT_KIND: "sandbox",
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
  XERO_MODE: "mock",
  XERO_WRITE_ENABLED: "false",
  OPENROUTER_API_KEY: "",
  OPENROUTER_PRIVILEGED_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  APOLLO_API_KEY: "",
  HUNTER_API_KEY: "",
  NEVERBOUNCE_API_KEY: "",
  RESEND_API_KEY: "",
  GOOGLE_CHAT_WEBHOOK_URL: "",
});

globalThis.fetch = async (input) => {
  let host = "external";
  try {
    host = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
    ).hostname;
  } catch {
    // Keep the failure secret-safe; never echo the URL or request body.
  }
  throw new Error(`CI_POSTGRES_NETWORK_FORBIDDEN:${host}`);
};
