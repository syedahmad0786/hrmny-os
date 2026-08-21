import { and, connectionAccount, eq, sql } from "@hrmny/db";
import { getDb } from "../db";

export type ApiKeyToolkit = "apollo" | "hunter" | "bayzat";

const ENV_KEY: Record<ApiKeyToolkit, string> = {
  apollo: "APOLLO_API_KEY",
  hunter: "HUNTER_API_KEY",
  bayzat: "BAYZAT_API_KEY",
};

/** Env first, then any connected staff vault secret for the toolkit. */
export async function resolveIntegrationApiKey(
  toolkit: ApiKeyToolkit,
  employeeId?: string | null,
): Promise<{ apiKey: string | null; source: "env" | "vault" | "none" }> {
  const fromEnv = process.env[ENV_KEY[toolkit]]?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: "env" };

  const db = getDb();
  if (!db) return { apiKey: null, source: "none" };

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
