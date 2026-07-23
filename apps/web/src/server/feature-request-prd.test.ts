import { describe, expect, it } from "vitest";
import {
  canTransitionFeatureRequest,
  draftFeatureRequestPrd,
} from "./feature-request-prd";

describe("feature request PRDs", () => {
  it("drafts an approval-ready PRD and enforces the workflow", () => {
    const prd = draftFeatureRequestPrd(
      "Client report",
      "Clients need weekly ROI",
    );
    expect(prd.problem).toBe("Clients need weekly ROI");
    expect(prd.acceptanceCriteria).toHaveLength(3);
    expect(canTransitionFeatureRequest("draft", "review")).toBe(true);
    expect(canTransitionFeatureRequest("review", "approved")).toBe(true);
    expect(canTransitionFeatureRequest("draft", "shipped")).toBe(false);
  });
});
