import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, auditEvent, connectionAccount, eq, sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "./db";

export const GOOGLE_WORKSPACE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

export const GoogleProfileSchema = z.object({
  email: z
    .string()
    .email()
    .refine((email) => email.toLowerCase().endsWith("@hrmny.co"), {
      message: "Connect an @hrmny.co Google Workspace account",
    }),
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
  return (
    process.env.GOOGLE_OAUTH_STATE_SECRET?.trim() ||
    process.env.XERO_OAUTH_STATE_SECRET?.trim() ||
    process.env.SUPABASE_JWT_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "hrmny-google-workspace-dev-state"
  );
}

export function googleWorkspaceClientId(): string | null {
  return (
    (process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.client_id)?.trim() ||
    null
  );
}

export function googleWorkspaceClientSecret(): string | null {
  return (
    (
      process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.client_secret
    )?.trim() || null
  );
}

export function googleWorkspaceClientConfigured(): boolean {
  return Boolean(googleWorkspaceClientId() && googleWorkspaceClientSecret());
}

export function googleWorkspaceRedirectUri(): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    process.env.GOOGLE_WORKSPACE_REDIRECT_URI?.trim() ||
    `${process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000"}/api/integrations/google-workspace/callback`
  );
}

export function signGoogleWorkspaceOAuthState(employeeId: string): string {
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

export function verifyGoogleWorkspaceOAuthState(state: string): {
  employeeId: string;
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
    exp?: number;
  };
  if (!payload.employeeId || typeof payload.exp !== "number") {
    throw new Error("Invalid Google Workspace OAuth state payload");
  }
  if (payload.exp < Date.now()) {
    throw new Error("Google Workspace OAuth state expired");
  }
  return { employeeId: payload.employeeId };
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

export async function buildGoogleWorkspaceAuthorizeUrl(employeeId: string): Promise<{
  redirectUrl: string;
}> {
  const clientId = googleWorkspaceClientId();
  if (!clientId || !googleWorkspaceClientSecret()) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET required for Google Workspace OAuth",
    );
  }
  const state = signGoogleWorkspaceOAuthState(employeeId);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleWorkspaceRedirectUri(),
    response_type: "code",
    scope: GOOGLE_WORKSPACE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    hd: "hrmny.co",
    state,
  });
  return {
    redirectUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  };
}

async function loadStoredRefreshToken(
  employeeId: string,
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ secretId: connectionAccount.secretId })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, employeeId),
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
  const email = input.email.toLowerCase();
  const refreshToken =
    input.refreshToken?.trim() && input.refreshToken.trim().length >= 20
      ? input.refreshToken.trim()
      : await loadStoredRefreshToken(input.employeeId);
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

  const [existing] = await db
    .select()
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, input.employeeId),
        eq(connectionAccount.toolkit, "google_workspace"),
        eq(connectionAccount.scope, "staff"),
      ),
    )
    .limit(1);

  const saved = await db.transaction(async (tx) => {
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
            ${`hrmny:${input.employeeId}:google_workspace`},
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
      label: "Google Workspace",
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
    return row!;
  });

  return {
    connectionAccountId: saved.connectionAccountId,
    email,
    created: !existing,
    previousStatus: existing?.status ?? null,
  };
}

async function exchangeGoogleAuthorizationCode(code: string) {
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
      redirect_uri: googleWorkspaceRedirectUri(),
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
}): Promise<{ account: string; connectionAccountId: string }> {
  const { employeeId } = verifyGoogleWorkspaceOAuthState(input.state);
  if (!googleWorkspaceClientConfigured()) {
    throw new Error("Google OAuth client credentials are not configured");
  }
  const tokens = await exchangeGoogleAuthorizationCode(input.code);
  const profileResponse = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { authorization: `Bearer ${tokens.access_token}` } },
  );
  if (!profileResponse.ok) {
    throw new Error("Google rejected the connection token");
  }
  const parsed = GoogleProfileSchema.safeParse(await profileResponse.json());
  if (!parsed.success) {
    throw new Error("Connect an @hrmny.co Google Workspace account");
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
  };
}
