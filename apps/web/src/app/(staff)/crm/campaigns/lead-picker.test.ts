import { describe, expect, it } from "vitest";
import { matchesCampaignLeadView } from "./lead-picker";

const operational = {
  companyName: "Emaar Hospitality Group",
  sector: "Hospitality",
  leadSourceLane: "apollo_intent",
};
const synthetic = {
  companyName: "E2E campaign prospect 123",
  sector: "Hospitality",
  leadSourceLane: "relationship_led",
};

describe("campaign lead picker", () => {
  it("hides synthetic leads by default and searches visible fields", () => {
    expect(matchesCampaignLeadView(synthetic, "", false)).toBe(false);
    expect(matchesCampaignLeadView(synthetic, "campaign", true)).toBe(true);
    expect(matchesCampaignLeadView(operational, "emaar", false)).toBe(true);
    expect(matchesCampaignLeadView(operational, "hospitality", false)).toBe(
      true,
    );
    expect(matchesCampaignLeadView(operational, "apollo_intent", false)).toBe(
      true,
    );
    expect(matchesCampaignLeadView(operational, "retail", false)).toBe(false);
  });
});
