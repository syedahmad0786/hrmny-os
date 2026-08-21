import { beforeEach, describe, expect, it } from "vitest";
import {
  GoogleProfileSchema,
  getGoogleWorkspaceAccessToken,
} from "./trpc/connections-router";
import { createCaller } from "./trpc/root";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";

describe("Google Workspace connection", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "mock";
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
      }
    } finally {
      process.env.DATABASE_URL = prev;
    }
  });
});
