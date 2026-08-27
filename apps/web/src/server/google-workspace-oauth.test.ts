import { afterEach, describe, expect, it } from "vitest";
import {
  googleWorkspaceClientConfigured,
  googleWorkspaceRedirectUri,
  signGoogleWorkspaceOAuthState,
  verifyGoogleWorkspaceOAuthState,
  buildGoogleWorkspaceAuthorizeUrl,
  completeGoogleWorkspaceOAuth,
  formatGoogleOAuthError,
} from "./google-workspace-oauth";

const ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_WORKSPACE_REDIRECT_URI",
  "NEXT_PUBLIC_APP_URL",
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
  afterEach(() => restoreEnv());

  it("round-trips a signed employee state", () => {
    const employeeId = "c0000000-0000-4000-8000-000000000011";
    const state = signGoogleWorkspaceOAuthState(employeeId);
    expect(verifyGoogleWorkspaceOAuthState(state)).toEqual({ employeeId });
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
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    expect(googleWorkspaceClientConfigured()).toBe(true);
  });

  it("builds an offline consent URL for @hrmny.co", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://hrmny-os.vercel.app";
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    const { redirectUrl } = await buildGoogleWorkspaceAuthorizeUrl(
      "c0000000-0000-4000-8000-000000000011",
    );
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("hd")).toBe("hrmny.co");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback",
    );
    expect(url.searchParams.get("scope") ?? "").toContain("gmail.send");
    expect(() =>
      verifyGoogleWorkspaceOAuthState(url.searchParams.get("state") ?? ""),
    ).not.toThrow();
  });

  it("completeGoogleWorkspaceOAuth rejects bad state before calling Google", async () => {
    await expect(
      completeGoogleWorkspaceOAuth({ code: "x", state: "bad" }),
    ).rejects.toThrow(/state/i);
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
});
