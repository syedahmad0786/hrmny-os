import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import { listCompanies, listContacts, listDeals } from "../crm/repository";
import { resetMemoryDiscoveryCandidates } from "../sales-os/discovery-candidates";
import {
  resolveDevUser,
  sessionCanViewMargin,
  type SessionUser,
} from "../auth/session";
import { createCaller } from "./root";

function caller(user: SessionUser) {
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

const outsider = {
  ...resolveDevUser("am"),
  employeeId: "c0000000-0000-4000-8000-000000000099",
  email: "other-am@hrmny.local",
  displayName: "Other AM",
};

function submission(
  overrides: Record<string, unknown> = {},
) {
  return {
    requestId: randomUUID(),
    companyName: "Time Out Partner",
    website: "https://timeoutdubai.com",
    whyNow: "A current listing named a relevant hospitality brief.",
    sourceUrl: "https://www.timeoutdubai.com/news/review-candidate",
    excerpt: "The venue asked for a regional brand and events partner.",
    eventDate: new Date().toISOString().slice(0, 10),
    visibilityScope: "public" as const,
    ...overrides,
  };
}

describe("Discovery review API", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_MODE", "memory");
    resetMemoryDiscoveryCandidates();
    resetCrmMemory();
  });

  it("lets an operator submit, inspect, accept, and keeps outsiders out", async () => {
    const am = caller(resolveDevUser("am"));
    const other = caller(outsider);
    const created = await am.salesOs.discovery.review.submit(submission());
    expect(created.reviewState).toBe("needs_review");
    const summary = await am.salesOs.discovery.review.summary();
    expect(summary).toMatchObject({
      needsReview: 1,
      needsEvidence: 0,
      candidateStoreReady: true,
      candidateStoreAccepted: false,
      executionEnabled: false,
    });
    const listed = await am.salesOs.discovery.review.list({
      queue: "needs_review",
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.evidence).toBeUndefined();
    const detail = await am.salesOs.discovery.review.get({
      candidateId: created.id,
    });
    expect(detail.evidence?.[0]?.excerpt).toContain("events partner");
    expect(detail.evaluation?.packet.provider).toBe("unavailable");
    expect(detail.evaluation?.packet.interpretationStatus).toBe("unavailable");
    expect(
      detail.evaluation?.facts.some((fact) => fact.text.startsWith("Event date")),
    ).toBe(true);
    await expect(
      other.salesOs.discovery.review.get({ candidateId: created.id }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "CANDIDATE_ACCESS_DENIED",
    });
    const accepted = await am.salesOs.discovery.review.decide({
      action: "accept",
      candidateId: created.id,
      expectedVersion: detail.expectedVersion,
    });
    expect(accepted.reviewState).toBe("accepted");
    expect(accepted.companyId).toBeTruthy();
    expect(
      (await listCompanies()).some(
        (company) => company.companyId === accepted.companyId,
      ),
    ).toBe(true);
    expect(await listContacts({ companyId: accepted.companyId ?? undefined })).toEqual(
      [],
    );
    expect(await listDeals({ companyId: accepted.companyId ?? undefined })).toEqual(
      [],
    );
    const after = await am.salesOs.discovery.review.summary();
    expect(after.needsReview).toBe(0);
  });

  it("keeps undated submissions in needs evidence until corrected", async () => {
    const am = caller(resolveDevUser("am"));
    const created = await am.salesOs.discovery.review.submit(
      submission({ eventDate: undefined }),
    );
    expect(created.reviewState).toBe("needs_evidence");
    await expect(
      am.salesOs.discovery.review.decide({
        action: "accept",
        candidateId: created.id,
        expectedVersion: created.expectedVersion,
      }),
    ).rejects.toMatchObject({
      message: "CANDIDATE_NOT_READY_FOR_ACCEPT",
    });
    const dated = await am.salesOs.discovery.review.decide({
      action: "correct",
      candidateId: created.id,
      expectedVersion: created.expectedVersion,
      reason: "Added the publication date from the source",
      eventDate: new Date().toISOString().slice(0, 10),
    });
    expect(dated.reviewState).toBe("needs_review");
  });
});
