import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const HRMNY_PRODUCTION_PROJECT_REF = "klrugedztqxlvyghyzxs";
export const SYNTHETIC_PROOF_CONFIRMATION =
  "RUN LEGACY EFFECT CONTAINMENT PROOF ON DISPOSABLE HRMNY TARGET";

export const SYNTHETIC_PROOF_SAFE_RUNTIME_ENV = Object.freeze({
  DATABASE_MODE: "postgres",
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

export type SyntheticProofTargetInput = {
  databaseUrl: string;
  targetProjectRef: string;
  expectedProjectRef: string;
  targetKind: string;
  authorizationReceipt: string;
  confirmation: string;
  expiresAt: string;
  now?: Date;
};

export type SyntheticProofTargetReceipt = {
  targetProjectRef: string;
  expiresAt: string;
  authorizationReceiptHash: string;
};

function normalizeProjectRef(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(normalized)) {
    throw new Error(`${field}_INVALID`);
  }
  return normalized;
}

export function projectRefFromDatabaseUrl(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("SYNTHETIC_PROOF_DATABASE_URL_INVALID");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("SYNTHETIC_PROOF_DATABASE_PROTOCOL_INVALID");
  }

  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname)?.[1];
  const isSupabasePooler = url.hostname.endsWith(".pooler.supabase.com");
  const pooled = isSupabasePooler
    ? /^postgres\.([a-z0-9]{20})$/i.exec(decodeURIComponent(url.username))?.[1]
    : undefined;
  const projectRef = direct ?? pooled;
  if (!projectRef) throw new Error("SYNTHETIC_PROOF_PROJECT_REF_UNRESOLVED");
  return projectRef.toLowerCase();
}

export function assertSyntheticProofTarget(
  input: SyntheticProofTargetInput,
): SyntheticProofTargetReceipt {
  const targetProjectRef = normalizeProjectRef(
    input.targetProjectRef,
    "SYNTHETIC_PROOF_TARGET_PROJECT_REF",
  );
  const expectedProjectRef = normalizeProjectRef(
    input.expectedProjectRef,
    "SYNTHETIC_PROOF_EXPECTED_PROJECT_REF",
  );
  if (targetProjectRef === HRMNY_PRODUCTION_PROJECT_REF) {
    throw new Error("SYNTHETIC_PROOF_PRODUCTION_TARGET_FORBIDDEN");
  }
  if (targetProjectRef !== expectedProjectRef) {
    throw new Error("SYNTHETIC_PROOF_PROJECT_REF_NOT_ALLOWLISTED");
  }
  if (projectRefFromDatabaseUrl(input.databaseUrl) !== targetProjectRef) {
    throw new Error("SYNTHETIC_PROOF_DATABASE_REF_MISMATCH");
  }
  if (input.targetKind.trim().toLowerCase() !== "disposable") {
    throw new Error("SYNTHETIC_PROOF_TARGET_NOT_DISPOSABLE");
  }
  if (input.confirmation !== SYNTHETIC_PROOF_CONFIRMATION) {
    throw new Error("SYNTHETIC_PROOF_CONFIRMATION_MISMATCH");
  }
  const authorizationReceipt = input.authorizationReceipt.trim();
  if (authorizationReceipt.length < 8) {
    throw new Error("SYNTHETIC_PROOF_AUTHORIZATION_RECEIPT_MISSING");
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    throw new Error("SYNTHETIC_PROOF_AUTHORIZATION_EXPIRED");
  }
  if (expiresAt.getTime() - now.getTime() > 24 * 60 * 60 * 1_000) {
    throw new Error("SYNTHETIC_PROOF_AUTHORIZATION_TOO_LONG");
  }

  return {
    targetProjectRef,
    expiresAt: expiresAt.toISOString(),
    authorizationReceiptHash: createHash("sha256")
      .update(authorizationReceipt)
      .digest("hex"),
  };
}

export function syntheticProofTargetInputFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SyntheticProofTargetInput {
  return {
    // The guard and the proof must consume the same URL. A second URL variable
    // would allow a safe guard target and a different mutation target.
    databaseUrl: environment.DATABASE_URL ?? "",
    targetProjectRef: environment.HRMNY_PROOF_TARGET_PROJECT_REF ?? "",
    expectedProjectRef: environment.HRMNY_PROOF_EXPECTED_PROJECT_REF ?? "",
    targetKind: environment.HRMNY_PROOF_TARGET_KIND ?? "",
    authorizationReceipt: environment.HRMNY_PROOF_AUTHORIZATION_RECEIPT ?? "",
    confirmation: environment.HRMNY_PROOF_CONFIRMATION ?? "",
    expiresAt: environment.HRMNY_PROOF_EXPIRES_AT ?? "",
  };
}

function isEntrypoint() {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(entry).href === import.meta.url);
}

if (isEntrypoint()) {
  try {
    const receipt = assertSyntheticProofTarget(
      syntheticProofTargetInputFromEnvironment(),
    );
    process.stdout.write(`${JSON.stringify({ ok: true, ...receipt })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
