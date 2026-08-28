import { IntegrationMisconfiguredError } from "../types";
import type {
  AdsAccountInsights,
  AdsInsightsAdapter,
  AdsPlatform,
} from "../contracts";

/**
 * M11 read-only ads insights. Official live surfaces (not called here):
 * - Meta Marketing API Insights: https://developers.facebook.com/docs/marketing-api/insights
 *   GitHub: https://github.com/facebook/facebook-nodejs-business-sdk
 * - Google Ads API: https://developers.google.com/google-ads/api/docs/start
 *   GitHub: https://github.com/googleads/google-ads-nodejs
 *
 * Live HTTP is fail-loud and unimplemented until a separately approved
 * read-only ads scope + tokens arrive. Mock is deterministic for dashboards.
 */

export type AdsInsightsConfig = {
  platform?: AdsPlatform;
  mode?: "mock" | "live";
};

function resolvePlatform(config: AdsInsightsConfig): AdsPlatform {
  if (config.platform === "google" || config.platform === "meta") {
    return config.platform;
  }
  const env = process.env.ADS_INSIGHTS_PLATFORM?.toLowerCase();
  return env === "google" ? "google" : "meta";
}

function resolveMode(config: AdsInsightsConfig): "mock" | "live" {
  if (config.mode === "mock") return "mock";
  if (config.mode === "live") return "live";
  const env = process.env.ADS_INSIGHTS_MODE?.toLowerCase();
  if (env === "live") return "live";
  return "mock";
}

const FIXTURES: Record<AdsPlatform, AdsAccountInsights> = {
  meta: {
    platform: "meta",
    accountId: "act_mock_meta_001",
    since: "2026-08-01",
    until: "2026-08-27",
    campaigns: [
      {
        campaignId: "meta-camp-1001",
        campaignName: "Hrmny — awareness (mock)",
        status: "ACTIVE",
        spend: "1250.00",
        budget: "5000.00",
        impressions: 48000,
        clicks: 960,
        conversions: 18,
        currency: "AED",
      },
    ],
  },
  google: {
    platform: "google",
    accountId: "customers/mock-google-001",
    since: "2026-08-01",
    until: "2026-08-27",
    campaigns: [
      {
        campaignId: "google-camp-2001",
        campaignName: "Hrmny — search (mock)",
        status: "ENABLED",
        spend: "890.00",
        budget: "3000.00",
        impressions: 22000,
        clicks: 1100,
        conversions: 24,
        currency: "AED",
      },
    ],
  },
};

export function createAdsInsightsMock(
  platform: AdsPlatform = "meta",
): AdsInsightsAdapter {
  return {
    platform,
    mode: "mock",
    async listAccounts() {
      const fixture = FIXTURES[platform];
      return [{ accountId: fixture.accountId, name: `${platform} mock account` }];
    },
    async getInsights(input) {
      const fixture = FIXTURES[platform];
      return {
        ...fixture,
        accountId: input.accountId || fixture.accountId,
        since: input.since,
        until: input.until,
      };
    },
  };
}

export function createAdsInsightsLive(
  config: AdsInsightsConfig = {},
): AdsInsightsAdapter {
  const platform = resolvePlatform(config);
  throw new IntegrationMisconfiguredError(
    `ads_${platform}`,
    "Live ads insights are not wired — read-only Meta/Google tokens and an approved M11 scope are required. Use mode=mock.",
  );
}

export function createAdsInsightsAdapter(
  config: AdsInsightsConfig = {},
): AdsInsightsAdapter {
  const platform = resolvePlatform(config);
  if (resolveMode(config) === "live") {
    return createAdsInsightsLive({ ...config, platform });
  }
  return createAdsInsightsMock(platform);
}
