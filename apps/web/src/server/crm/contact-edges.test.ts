import { afterEach, describe, expect, it, vi } from "vitest";

describe("contact edges without DATABASE_URL", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns null/empty when memory mode (no DB)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH_MODE", "dev");
    const { upsertContactEdge, listContactEdges } = await import(
      "./contact-edges"
    );
    const edge = await upsertContactEdge({
      fromContact: "11111111-1111-1111-1111-111111111111",
      toContact: "22222222-2222-2222-2222-222222222222",
      relation: "knows",
    });
    expect(edge).toBeNull();
    expect(
      await listContactEdges("11111111-1111-1111-1111-111111111111"),
    ).toEqual([]);
  });

  it("rejects self edges", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/db");
    vi.stubEnv("AUTH_MODE", "dev");
    // Force getDb null by clearing URL after module load pattern — use empty URL.
    vi.stubEnv("DATABASE_URL", "");
    const { upsertContactEdge } = await import("./contact-edges");
    // Without DB, self-check still runs before persist.
    await expect(
      upsertContactEdge({
        fromContact: "11111111-1111-1111-1111-111111111111",
        toContact: "11111111-1111-1111-1111-111111111111",
        relation: "self",
      }),
    ).rejects.toThrow(/self-referential/);
  });
});
