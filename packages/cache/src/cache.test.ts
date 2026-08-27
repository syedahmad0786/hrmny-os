import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCache, createUpstashCache, cacheKeys } from "./index";

describe("@hrmny/cache memory", () => {
  it("get/set/del and prefix invalidate", async () => {
    const c = createMemoryCache();
    await c.set("crm:deals:a", "1");
    await c.set("crm:deals:b", "2");
    await c.set("other", "x");
    expect(await c.get("crm:deals:a")).toBe("1");
    expect(await c.invalidatePrefix("crm:deals:")).toBe(2);
    expect(await c.get("crm:deals:a")).toBeNull();
    expect(await c.get("other")).toBe("x");
    await c.del("other");
    expect(await c.get("other")).toBeNull();
  });

  it("respects ttl", async () => {
    const c = createMemoryCache();
    await c.set("k", "v", 0);
    // expiresAt in the past when ttlSeconds=0 → immediate miss after set
    expect(await c.get("k")).toBeNull();
  });

  it("exports stable key helpers", () => {
    expect(cacheKeys.dealList("staff")).toBe("crm:deals:staff");
    expect(cacheKeys.memoryRetrieve("d1", "h")).toBe("mem:retrieve:d1:h");
  });
});

describe("@hrmny/cache upstash SCAN invalidatePrefix", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scans MATCH prefix* and deletes each key", async () => {
    const calls: unknown[][] = [];
    vi.stubGlobal(
      "fetch",
      async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as unknown[];
        calls.push(body);
        if (body[0] === "SCAN") {
          return {
            ok: true,
            json: async () => ({ result: ["0", ["crm:deals:a", "crm:deals:b"]] }),
          };
        }
        if (body[0] === "DEL") {
          return { ok: true, json: async () => ({ result: 1 }) };
        }
        throw new Error(`unexpected ${JSON.stringify(body)}`);
      },
    );
    const c = createUpstashCache({
      url: "https://example.upstash.io",
      token: "t",
    });
    expect(await c.invalidatePrefix("crm:deals:")).toBe(2);
    expect(calls[0]).toEqual(["SCAN", "0", "MATCH", "crm:deals:*", "COUNT", "100"]);
    expect(calls.filter((row) => row[0] === "DEL")).toHaveLength(2);
  });
});
