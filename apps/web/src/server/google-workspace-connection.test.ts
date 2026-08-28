import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleProfileSchema,
  getGoogleWorkspaceAccessToken,
} from "./trpc/connections-router";
import { createCaller } from "./trpc/root";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { buildGoogleWorkspaceAuthorizeUrl } from "./google-workspace-oauth";

describe("Google Workspace connection", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "mock";
    process.env.GOOGLE_OAUTH_STATE_SECRET = "g".repeat(32);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts verified hrmny accounts and rejects personal accounts", () => {
    expect(
      GoogleProfileSchema.parse({
        email: "developer@hrmny.co",
        email_verified: true,
      }).email,
    ).toBe("developer@hrmny.co");
    expect(() =>
      GoogleProfileSchema.parse({
        email: "developer@gmail.com",
        email_verified: true,
      }),
    ).toThrow();
  });

  it("saveApiKey persists in memory when DATABASE_URL is missing", async () => {
    const { clearMemoryApiKeys, getMemoryApiKey } = await import(
      "./integrations/memory-keys"
    );
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "";
    clearMemoryApiKeys();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    try {
      const user = resolveDevUser("partner");
      const caller = createCaller({
        user,
        employeeId: user.employeeId,
        roles: user.roles,
        canViewMargin: sessionCanViewMargin(user),
      });
      const saved = await caller.connections.saveApiKey({
        toolkit: "n8n",
        apiKey: "n8n-memory-test-key",
      });
      expect(saved.store).toBe("memory");
      expect(saved.hasSecret).toBe(true);
      expect(getMemoryApiKey("n8n")).toBe("n8n-memory-test-key");
      const rows = await caller.connections.list();
      expect(rows.find((row) => row.toolkit === "n8n")?.hasSecret).toBe(true);
    } finally {
      clearMemoryApiKeys();
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it("returns null without DATABASE_URL (memory mode)", async () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "";
    try {
      await expect(
        getGoogleWorkspaceAccessToken("c0000000-0000-4000-8000-000000000001"),
      ).resolves.toBeNull();
    } finally {
      process.env.DATABASE_URL = prev;
    }
  });

  it("probeGoogleWorkspace reports missing when no token (memory mode)", async () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "";
    try {
      const user = resolveDevUser("partner");
      const caller = createCaller({
        user,
        employeeId: user.employeeId,
        roles: user.roles,
        canViewMargin: sessionCanViewMargin(user),
      });
      const result = await caller.connections.probeGoogleWorkspace();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe("missing");
        expect(result.reason).toMatch(/connect first/i);
        expect(result.reconnectRequired).toBe(true);
      }
    } finally {
      process.env.DATABASE_URL = prev;
    }
  });

  it("list marks google_workspace not ready without OAuth client", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const prevDb = process.env.DATABASE_URL;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.client_id;
    delete process.env.client_secret;
    process.env.DATABASE_URL = "";
    try {
      const user = resolveDevUser("partner");
      const caller = createCaller({
        user,
        employeeId: user.employeeId,
        roles: user.roles,
        canViewMargin: sessionCanViewMargin(user),
      });
      const rows = await caller.connections.list();
      const gw = rows.find((row) => row.toolkit === "google_workspace");
      expect(gw?.ready).toBe(false);
      expect(rows[0]?.toolkit).toBe("google_workspace");
    } finally {
      if (prevDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDb;
      if (prevId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });

  it("startGoogleWorkspaceOAuth fails without client credentials", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.client_id;
    delete process.env.client_secret;
    try {
      const user = resolveDevUser("partner");
      const caller = createCaller({
        user,
        employeeId: user.employeeId,
        roles: user.roles,
        canViewMargin: sessionCanViewMargin(user),
      });
      await expect(caller.connections.startGoogleWorkspaceOAuth()).rejects.toThrow(
        /GOOGLE_OAUTH_CLIENT/,
      );
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });

  it("startGoogleWorkspaceOAuth returns a Google consent URL when configured", async () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const prevApp = process.env.NEXT_PUBLIC_APP_URL;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://hrmny-os.vercel.app";
    try {
      const user = resolveDevUser("partner");
      const caller = createCaller({
        user,
        employeeId: user.employeeId,
        roles: user.roles,
        canViewMargin: sessionCanViewMargin(user),
      });
      const result = await caller.connections.startGoogleWorkspaceOAuth({
        origin: "https://hrmny-os.vercel.app",
      });
      expect(result.redirectUrl).toContain("accounts.google.com");
      expect(result.redirectUri).toBe(
        "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback",
      );
      expect(new URL(result.redirectUrl).searchParams.get("redirect_uri")).toBe(
        result.redirectUri,
      );
      const built = await buildGoogleWorkspaceAuthorizeUrl(user.employeeId!, {
        requestOrigin: "https://hrmny-os.vercel.app",
      });
      expect(new URL(built.redirectUrl).searchParams.get("hd")).toBe("hrmny.co");
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
      if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prevApp;
    }
  });
});
