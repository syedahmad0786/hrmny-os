import { describe, expect, it } from "vitest";
import {
  classifyDiscoveryDisposition,
  classifyDiscoveryReviewState,
  discoveryIdentityKey,
  isAwardedAppointment,
  isClaimGroundedInExcerpt,
} from "./discovery-evidence";

const now = new Date("2026-09-20T00:00:00.000Z");

describe("Discovery evidence rules", () => {
  it("normalizes identity across website and source host", () => {
    expect(
      discoveryIdentityKey({
        companyName: "  Campaign ME  ",
        website: "https://www.CampaignME.com/latest",
      }),
    ).toEqual({
      companyName: "campaign me",
      host: "campaignme.com",
    });
  });

  it("classifies undated, stale, awarded and unsupported claims", () => {
    expect(
      classifyDiscoveryDisposition({
        opportunityKind: "submission",
        excerpt: "A brand opened a review.",
        whyNow: "Relevant brief",
        eventDate: null,
        now,
      }),
    ).toMatchObject({
      disposition: "undated",
      reviewState: "needs_evidence",
    });
    expect(
      classifyDiscoveryDisposition({
        opportunityKind: "submission",
        excerpt: "A brand opened a review.",
        whyNow: "Relevant brief",
        eventDate: "2026-07-01",
        now,
      }),
    ).toMatchObject({
      disposition: "stale",
      reviewState: "needs_evidence",
    });
    expect(
      classifyDiscoveryDisposition({
        opportunityKind: "submission",
        excerpt: "The issuer awarded the account to another agency.",
        whyNow: "Already-awarded appointment",
        eventDate: "2026-09-18",
        now,
      }),
    ).toMatchObject({
      disposition: "awarded",
      reviewState: "parked",
    });
    expect(
      classifyDiscoveryDisposition({
        opportunityKind: "submission",
        excerpt: "The brand opened a regional review in Dubai.",
        whyNow: "Buyer has approved AED 400000",
        eventDate: "2026-09-18",
        now,
      }),
    ).toMatchObject({
      disposition: "unsupported",
      reviewState: "needs_evidence",
    });
    expect(
      classifyDiscoveryReviewState({
        opportunityKind: "tender",
        eventDate: "2020-01-01",
        now,
      }),
    ).toBe("needs_review");
    expect(isAwardedAppointment("agency of record appointed last week")).toBe(
      true,
    );
    expect(
      isClaimGroundedInExcerpt(
        "regional review in Dubai",
        "The brand opened a regional review in Dubai.",
      ),
    ).toBe(true);
  });
});
