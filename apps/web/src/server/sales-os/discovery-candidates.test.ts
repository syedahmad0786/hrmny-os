import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import { createCompany, listContacts, listDeals } from "../crm/repository";
import {
  buildDiscoveryOpportunityKey,
  classifyDiscoveryReviewState,
  decideDiscoveryCandidate,
  getDiscoveryCandidate,
  listMemoryDiscoveryCandidateAudits,
  resetMemoryDiscoveryCandidates,
  submitDiscoveryCandidate,
} from "./discovery-candidates";

const actor = {
  actorEmployeeId: "c0000000-0000-4000-8000-000000000002",
  isAdmin: false,
};

const recentDate = () => new Date().toISOString().slice(0, 10);

function submission(
  overrides: Partial<Parameters<typeof submitDiscoveryCandidate>[0]["values"]> = {},
) {
  return {
    requestId: randomUUID(),
    companyName: "Campaign House Dubai",
    website: "https://campaignme.com",
    whyNow: "A dated agency review opened a relevant UAE brief.",
    sourceUrl: "https://campaignme.com/latest/review-candidate",
    excerpt: "The brand opened a regional creative review in Dubai.",
    eventDate: recentDate(),
    visibilityScope: "public" as const,
    ...overrides,
  };
}

describe("Discovery candidate store", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_MODE", "memory");
    resetMemoryDiscoveryCandidates();
    resetCrmMemory();
  });

  it("classifies undated and stale observations as needs evidence", () => {
    expect(
      classifyDiscoveryReviewState({
        opportunityKind: "submission",
        eventDate: null,
      }),
    ).toBe("needs_evidence");
    expect(
      classifyDiscoveryReviewState({
        opportunityKind: "hiring",
        eventDate: "2020-01-01",
      }),
    ).toBe("needs_evidence");
    expect(
      classifyDiscoveryReviewState({
        opportunityKind: "submission",
        eventDate: recentDate(),
      }),
    ).toBe("needs_review");
    expect(
      buildDiscoveryOpportunityKey({
        discoveryChannel: "government",
        opportunityKind: "tender",
        companyName: "RTA",
        whyNow: "Open tender",
        externalOpportunityId: "TEJ-99",
      }),
    ).toBe("government:tej-99");
  });

  it("accepts one company and never creates later-stage records", async () => {
    const created = await submitDiscoveryCandidate({
      ...actor,
      values: submission(),
    });
    expect(created.reviewState).toBe("needs_review");
    expect(created.qualificationState).toBe("not_assessed");
    const accepted = await decideDiscoveryCandidate({
      ...actor,
      action: "accept",
      candidateId: created.id,
      expectedVersion: created.expectedVersion,
    });
    expect(accepted.reviewState).toBe("accepted");
    expect(accepted.companyId).toBeTruthy();
    expect(accepted.qualificationState).toBe("not_assessed");
    const replay = await decideDiscoveryCandidate({
      ...actor,
      action: "accept",
      candidateId: created.id,
      expectedVersion: accepted.expectedVersion,
    });
    expect(replay.companyId).toBe(accepted.companyId);
    expect(await listContacts({ companyId: accepted.companyId ?? undefined })).toEqual(
      [],
    );
    expect(await listDeals({ companyId: accepted.companyId ?? undefined })).toEqual(
      [],
    );
    expect(
      listMemoryDiscoveryCandidateAudits().map((entry) => entry.action),
    ).toEqual([
      "discovery.candidate.submitted",
      "discovery.candidate.accepted",
    ]);
    expect(
      listMemoryDiscoveryCandidateAudits().some((entry) =>
        JSON.stringify(entry).includes("regional creative review"),
      ),
    ).toBe(false);
  });

  it("hides private excerpts from outsiders and keeps replay stable", async () => {
    const created = await submitDiscoveryCandidate({
      ...actor,
      values: submission({ visibilityScope: "private" }),
    });
    const owner = await getDiscoveryCandidate({
      ...actor,
      candidateId: created.id,
    });
    expect(owner.evidence?.[0]?.excerptHidden).toBe(false);
    expect(owner.evidence?.[0]?.excerpt).toContain("regional creative review");
    await expect(
      getDiscoveryCandidate({
        actorEmployeeId: "c0000000-0000-4000-8000-000000000099",
        isAdmin: false,
        candidateId: created.id,
      }),
    ).rejects.toMatchObject({ message: "CANDIDATE_ACCESS_DENIED" });
    const replay = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        requestId: created.requestId,
        visibilityScope: "private",
      }),
    });
    expect(replay.id).toBe(created.id);
    await expect(
      submitDiscoveryCandidate({
        ...actor,
        values: submission({
          requestId: created.requestId,
          whyNow: "A different payload under the same request must conflict.",
        }),
      }),
    ).rejects.toMatchObject({ message: "CANDIDATE_REQUEST_REPLAY_CONFLICT" });
  });

  it("parks, corrects, rejects, and links an existing company", async () => {
    const existing = await createCompany({
      name: "Campaign House Dubai",
      website: "https://campaignme.com",
    });
    const created = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "Other Signal Co",
        website: "https://gulfbusiness.com",
        sourceUrl: "https://gulfbusiness.com/latest/signal",
      }),
    });
    const parked = await decideDiscoveryCandidate({
      ...actor,
      action: "park",
      candidateId: created.id,
      expectedVersion: created.expectedVersion,
      reason: "Hold until the buyer relationship is confirmed",
    });
    expect(parked.reviewState).toBe("parked");
    const corrected = await decideDiscoveryCandidate({
      ...actor,
      action: "correct",
      candidateId: created.id,
      expectedVersion: parked.expectedVersion,
      reason: "Correct the company identity before linking",
      companyName: "Campaign House Dubai",
      website: "https://campaignme.com",
    });
    expect(corrected.reviewState).toBe("corrected");
    const linked = await decideDiscoveryCandidate({
      ...actor,
      action: "link",
      candidateId: created.id,
      expectedVersion: corrected.expectedVersion,
      companyId: existing.companyId,
    });
    expect(linked.companyId).toBe(existing.companyId);
    expect(linked.reviewState).toBe("accepted");
    const rejectedSeed = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "Reject Me Ltd",
        website: "https://communicateonline.me",
        sourceUrl: "https://communicateonline.me/news/reject",
      }),
    });
    const rejected = await decideDiscoveryCandidate({
      ...actor,
      action: "reject",
      candidateId: rejectedSeed.id,
      expectedVersion: rejectedSeed.expectedVersion,
      reason: "Not an HRMNY-relevant opportunity",
    });
    expect(rejected.reviewState).toBe("rejected");
    const evidenceSeed = await submitDiscoveryCandidate({
      ...actor,
      values: submission({
        companyName: "Needs Date Ltd",
        website: "https://gulfnews.com",
        sourceUrl: "https://gulfnews.com/business/needs-date",
      }),
    });
    const requested = await decideDiscoveryCandidate({
      ...actor,
      action: "request_evidence",
      candidateId: evidenceSeed.id,
      expectedVersion: evidenceSeed.expectedVersion,
      reason: "Need the original publication date",
    });
    expect(requested.reviewState).toBe("needs_evidence");
  });
});
