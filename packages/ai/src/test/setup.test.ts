import { describe, expect, it } from "vitest";

describe("ordinary AI test boundary", () => {
  it("overrides inherited live-provider state and denies outbound network", async () => {
    expect(process.env.LLM_PROVIDER).toBe("mock");
    expect(process.env.OPENROUTER_LIVE_SMOKE).toBe("0");
    expect(process.env.OPENROUTER_API_KEY).toBe("");
    await expect(fetch("https://openrouter.ai/api/v1/models")).rejects.toThrow(
      "LIVE_NETWORK_FORBIDDEN_IN_ORDINARY_TEST:openrouter.ai",
    );
  });
});
