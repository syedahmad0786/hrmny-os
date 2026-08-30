import { describe, expect, it } from "vitest";

describe("ordinary web test boundary", () => {
  it("overrides inherited databases/providers and denies outbound network", async () => {
    expect(process.env.DATABASE_MODE).toBe("auto");
    expect(process.env.DATABASE_URL).toBe("");
    expect(process.env.LLM_PROVIDER).toBe("mock");
    expect(process.env.APOLLO_MODE).toBe("mock");
    expect(process.env.XERO_WRITE_ENABLED).toBe("false");
    await expect(
      fetch("https://api.apollo.io/api/v1/mixed_people/search"),
    ).rejects.toThrow("LIVE_NETWORK_FORBIDDEN_IN_ORDINARY_TEST:api.apollo.io");
  });
});
