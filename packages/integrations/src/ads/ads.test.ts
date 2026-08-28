import { describe, expect, it } from "vitest";
import { IntegrationMisconfiguredError } from "../types";
import { createAdsInsightsAdapter, createAdsInsightsMock } from "./mock";

describe("AdsInsightsAdapter (read-only)", () => {
  it("mock returns deterministic Meta campaigns without spend writes", async () => {
    const ads = createAdsInsightsMock("meta");
    expect(ads.mode).toBe("mock");
    const accounts = await ads.listAccounts();
    expect(accounts[0]?.accountId).toMatch(/^act_mock_meta/);
    const insights = await ads.getInsights({
      accountId: accounts[0]!.accountId,
      since: "2026-08-01",
      until: "2026-08-27",
    });
    expect(insights.platform).toBe("meta");
    expect(insights.campaigns[0]?.spend).toMatch(/^\d+\.\d{2}$/);
    expect(insights).not.toHaveProperty("setBudget");
  });

  it("factory defaults to mock and live fails loud", () => {
    const ads = createAdsInsightsAdapter();
    expect(ads.mode).toBe("mock");
    expect(() => createAdsInsightsAdapter({ mode: "live" })).toThrow(
      IntegrationMisconfiguredError,
    );
  });
});
