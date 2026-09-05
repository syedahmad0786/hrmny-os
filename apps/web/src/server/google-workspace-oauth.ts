import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, auditEvent, connectionAccount, eq, sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "./db";

export const GOOGLE_WORKSPACE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

export const GoogleProfileSchema = z.object({
  email: z.string().email(),
  email_verified: z.literal(true),
});

export const GoogleWorkspaceSecretSchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20),
  expiresAt: z.string().datetime(),
});

export const GoogleTokenResponseSchema = z.object({
  access_token: z.string().min(20),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(20).optional(),
});

function oauthSecret(): string {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "GOOGLE_OAUTH_STATE_SECRET (at least 32 characters) is required for Google Workspace OAuth",
    );
  }
  return secret;
}

export function googleWorkspaceClientId(): string | null {
  return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
}

export function googleWorkspaceClientSecret(): string | null {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null;
}

export function googleWorkspaceClientConfigured(): boolean {
  return Boolean(googleWorkspaceClientId() && googleWorkspaceClientSecret());
}

export const GOOGLE_WORKSPACE_CALLBACK_PATH =
  "/api/integrations/google-workspace/callback";

export const PRODUCTION_APP_ORIGIN = "https://hrmny-os.vercel.app";

export function normalizeAppOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("empty origin");
  const withProto = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withProto);
  if (url.username || url.password) throw new Error("invalid origin");
  return `${url.protocol}//${url.host}`;
}

export function defaultGoogleWorkspaceOrigin(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return normalizeAppOrigin(appUrl);
  if (process.env.VERCEL_ENV === "production") return PRODUCTION_APP_ORIGIN;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return normalizeAppOrigin(vercel);
  return "http://localhost:3000";
}

export function isAllowedGoogleWorkspaceOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(normalizeAppOrigin(origin));
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return parsed.protocol === "http:";
  }
  if (parsed.protocol !== "https:") return false;
  if (host === "hrmny-os.vercel.app") return true;
  if (host.endsWith(".vercel.app") && host.startsWith("hrmny-os")) return true;
  const extras = [process.env.NEXT_PUBLIC_APP_URL, process.env.VERCEL_URL]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => {
      try {
        return new URL(normalizeAppOrigin(value)).host.toLowerCase();
      } catch {
        return "";
      }
    });
  return extras.includes(host);
}

export function resolveGoogleWorkspaceOrigin(requestOrigin?: string): string {
  if (requestOrigin?.trim()) {
    try {
      const origin = normalizeAppOrigin(requestOrigin);
      if (isAllowedGoogleWorkspaceOrigin(origin)) return origin;
    } catch {
      // Ignore a forged or unparseable origin and fall back.
    }
  }
  return defaultGoogleWorkspaceOrigin();
}

export function explicitGoogleWorkspaceRedirectUri(): string | null {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    process.env.GOOGLE_WORKSPACE_REDIRECT_URI?.trim() ||
    null
  );
}

export function googleWorkspaceRedirectUri(requestOrigin?: string): string {
  return (
    explicitGoogleWorkspaceRedirectUri() ||
    `${resolveGoogleWorkspaceOrigin(requestOrigin)}${GOOGLE_WORKSPACE_CALLBACK_PATH}`
  );
}

export function isAllowedGoogleWorkspaceRedirectUri(
  redirectUri: string,
): boolean {
  const explicit = explicitGoogleWorkspaceRedirectUri();
  if (explicit && redirectUri === explicit) return true;
  try {
    const url = new URL(redirectUri);
    return (
      url.pathname === GOOGLE_WORKSPACE_CALLBACK_PATH &&
      isAllowedGoogleWorkspaceOrigin(url.origin)
    );
  } catch {
    return false;
  }
}

export function googleWorkspaceConnectionsDest(redirectUri: string): URL {
  const dest = new URL("/settings/connections", new URL(redirectUri).origin);
  dest.hash = "conn-google_workspace";
  return dest;
}

export function signGoogleWorkspaceOAuthState(
  employeeId: string,
  redirectUri = googleWorkspaceRedirectUri(),
): string {
  const body = Buffer.from(
    JSON.stringify({
      employeeId,
      redirectUri,
      n: randomUUID(),
      exp: Date.now() + 15 * 60_000,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", oauthSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyGoogleWorkspaceOAuthState(state: string): {
  employeeId: string;
  redirectUri: string;
} {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Invalid Google Workspace OAuth state");
  const expected = createHmac("sha256", oauthSecret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid Google Workspace OAuth state signature");
  }
  const payload = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  ) as {
    employeeId?: string;
    redirectUri?: string;
    exp?: number;
  };
  if (!payload.employeeId || typeof payload.exp !== "number") {
    throw new Error("Invalid Google Workspace OAuth state payload");
  }
  if (payload.exp < Date.now()) {
    throw new Error("Google Workspace OAuth state expired");
  }
  const redirectUri =
    typeof payload.redirectUri === "string" && payload.redirectUri.trim()
      ? payload.redirectUri.trim()
      : googleWorkspaceRedirectUri();
  if (!isAllowedGoogleWorkspaceRedirectUri(redirectUri)) {
    throw new Error("Invalid Google Workspace OAuth redirect");
  }
  return { employeeId: payload.employeeId, redirectUri };
}

export function formatGoogleOAuthError(status: number, detail: string): string {
  let reason = `Google token exchange failed (${status})`;
  try {
    const parsed = JSON.parse(detail) as {
      error?: string;
      error_description?: string;
    };
    if (parsed.error_description || parsed.error) {
      reason = `Google token exchange failed (${status}): ${
        parsed.error_description ?? parsed.error
      }`;
    }
  } catch {
    if (detail.trim()) reason = `${reason}: ${detail.slice(0, 180)}`;
  }
  return reason;
}

export async function buildGoogleWorkspaceAuthorizeUrl(
  employeeId: string,
  opts?: { requestOrigin?: string },
): Promise<{
  redirectUrl: string;
  redirectUri: string;
}> {
  const clientId = googleWorkspaceClientId();
  if (!clientId || !googleWorkspaceClientSecret()) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET required for Google Workspace OAuth",
    );
  }
  const redirectUri = googleWorkspaceRedirectUri(opts?.requestOrigin);
  const state = signGoogleWorkspaceOAuthState(employeeId, redirectUri);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_WORKSPACE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  return {
    redirectUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    redirectUri,
  };
}

async function loadStoredRefreshToken(
  employeeId: string,
  email: string,
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ secretId: connectionAccount.secretId })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, employeeId),
        eq(connectionAccount.externalConnectionId, email),
        eq(connectionAccount.toolkit, "google_workspace"),
        eq(connectionAccount.scope, "staff"),
      ),
    )
    .limit(1);
  if (!row?.secretId) return null;
  const secrets = await db.execute(
    sql<{ decrypted_secret: string }>`
      select decrypted_secret
      from vault.decrypted_secrets
      where id = ${row.secretId}::uuid
      limit 1
    `,
  );
  const raw = secrets[0]?.decrypted_secret;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return GoogleWorkspaceSecretSchema.parse(JSON.parse(raw)).refreshToken;
  } catch {
    return null;
  }
}

export async function persistGoogleWorkspaceTokens(input: {
  employeeId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date;
  email: string;
}): Promise<{
  connectionAccountId: string;
  email: string;
  created: boolean;
  previousStatus: string | null;
}> {
  const db = getDb();
  if (!db) {
    throw new Error("DATABASE_URL required to persist Google Workspace tokens");
  }
  const email = z.string().email().parse(input.email.trim()).toLowerCase();
  const refreshToken =
    input.refreshToken?.trim() && input.refreshToken.trim().length >= 20
      ? input.refreshToken.trim()
      : await loadStoredRefreshToken(input.employeeId, email);
  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh token. Revoke hrmny OS under Google Account → Security → Third-party access, then Reconnect.",
    );
  }
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 55 * 60 * 1000);
  const secret = JSON.stringify({
    accessToken: input.accessToken,
    refreshToken,
    expiresAt: expiresAt.toISOString(),
  });

  const saved = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`google-mailbox:${input.employeeId}:${email}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(connectionAccount)
      .where(
        and(
          eq(connectionAccount.ownerEmployeeId, input.employeeId),
          eq(connectionAccount.externalConnectionId, email),
          eq(connectionAccount.toolkit, "google_workspace"),
          eq(connectionAccount.scope, "staff"),
        ),
      )
      .limit(1);

    let secretId = existing?.secretId ?? null;
    if (secretId) {
      await tx.execute(
        sql`select vault.update_secret(${secretId}::uuid, ${secret})`,
      );
    } else {
      const created = await tx.execute(
        sql<{ id: string }>`
          select vault.create_secret(
            ${secret},
            ${`hrmny:${input.employeeId}:google_workspace:${email}`},
            ${"Google Workspace OAuth tokens managed by hrmny OS"}
          ) as id
        `,
      );
      const createdId = created[0]?.id;
      secretId = typeof createdId === "string" ? createdId : null;
    }
    if (!secretId) throw new Error("Vault did not return a secret id");

    const values = {
      ownerEmployeeId: input.employeeId,
      toolkit: "google_workspace",
      scope: "staff" as const,
      authType: "oauth",
      label: email,
      secretId,
      externalConnectionId: email,
      status: "connected",
      expiresAt,
      lastTestedAt: new Date(),
      lastError: null as string | null,
      updatedAt: new Date(),
    };

    const [row] = existing
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

    await tx.insert(auditEvent).values({
      actorEmployeeId: input.employeeId,
      action: existing
        ? "connections.replaceOAuth"
        : "connections.connectOAuth",
      entityType: "connection_account",
      entityId: row!.connectionAccountId,
      before: existing ? { status: existing.status } : null,
      after: {
        toolkit: "google_workspace",
        status: "connected",
        account: email,
      },
    });
    return {
      connectionAccountId: row!.connectionAccountId,
      email,
      created: !existing,
      previousStatus: existing?.status ?? null,
    };
  });

  return saved;
}

async function exchangeGoogleAuthorizationCode(
  code: string,
  redirectUri: string,
) {
  const clientId = googleWorkspaceClientId();
  const clientSecret = googleWorkspaceClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials are not configured");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(formatGoogleOAuthError(response.status, detail));
  }
  return GoogleTokenResponseSchema.parse(await response.json());
}

export async function completeGoogleWorkspaceOAuth(input: {
  code: string;
  state: string;
}): Promise<{
  account: string;
  connectionAccountId: string;
  redirectUri: string;
}> {
  const { employeeId, redirectUri } = verifyGoogleWorkspaceOAuthState(
    input.state,
  );
  if (!googleWorkspaceClientConfigured()) {
    throw new Error("Google OAuth client credentials are not configured");
  }
  const tokens = await exchangeGoogleAuthorizationCode(input.code, redirectUri);
  const profileResponse = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { authorization: `Bearer ${tokens.access_token}` } },
  );
  if (!profileResponse.ok) {
    throw new Error("Google rejected the connection token");
  }
  const parsed = GoogleProfileSchema.safeParse(await profileResponse.json());
  if (!parsed.success) {
    throw new Error("Connect a verified Google account");
  }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const saved = await persistGoogleWorkspaceTokens({
    employeeId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    email: parsed.data.email,
  });
  return {
    account: saved.email,
    connectionAccountId: saved.connectionAccountId,
    redirectUri,
  };
}
