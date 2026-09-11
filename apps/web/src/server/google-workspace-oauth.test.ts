import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveActiveStaffById = vi.hoisted(() => vi.fn());
vi.mock("./auth/session", () => ({ resolveActiveStaffById }));
import {
  googleWorkspaceClientConfigured,
  googleWorkspaceRedirectUri,
  signGoogleWorkspaceOAuthState,
  verifyGoogleWorkspaceOAuthState,
  buildGoogleWorkspaceAuthorizeUrl,
  completeGoogleWorkspaceOAuth,
  formatGoogleOAuthError,
  GoogleTokenResponseSchema,
  GoogleWorkspaceSecretSchema,
  GOOGLE_CHAT_READ_SCOPES,
  hasGoogleChatReadScopes,
  resolveGoogleWorkspaceGrantedScopes,
} from "./google-workspace-oauth";

const ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_WORKSPACE_REDIRECT_URI",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "GOOGLE_OAUTH_STATE_SECRET",
  "CRON_SECRET",
  "client_id",
  "client_secret",
] as const;

const snapshot: Record<string, string | undefined> = {};

function rememberEnv() {
  for (const key of ENV_KEYS) snapshot[key] = process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("google workspace oauth helpers", () => {
  rememberEnv();
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_STATE_SECRET = "g".repeat(32);
    resolveActiveStaffById.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it("round-trips a signed employee state with the redirect URI", () => {
    const employeeId = "c0000000-0000-4000-8000-000000000011";
    const redirectUri =
      "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback";
    const state = signGoogleWorkspaceOAuthState(employeeId, redirectUri);
    expect(verifyGoogleWorkspaceOAuthState(state)).toEqual({
      employeeId,
      redirectUri,
      intent: "mailbox",
    });
  });

  it("rejects tampered or expired-looking state", () => {
    const state = signGoogleWorkspaceOAuthState(
      "c0000000-0000-4000-8000-000000000011",
    );
    expect(() => verifyGoogleWorkspaceOAuthState(state + "x")).toThrow(
      /signature|Invalid/,
    );
    expect(() => verifyGoogleWorkspaceOAuthState("not-a-state")).toThrow(
      /Invalid/,
    );
  });

  it("builds the production callback URI from NEXT_PUBLIC_APP_URL", () => {
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    delete process.env.GOOGLE_WORKSPACE_REDIRECT_URI;
    process.env.NEXT_PUBLIC_APP_URL = "https://hrmny-os.vercel.app";
    expect(googleWorkspaceRedirectUri()).toBe(
      "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback",
    );
  });

  it("uses the page origin when allowlisted so staff do not need GOOGLE_OAUTH_REDIRECT_URI", () => {
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    delete process.env.GOOGLE_WORKSPACE_REDIRECT_URI;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(googleWorkspaceRedirectUri("https://hrmny-os.vercel.app")).toBe(
      "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback",
    );
  });

  it("falls back to the stable production alias when Vercel env is production", () => {
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    delete process.env.GOOGLE_WORKSPACE_REDIRECT_URI;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "hrmny-os-abc123.vercel.app";
    expect(googleWorkspaceRedirectUri()).toBe(
      "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback",
    );
  });

  it("rejects a forged origin and keeps the production callback", () => {
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    delete process.env.GOOGLE_WORKSPACE_REDIRECT_URI;
    process.env.NEXT_PUBLIC_APP_URL = "https://hrmny-os.vercel.app";
    expect(googleWorkspaceRedirectUri("https://evil.example")).toBe(
      "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback",
    );
  });

  it("prefers an explicit redirect override", () => {
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      "http://localhost:3000/api/integrations/google-workspace/callback";
    expect(googleWorkspaceRedirectUri()).toBe(
      "http://localhost:3000/api/integrations/google-workspace/callback",
    );
  });

  it("reports client configuration from GOOGLE_OAUTH_*", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.client_id;
    delete process.env.client_secret;
    expect(googleWorkspaceClientConfigured()).toBe(false);
    process.env.GOOGLE_OAUTH_CLIENT_ID =
      "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    expect(googleWorkspaceClientConfigured()).toBe(true);
  });

  it("does not reuse an unrelated secret for OAuth state", () => {
    delete process.env.GOOGLE_OAUTH_STATE_SECRET;
    process.env.CRON_SECRET = "c".repeat(32);
    expect(() =>
      signGoogleWorkspaceOAuthState("c0000000-0000-4000-8000-000000000011"),
    ).toThrow(/GOOGLE_OAUTH_STATE_SECRET/);
  });

  it("builds account selection without a mailbox domain restriction", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID =
      "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://hrmny-os.vercel.app";
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    const { redirectUrl, redirectUri } = await buildGoogleWorkspaceAuthorizeUrl(
      "c0000000-0000-4000-8000-000000000011",
    );
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
    expect(url.searchParams.get("hd")).toBeNull();
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback",
    );
    expect(redirectUri).toBe(
      "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback",
    );
    expect(url.searchParams.get("scope") ?? "").toContain("gmail.send");
    expect(url.searchParams.get("scope") ?? "").toContain("gmail.readonly");
    expect(url.searchParams.get("scope") ?? "").not.toContain("gmail.modify");
    expect(url.searchParams.get("scope") ?? "").toContain(
      "calendar.events.readonly",
    );
    expect(url.searchParams.get("scope") ?? "").not.toContain(
      "auth/spreadsheets",
    );
    expect(() =>
      verifyGoogleWorkspaceOAuthState(url.searchParams.get("state") ?? ""),
    ).not.toThrow();
  });

  it("signs a Chat read-consent intent and requests only its two extra scopes", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID =
      "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    const { redirectUrl } = await buildGoogleWorkspaceAuthorizeUrl(
      "c0000000-0000-4000-8000-000000000011",
      { intent: "google_chat_read" },
    );
    const url = new URL(redirectUrl);
    expect(
      verifyGoogleWorkspaceOAuthState(url.searchParams.get("state")!).intent,
    ).toBe("google_chat_read");
    const requested = url.searchParams.get("scope") ?? "";
    for (const scope of GOOGLE_CHAT_READ_SCOPES)
      expect(requested).toContain(scope);
    expect(requested).toContain("gmail.readonly");
    expect(hasGoogleChatReadScopes(GOOGLE_CHAT_READ_SCOPES.join(" "))).toBe(
      true,
    );
    expect(hasGoogleChatReadScopes(GOOGLE_CHAT_READ_SCOPES[0])).toBe(false);
  });

  it("completeGoogleWorkspaceOAuth rejects bad state before calling Google", async () => {
    await expect(
      completeGoogleWorkspaceOAuth({
        code: "x",
        state: "bad",
        actorEmployeeId: "owner",
      }),
    ).rejects.toThrow(/state/i);
  });

  it("rejects a forwarded consent callback before exchanging or saving mailbox tokens", async () => {
    const state = signGoogleWorkspaceOAuthState(
      "c0000000-0000-4000-8000-000000000011",
      undefined,
      "google_chat_read",
    );
    await expect(
      completeGoogleWorkspaceOAuth({
        code: "unused-code",
        state,
        actorEmployeeId: "c0000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toThrow(/employee who started/);
  });

  function stubChatConsentCallback(input: {
    staff: { actorType: string; email: string } | null;
    profile?: { email: string; hd?: string };
    scope?: string;
  }) {
    process.env.GOOGLE_OAUTH_CLIENT_ID =
      "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    resolveActiveStaffById.mockResolvedValue(input.staff);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "a".repeat(20),
              expires_in: 3600,
              scope: input.scope,
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              email: input.profile?.email ?? "developer@hrmny.co",
              email_verified: true,
              hd: input.profile?.hd ?? "hrmny.co",
            }),
            { status: 200 },
          ),
        ),
    );
  }

  it("rejects an inactive staff actor after the Chat callback", async () => {
    stubChatConsentCallback({
      staff: null,
      scope: GOOGLE_CHAT_READ_SCOPES.join(" "),
    });
    await expect(
      completeGoogleWorkspaceOAuth({
        code: "mock-code",
        state: signGoogleWorkspaceOAuthState(
          "c0000000-0000-4000-8000-000000000011",
          undefined,
          "google_chat_read",
        ),
        actorEmployeeId: "c0000000-0000-4000-8000-000000000011",
      }),
    ).rejects.toThrow(/active HRMNY staff account/i);
  });

  it("rejects a mismatched Google account after the Chat callback", async () => {
    stubChatConsentCallback({
      staff: { actorType: "staff", email: "developer@hrmny.co" },
      profile: { email: "other@hrmny.co", hd: "hrmny.co" },
      scope: GOOGLE_CHAT_READ_SCOPES.join(" "),
    });
    await expect(
      completeGoogleWorkspaceOAuth({
        code: "mock-code",
        state: signGoogleWorkspaceOAuthState(
          "c0000000-0000-4000-8000-000000000011",
          undefined,
          "google_chat_read",
        ),
        actorEmployeeId: "c0000000-0000-4000-8000-000000000011",
      }),
    ).rejects.toThrow(/active HRMNY staff account/i);
  });

  it("rejects a non-HRMNY hosted domain after the Chat callback", async () => {
    stubChatConsentCallback({
      staff: { actorType: "staff", email: "developer@hrmny.co" },
      profile: { email: "developer@hrmny.co", hd: "example.test" },
      scope: GOOGLE_CHAT_READ_SCOPES.join(" "),
    });
    await expect(
      completeGoogleWorkspaceOAuth({
        code: "mock-code",
        state: signGoogleWorkspaceOAuthState(
          "c0000000-0000-4000-8000-000000000011",
          undefined,
          "google_chat_read",
        ),
        actorEmployeeId: "c0000000-0000-4000-8000-000000000011",
      }),
    ).rejects.toThrow(/active HRMNY staff account/i);
  });

  it("rejects missing or partial provider-returned Chat grant evidence", async () => {
    stubChatConsentCallback({
      staff: { actorType: "staff", email: "developer@hrmny.co" },
      scope: GOOGLE_CHAT_READ_SCOPES[0],
    });
    await expect(
      completeGoogleWorkspaceOAuth({
        code: "mock-code",
        state: signGoogleWorkspaceOAuthState(
          "c0000000-0000-4000-8000-000000000011",
          undefined,
          "google_chat_read",
        ),
        actorEmployeeId: "c0000000-0000-4000-8000-000000000011",
      }),
    ).rejects.toThrow(/both returned Chat read scopes/i);
  });

  it("formats Google OAuth error JSON", () => {
    expect(
      formatGoogleOAuthError(
        400,
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Bad Request",
        }),
      ),
    ).toBe("Google token exchange failed (400): Bad Request");
  });

  it("records provider-returned scopes from an initial token exchange", () => {
    const token = GoogleTokenResponseSchema.parse({
      access_token: "a".repeat(20),
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/gmail.readonly openid",
    });
    expect(resolveGoogleWorkspaceGrantedScopes(token.scope)).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "openid",
    ]);
  });

  it("treats legacy stored credentials without scope evidence as unknown", () => {
    expect(
      GoogleWorkspaceSecretSchema.parse({
        accessToken: "a".repeat(20),
        refreshToken: "r".repeat(20),
        expiresAt: "2026-09-11T00:00:00.000Z",
      }).grantedScopes,
    ).toEqual([]);
  });

  it("retains verified scopes when a refresh omits scope, and replaces them when it returns a narrower grant", () => {
    const existing = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ];
    expect(resolveGoogleWorkspaceGrantedScopes(undefined, existing)).toEqual(
      existing,
    );
    expect(
      resolveGoogleWorkspaceGrantedScopes(
        "https://www.googleapis.com/auth/gmail.readonly",
        existing,
      ),
    ).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });
});
