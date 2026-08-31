const databaseUrl = process.env.DATABASE_URL?.trim();
if (process.env.CI_POSTGRES_PROOF !== "true" || !databaseUrl) {
  throw new Error("CI_POSTGRES_PROOF_NOT_AUTHORIZED");
}

const target = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(target.hostname)) {
  throw new Error("CI_POSTGRES_PROOF_NONLOCAL_TARGET_FORBIDDEN");
}
if (decodeURIComponent(target.pathname).replace(/^\/+/, "") !== "hrmny_migration_fresh") {
  throw new Error("CI_POSTGRES_PROOF_DISPOSABLE_DATABASE_REQUIRED");
}

Object.assign(process.env, {
  DATABASE_MODE: "postgres",
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
  INNGEST_EVENT_KEY: "",
  INNGEST_SIGNING_KEY: "",
});

globalThis.fetch = async (input) => {
  const raw =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url;
  let host = "external";
  try {
    host = new URL(raw).hostname || host;
  } catch {
    // Keep the failure secret-safe.
  }
  throw new Error(`CI_POSTGRES_NETWORK_FORBIDDEN:${host}`);
};
