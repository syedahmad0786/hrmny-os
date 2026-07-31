import { afterEach, describe, expect, it, vi } from "vitest";

describe("getDb production fail-loud", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("allows null db in local/dev when DATABASE_URL is unset", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("ALLOW_MEMORY_STORE", "");
    vi.stubEnv("REQUIRE_DATABASE", "");
    const { getDb } = await import("./db");
    expect(getDb()).toBeNull();
  });

  it("throws when AUTH_MODE=supabase and DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH_MODE", "supabase");
    vi.stubEnv("ALLOW_MEMORY_STORE", "");
    const { getDb } = await import("./db");
    expect(() => getDb()).toThrow(/DATABASE_URL is required/);
  });

  it("does not allow ALLOW_MEMORY_STORE to override hosted safety", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH_MODE", "supabase");
    vi.stubEnv("ALLOW_MEMORY_STORE", "true");
    vi.stubEnv("VERCEL_ENV", "preview");
    const { getDb } = await import("./db");
    expect(() => getDb()).toThrow(/DATABASE_URL is required/);
  });
});
