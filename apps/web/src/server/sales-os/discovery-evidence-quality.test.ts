import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import {
  resetMemoryDiscoveryCandidates,
  submitDiscoveryCandidate,
} from "./discovery-candidates";
import { evaluateDiscoveryEvidence } from "./discovery-interpretation";
import { importDiscoveryIntentEvidence } from "./discovery-import";

const actor = {
  actorEmployeeId: "c0000000-0000-4000-8000-000000000002",
  isAdmin: false,
};

const now = new Date("2026-09-20T00:00:00.000Z");

function submission(
  overrides: Partial<Parameters<typeof submitDiscoveryCandidate>[0]["values"]> = {},
) {
  return {
    requestId: randomUUID(),
    companyName: "Quality House Dubai",
    website: "https://campaignme.com",
    whyNow: "A dated agency review opened a relevant UAE brief.",
    sourceUrl: `https://campaignme.com/latest/quality-${randomUUID()}`,
    excerpt: "The brand opened a regional creative review in Dubai.",
    eventDate: "2026-09-18",
    visibilityScope: "public" as const,
    ...overrides,
  };
}

describe("Discovery evidence quality fixtures", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_MODE", "memory");
    resetMemoryDiscoveryCandidates();
    resetCrmMemory();
  });

  it("sends stale, undated, awarded, duplicate and unsupported claims to truthful states", async () => {
    const stale = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "Stale Signal Co",
        eventDate: "2026-07-01",
      }),
    });
    expect(stale.reviewState).toBe("needs_evidence");
    expect(stale.evaluation?.disposition).toBe("stale");

    const undated = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "Undated Signal Co",
        website: "https://gulfbusiness.com",
        sourceUrl: "https://gulfbusiness.com/latest/undated",
        eventDate: undefined,
      }),
    });
    expect(undated.reviewState).toBe("needs_evidence");
    expect(undated.evaluation?.disposition).toBe("undated");

    const awarded = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "Awarded Signal Co",
        website: "https://communicateonline.me",
        sourceUrl: "https://communicateonline.me/news/awarded",
        excerpt: "The issuer awarded the account to another agency last week.",
        whyNow: "Already-awarded appointment is intelligence, not an open pitch.",
      }),
    });
    expect(awarded.reviewState).toBe("parked");
    expect(awarded.evaluation?.disposition).toBe("awarded");
    expect(awarded.decisionReason).toMatch(/intelligence, not an open pitch/i);

    const first = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "Duplicate Signal Co",
        website: "https://gulfnews.com",
        sourceUrl: "https://gulfnews.com/business/duplicate",
        whyNow: "Same opportunity key must not open twice.",
      }),
    });
    const duplicate = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "Duplicate Signal Co",
        website: "https://gulfnews.com",
        sourceUrl: "https://gulfnews.com/business/duplicate",
        whyNow: "Same opportunity key must not open twice.",
      }),
    });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.evaluation?.disposition).toBe("duplicate");

    const unsupported = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "Unsupported Signal Co",
        website: "https://www.thenationalnews.com",
        sourceUrl: "https://www.thenationalnews.com/business/unsupported",
        excerpt: "The brand opened a regional review in Dubai.",
        whyNow: "Buyer has approved AED 400000",
      }),
    });
    expect(unsupported.reviewState).toBe("needs_evidence");
    expect(unsupported.evaluation?.disposition).toBe("unsupported");
  });

  it("keeps tenders off the 30-day news rule and never sends private excerpts to the mock packet", async () => {
    const tender = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "RTA Tender",
        website: "https://www.rta.ae",
        sourceUrl: "https://www.rta.ae/wps/portal/tender",
        discoveryChannel: "government",
        opportunityKind: "tender",
        eventDate: "2020-01-01",
        excerpt: "The authority published an open creative services tender.",
        whyNow: "Open government tender still has a deadline.",
      }),
    });
    expect(tender.reviewState).toBe("needs_review");
    expect(tender.evaluation?.disposition).toBe("actionable");

    const privateEval = await evaluateDiscoveryEvidence({
      opportunityKind: "submission",
      excerpt: "Confidential mailbox excerpt that must not enter the packet.",
      whyNow: "A dated listing named a relevant UAE brief.",
      eventDate: "2026-09-18",
      visibilityScope: "private",
      companyName: "Private Signal Co",
      website: "https://campaignme.com",
      sourceUrl: "https://campaignme.com/latest/private",
      now,
    });
    expect(privateEval.packet.excerptIncluded).toBe(false);
    expect(privateEval.packet.provider).toBe("unavailable");
    expect(privateEval.packet.interpretationStatus).toBe("skipped_private");
    expect(privateEval.packet.webSearch).toBe(false);
    expect(privateEval.interpretations).toEqual([]);

    const imported = await importDiscoveryIntentEvidence({
      ...actor,
      rows: [
        submission({
          companyName: "Imported Intent Co",
          website: "https://timeoutdubai.com",
          sourceUrl: "https://www.timeoutdubai.com/news/import",
          eventDate: undefined,
          discoveryChannel: "intent_import",
          opportunityKind: "intent",
        }),
      ],
    });
    expect(imported[0]?.reviewState).toBe("needs_evidence");
    expect(imported[0]?.evaluation?.packet.route).toBe("import");
    expect(imported[0]?.sourceKey).toBe("intent_import");
  });
});
