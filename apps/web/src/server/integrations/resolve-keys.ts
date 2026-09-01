import { and, connectionAccount, eq, sql } from "@hrmny/db";
import { getDb } from "../db";
import { getMemoryApiKey } from "./memory-keys";

export type ApiKeyToolkit = "apollo" | "hunter" | "bayzat" | "n8n";

export type ResolvedApiKey = {
  apiKey: string | null;
  source: "env" | "vault" | "memory" | "none";
  connectionAccountId?: string;
  /** Non-secret Vault identity used to fence delayed dispatch after rotation. */
  secretId?: string;
  /** PostgreSQL connection-row version used to fence delayed dispatch. */
  credentialVersion?: string;
  /** PostgreSQL Vault-row version; changes when the secret rotates in place. */
  secretVersion?: string;
};

const ENV_KEY: Record<ApiKeyToolkit, string> = {
  apollo: "APOLLO_API_KEY",
  hunter: "HUNTER_API_KEY",
  bayzat: "BAYZAT_API_KEY",
  n8n: "N8N_API_KEY",
};

/** Env first, then any connected staff vault secret for the toolkit. */
export async function resolveIntegrationApiKey(
  toolkit: ApiKeyToolkit,
  employeeId?: string | null,
): Promise<ResolvedApiKey> {
  const fromEnv = process.env[ENV_KEY[toolkit]]?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: "env" };

  const db = getDb();
  if (!db) {
    const mem = getMemoryApiKey(toolkit);
    return mem
      ? { apiKey: mem, source: "memory" }
      : { apiKey: null, source: "none" };
  }

  if (employeeId) {
    const [row] = await db
      .select({ secretId: connectionAccount.secretId })
      .from(connectionAccount)
      .where(
        and(
          eq(connectionAccount.ownerEmployeeId, employeeId),
          eq(connectionAccount.toolkit, toolkit),
          eq(connectionAccount.scope, "staff"),
          eq(connectionAccount.status, "connected"),
        ),
      )
      .limit(1);
    if (row?.secretId) {
      const secrets = await db.execute(
        sql<{ decrypted_secret: string }>`
          select decrypted_secret from vault.decrypted_secrets
          where id = ${row.secretId}::uuid limit 1
        `,
      );
      const decrypted = secrets[0]?.decrypted_secret;
      if (typeof decrypted === "string" && decrypted.trim()) {
        return { apiKey: decrypted.trim(), source: "vault" };
      }
    }
  }

  // Org-wide: any connected staff secret for this toolkit (demo partner paste).
  const [any] = await db
    .select({ secretId: connectionAccount.secretId })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.toolkit, toolkit),
        eq(connectionAccount.scope, "staff"),
        eq(connectionAccount.status, "connected"),
      ),
    )
    .limit(1);
  if (!any?.secretId) return { apiKey: null, source: "none" };
  const secrets = await db.execute(
    sql<{ decrypted_secret: string }>`
      select decrypted_secret from vault.decrypted_secrets
      where id = ${any.secretId}::uuid limit 1
    `,
  );
  const decrypted = secrets[0]?.decrypted_secret;
  if (typeof decrypted === "string" && decrypted.trim()) {
    return { apiKey: decrypted.trim(), source: "vault" };
  }
  return { apiKey: null, source: "none" };
}

/**
 * Resolve only the named employee's active connection. Delayed employee-owned
 * work must never fall back to an environment key, memory key, or another
 * employee's vault secret after the initiating connection is revoked.
 */
export async function resolveOwnedIntegrationApiKey(
  toolkit: ApiKeyToolkit,
  employeeId?: string | null,
  connectionAccountId?: string | null,
): Promise<ResolvedApiKey> {
  if (!employeeId) return { apiKey: null, source: "none" };
  const db = getDb();
  if (!db) return { apiKey: null, source: "none" };

  const [row] = await db.execute<{
    connection_account_id: string;
    secret_id: string | null;
    credential_version: string;
  }>(sql`
      select connection_account_id::text, secret_id::text,
             xmin::text as credential_version
      from public.connection_account
      where owner_employee_id = ${employeeId}::uuid
        and toolkit = ${toolkit}
        and scope = 'staff'
        and status = 'connected'
        and (${connectionAccountId ?? null}::uuid is null
          or connection_account_id = ${connectionAccountId ?? null}::uuid)
        and (expires_at is null or expires_at > now())
      limit 1
    `);
  if (!row?.secret_id) return { apiKey: null, source: "none" };

  const secrets = await db.execute(
    sql<{ decrypted_secret: string; secret_version: string }>`
      select decrypted.decrypted_secret,
             secret.xmin::text as secret_version
      from vault.decrypted_secrets decrypted
      join vault.secrets secret on secret.id = decrypted.id
      where decrypted.id = ${row.secret_id}::uuid
      limit 1
    `,
  );
  const decrypted = secrets[0]?.decrypted_secret;
  const secretVersion = secrets[0]?.secret_version;
  if (
    typeof decrypted !== "string" ||
    !decrypted.trim() ||
    typeof secretVersion !== "string" ||
    !secretVersion
  ) {
    return { apiKey: null, source: "none" };
  }
  return {
    apiKey: decrypted.trim(),
    source: "vault",
    connectionAccountId: row.connection_account_id,
    secretId: row.secret_id,
    credentialVersion: row.credential_version,
    secretVersion,
  };
}

/** Secret-free status for the current employee's active provider connection. */
export async function ownedIntegrationConnectionStatus(
  toolkit: ApiKeyToolkit,
  employeeId?: string | null,
): Promise<{ configured: boolean }> {
  if (!employeeId) return { configured: false };
  const db = getDb();
  if (!db) return { configured: false };
  const [row] = await db
    .select({ id: connectionAccount.connectionAccountId })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, employeeId),
        eq(connectionAccount.toolkit, toolkit),
        eq(connectionAccount.scope, "staff"),
        eq(connectionAccount.status, "connected"),
        sql`${connectionAccount.secretId} is not null`,
        sql`(${connectionAccount.expiresAt} is null or ${connectionAccount.expiresAt} > now())`,
      ),
    )
    .limit(1);
  return { configured: Boolean(row?.id) };
}

/** Reconcile an exact owner-bound provider auth failure without touching its secret. */
export async function markOwnedIntegrationConnectionAuthError(input: {
  toolkit: ApiKeyToolkit;
  employeeId: string;
  connectionAccountId: string;
  credentialVersion: string;
  secretId: string;
  secretVersion: string;
}): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  return db.transaction(async (tx) => {
    // Rotation updates Vault before connection_account. Lock in the same order
    // so a stale provider response can never mark a newer in-place secret as
    // errored, including direct Vault rotation that preserves the secret ID.
    const [secret] = await tx.execute<{ exact: boolean }>(sql`
      select true as exact
      from vault.secrets
      where id = ${input.secretId}::uuid
        and xmin::text = ${input.secretVersion}
      for share
    `);
    if (secret?.exact !== true) return false;

    const updated = await tx.execute<{ id: string }>(sql`
      update public.connection_account
      set status = 'error',
          last_error = 'PROVIDER_AUTHENTICATION_REVOKED',
          last_tested_at = now(),
          updated_at = now()
      where connection_account_id = ${input.connectionAccountId}::uuid
        and owner_employee_id = ${input.employeeId}::uuid
        and toolkit = ${input.toolkit}
        and scope = 'staff'
        and status = 'connected'
        and secret_id = ${input.secretId}::uuid
        and xmin::text = ${input.credentialVersion}
      returning connection_account_id::text as id
    `);
    return updated.length === 1;
  });
}

export async function toolConfiguredStatus(
  toolkit: ApiKeyToolkit | "xero",
): Promise<"configured" | "mock"> {
  if (toolkit === "xero") {
    if (process.env.XERO_CLIENT_ID?.trim()) return "configured";
    if (process.env.XERO_ACCESS_TOKEN?.trim()) return "configured";
    const db = getDb();
    if (!db) return "mock";
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from public.connection_account
      where toolkit = 'xero' and status = 'connected'
    `);
    return (rows[0]?.n ?? 0) > 0 ? "configured" : "mock";
  }
  const resolved = await resolveIntegrationApiKey(toolkit);
  return resolved.apiKey ? "configured" : "mock";
}
