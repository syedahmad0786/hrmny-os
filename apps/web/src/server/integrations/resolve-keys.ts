import { and, connectionAccount, eq, sql } from "@hrmny/db";
import { getDb } from "../db";
import { getMemoryApiKey } from "./memory-keys";

export type ApiKeyToolkit = "apollo" | "hunter" | "bayzat" | "n8n";

export type ResolvedApiKey = {
  apiKey: string | null;
  source: "env" | "vault" | "memory" | "none";
  connectionAccountId?: string;
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

  const [row] = await db
    .select({
      connectionAccountId: connectionAccount.connectionAccountId,
      secretId: connectionAccount.secretId,
    })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, employeeId),
        eq(connectionAccount.toolkit, toolkit),
        eq(connectionAccount.scope, "staff"),
        eq(connectionAccount.status, "connected"),
        connectionAccountId
          ? eq(connectionAccount.connectionAccountId, connectionAccountId)
          : undefined,
        sql`(${connectionAccount.expiresAt} is null or ${connectionAccount.expiresAt} > now())`,
      ),
    )
    .limit(1);
  if (!row?.secretId) return { apiKey: null, source: "none" };

  const secrets = await db.execute(
    sql<{ decrypted_secret: string }>`
      select decrypted_secret from vault.decrypted_secrets
      where id = ${row.secretId}::uuid limit 1
    `,
  );
  const decrypted = secrets[0]?.decrypted_secret;
  if (typeof decrypted !== "string" || !decrypted.trim()) {
    return { apiKey: null, source: "none" };
  }
  return {
    apiKey: decrypted.trim(),
    source: "vault",
    connectionAccountId: row.connectionAccountId,
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
}): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const updated = await db
    .update(connectionAccount)
    .set({
      status: "error",
      lastError: "PROVIDER_AUTHENTICATION_REVOKED",
      lastTestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(
          connectionAccount.connectionAccountId,
          input.connectionAccountId,
        ),
        eq(connectionAccount.ownerEmployeeId, input.employeeId),
        eq(connectionAccount.toolkit, input.toolkit),
        eq(connectionAccount.scope, "staff"),
        eq(connectionAccount.status, "connected"),
      ),
    )
    .returning({ id: connectionAccount.connectionAccountId });
  return updated.length === 1;
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
