import { describe, expect, it } from "vitest";
import { getAuthModeFromEnv } from "./auth-mode";

describe("auth mode environment boundary", () => {
  it.each([
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "production" },
    { NODE_ENV: "production", ALLOW_DEV_AUTH: "true" },
  ])("forces Supabase auth in hosted and production runtimes", (env) => {
    expect(getAuthModeFromEnv({ ...env, AUTH_MODE: "dev" })).toBe("supabase");
  });

  it("allows dev auth only in local development", () => {
    expect(
      getAuthModeFromEnv({ NODE_ENV: "development", AUTH_MODE: "dev" }),
    ).toBe("dev");
  });
});
