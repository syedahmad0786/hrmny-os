import { describe, expect, it } from "vitest";
import { createMemoryCache, cacheKeys } from "./index";

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
