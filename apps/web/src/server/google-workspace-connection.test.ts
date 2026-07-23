import { describe, expect, it } from "vitest";
import { GoogleProfileSchema } from "./trpc/connections-router";

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
});
