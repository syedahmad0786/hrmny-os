import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("DATABASE_MODE", () => {
  it("forces memory mode without inspecting DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_MODE", "memory");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://configured-but-unused.invalid/db",
    );
    vi.stubEnv("NODE_ENV", "test");

    const { getDb } = await import("./db");

    expect(getDb()).toBeNull();
  });

  it("requires the explicit dev-auth gate for production-mode memory tests", async () => {
    vi.stubEnv("DATABASE_MODE", "memory");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "supabase");
    vi.stubEnv("ALLOW_DEV_AUTH", "false");

    const { getDb } = await import("./db");

    expect(() => getDb()).toThrow(/forbidden in production/i);
  });

  it("allows production-mode memory tests behind the dev-auth gate", async () => {
    vi.stubEnv("DATABASE_MODE", "memory");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("ALLOW_DEV_AUTH", "true");

    const { getDb } = await import("./db");

    expect(getDb()).toBeNull();
  });

  it("fails closed when postgres mode has no connection reference", async () => {
    vi.stubEnv("DATABASE_MODE", "postgres");
    vi.stubEnv("DATABASE_URL", "");

    const { getDb } = await import("./db");

    expect(() => getDb()).toThrow(/requires DATABASE_URL/i);
  });
});
