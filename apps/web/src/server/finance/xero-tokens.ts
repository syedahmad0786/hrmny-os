import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, connectionAccount, eq, sql } from "@hrmny/db";
import { createXeroAdapter } from "@hrmny/integrations";
import { getDb } from "../db";

export type XeroTokenSecret = {
  accessToken: string;
  refreshToken?: string;
  tenantId: string;
  expiresAt?: string;
};

function oauthSecret(): string {
  return (
    process.env.XERO_OAUTH_STATE_SECRET?.trim() ||
    process.env.SUPABASE_JWT_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "hrmny-xero-dev-state"
  );
}

export function xeroClientConfigured(): boolean {
  return Boolean(
    process.env.XERO_CLIENT_ID?.trim() &&
      process.env.XERO_CLIENT_SECRET?.trim(),
  );
}

export function xeroRedirectUri(): string {
  return (
    process.env.XERO_REDIRECT_URI?.trim() ||
    `${process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000"}/api/integrations/xero/callback`
  );
}

export function signXeroOAuthState(employeeId: string): string {
  const body = Buffer.from(
    JSON.stringify({
      employeeId,
      n: randomUUID(),
      exp: Date.now() + 15 * 60_000,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", oauthSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyXeroOAuthState(state: string): { employeeId: string } {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Invalid Xero OAuth state");
  const expected = createHmac("sha256", oauthSecret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid Xero OAuth state signature");
  }
  const payload = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  ) as {
    employeeId?: string;
    exp?: number;
  };
  if (!payload.employeeId || typeof payload.exp !== "number") {
    throw new Error("Invalid Xero OAuth state payload");
  }
  if (payload.exp < Date.now()) throw new Error("Xero OAuth state expired");
  return { employeeId: payload.employeeId };
}

export async function buildXeroAuthorizeUrl(employeeId: string): Promise<{
  redirectUrl: string;
}> {
  if (!xeroClientConfigured()) {
    throw new Error(
      "XERO_CLIENT_ID / XERO_CLIENT_SECRET required for live Xero OAuth",
    );
  }
  const adapter = createXeroAdapter({
    mode: "live",
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    redirectUri: xeroRedirectUri(),
  });
  const state = signXeroOAuthState(employeeId);
  const redirectUrl = await adapter.getAuthorizeUrl(state);
  return { redirectUrl };
}

export async function persistXeroTokens(input: {
  employeeId: string;
  tokens: XeroTokenSecret;
}): Promise<{ connectionAccountId: string }> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL required to persist Xero tokens");
  const secretJson = JSON.stringify(input.tokens);

  const [existing] = await db
    .select()
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, input.employeeId),
        eq(connectionAccount.toolkit, "xero"),
        eq(connectionAccount.scope, "staff"),
      ),
    )
    .limit(1);

  return db.transaction(async (tx) => {
    let secretId = existing?.secretId ?? null;
    if (secretId) {
      await tx.execute(
        sql`select vault.update_secret(${secretId}::uuid, ${secretJson})`,
      );
    } else {
      const created = await tx.execute(
        sql<{ id: string }>`
          select vault.create_secret(
            ${secretJson},
            ${`hrmny:${input.employeeId}:xero`},
            ${"Xero OAuth tokens managed by hrmny OS"}
          ) as id
        `,
      );
      const createdId = created[0]?.id;
      secretId = typeof createdId === "string" ? createdId : null;
    }
    if (!secretId) throw new Error("Vault did not return a Xero secret id");

    const values = {
      ownerEmployeeId: input.employeeId,
      toolkit: "xero",
      scope: "staff" as const,
      authType: "oauth",
      label: "xero",
      secretId,
      externalConnectionId: input.tokens.tenantId,
      status: "connected",
      lastTestedAt: new Date(),
      lastError: null as string | null,
      updatedAt: new Date(),
    };

    const [saved] = existing
      ? await tx
          .update(connectionAccount)
          .set(values)
          .where(
            eq(
              connectionAccount.connectionAccountId,
              existing.connectionAccountId,
            ),
          )
          .returning()
      : await tx.insert(connectionAccount).values(values).returning();

    return { connectionAccountId: saved!.connectionAccountId };
  });
}

export async function loadXeroTokens(): Promise<XeroTokenSecret | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ secretId: connectionAccount.secretId })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.toolkit, "xero"),
        eq(connectionAccount.scope, "staff"),
        eq(connectionAccount.status, "connected"),
      ),
    )
    .limit(1);
  if (!row?.secretId) return null;
  const secrets = await db.execute(
    sql<{ decrypted_secret: string }>`
      select decrypted_secret from vault.decrypted_secrets
      where id = ${row.secretId}::uuid limit 1
    `,
  );
  const raw = secrets[0]?.decrypted_secret;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as XeroTokenSecret;
    if (!parsed.accessToken || !parsed.tenantId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function completeXeroOAuth(input: {
  code: string;
  state: string;
}): Promise<{ tenantId: string; connectionAccountId: string }> {
  const { employeeId } = verifyXeroOAuthState(input.state);
  if (!xeroClientConfigured()) {
    throw new Error("Xero client credentials missing");
  }
  const adapter = createXeroAdapter({
    mode: "live",
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    redirectUri: xeroRedirectUri(),
  });
  const exchanged = await adapter.exchangeCode(input.code);
  if (!exchanged.accessToken) {
    throw new Error("Xero token exchange returned no access token");
  }

  const saved = await persistXeroTokens({
    employeeId,
    tokens: {
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      tenantId: exchanged.tenantId,
      expiresAt: exchanged.expiresIn
        ? new Date(Date.now() + exchanged.expiresIn * 1000).toISOString()
        : undefined,
    },
  });

  return {
    tenantId: exchanged.tenantId,
    connectionAccountId: saved.connectionAccountId,
  };
}
