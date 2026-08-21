import { describe, expect, it } from "vitest";
import {
  GoogleProfileSchema,
  getGoogleWorkspaceAccessToken,
} from "./trpc/connections-router";

describe("Google Workspace connection", () => {
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
});
