import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import {
  resetMemoryDiscoveryCandidates,
  submitDiscoveryCandidate,
} from "./discovery-candidates";
import { classifyDiscoveryDisposition } from "./discovery-evidence";
import { importDiscoveryIntentEvidence } from "./discovery-import";
import { evaluateDiscoveryEvidence } from "./discovery-interpretation";
import {
  DISCOVERY_RELEASE_QUALITY_CASES,
  DISCOVERY_RELEASE_QUALITY_GATES,
  DISCOVERY_RELEASE_QUALITY_NOW,
  discoveryReleaseQualityCoverage,
} from "./discovery-release-quality-fixtures";

const actor = {
  actorEmployeeId: "c0000000-0000-4000-8000-000000000002",
  isAdmin: false,
};

describe("Discovery release-quality fixture set", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_MODE", "memory");
    resetMemoryDiscoveryCandidates();
    resetCrmMemory();
  });

  it("runs 40 representative cases and reports the concrete gate list", async () => {
    const coverage = discoveryReleaseQualityCoverage();
    expect(coverage.caseCount).toBeGreaterThanOrEqual(40);
    expect(coverage.families).toEqual(
      expect.arrayContaining([
        "news",
        "hiring",
        "leadership",
        "tender",
        "import",
        "adversarial",
      ]),
    );

    const errors: string[] = [];
    let correct = 0;
    const submittedIds = new Map<string, string>();

    for (const item of DISCOVERY_RELEASE_QUALITY_CASES) {
      const classified = classifyDiscoveryDisposition({
        opportunityKind: item.opportunityKind,
        excerpt: item.excerpt,
        whyNow: item.whyNow,
        eventDate: item.eventDate,
        now: DISCOVERY_RELEASE_QUALITY_NOW,
      });
      const classifiedDisposition =
        item.expectedDisposition === "duplicate"
          ? "actionable"
          : item.expectedDisposition;
      if (classified.disposition !== classifiedDisposition) {
        errors.push(
          `${item.id}: classified ${classified.disposition}, expected ${classifiedDisposition}`,
        );
      } else {
        correct += 1;
      }
      if (
        ["stale", "undated", "unsupported"].includes(classified.disposition) &&
        classified.reviewState !== "needs_evidence"
      ) {
        errors.push(
          `${item.id}: ${classified.disposition} admitted as ${classified.reviewState}`,
        );
      }

      const evaluated = await evaluateDiscoveryEvidence({
        opportunityKind: item.opportunityKind,
        excerpt: item.excerpt,
        whyNow: item.whyNow,
        eventDate: item.eventDate,
        visibilityScope: item.visibilityScope,
        companyName: item.companyName,
        website: item.website,
        sourceUrl: item.sourceUrl,
        route: item.route,
        now: DISCOVERY_RELEASE_QUALITY_NOW,
      });
      if (evaluated.packet.excerptIncluded !== item.expectedExcerptIncluded) {
        errors.push(
          `${item.id}: excerptIncluded=${evaluated.packet.excerptIncluded}`,
        );
      }
      if (
        evaluated.packet.provider !== "unavailable" ||
        evaluated.packet.webSearch
      ) {
        errors.push(`${item.id}: ordinary evaluation used a provider`);
      }
      if (
        item.visibilityScope !== "public" &&
        evaluated.interpretations.length > 0
      ) {
        errors.push(`${item.id}: private/restricted interpretations leaked`);
      }

      const submitted = await submitDiscoveryCandidate({
        ...actor,
        values: {
          requestId: randomUUID(),
          companyName: item.companyName,
          website: item.website,
          whyNow: item.whyNow,
          sourceUrl: item.sourceUrl,
          excerpt: item.excerpt,
          eventDate: item.eventDate,
          visibilityScope: item.visibilityScope,
          discoveryChannel: item.discoveryChannel,
          opportunityKind: item.opportunityKind,
        },
      });
      if (item.expectedDisposition === "duplicate") {
        const firstId = submittedIds.get(item.pairWith ?? "");
        if (submitted.id !== firstId) {
          errors.push(`${item.id}: duplicate opened a second candidate`);
        }
        if (submitted.evaluation?.disposition !== "duplicate") {
          errors.push(
            `${item.id}: store disposition ${submitted.evaluation?.disposition}`,
          );
        }
      } else if (submitted.reviewState !== item.expectedReviewState) {
        errors.push(
          `${item.id}: store reviewState ${submitted.reviewState}, expected ${item.expectedReviewState}`,
        );
      }
      submittedIds.set(item.id, submitted.id);
    }

    const imported = await importDiscoveryIntentEvidence({
      ...actor,
      rows: DISCOVERY_RELEASE_QUALITY_CASES.filter(
        (item) => item.route === "import",
      ).map((item) => ({
        requestId: randomUUID(),
        companyName: `${item.companyName} Import`,
        website: item.website,
        whyNow: item.whyNow,
        sourceUrl: `${item.sourceUrl}-import`,
        excerpt: item.excerpt,
        eventDate: item.eventDate,
        visibilityScope: item.visibilityScope,
        discoveryChannel: item.discoveryChannel,
        opportunityKind: item.opportunityKind,
      })),
    });
    for (const row of imported) {
      if (row.evaluation?.packet.route !== "import") {
        errors.push(`${row.companyName}: import route missing`);
      }
    }

    const accuracy = correct / DISCOVERY_RELEASE_QUALITY_CASES.length;
    const gates = {
      coverage_news_hiring_leadership_tender_import_adversarial:
        coverage.families.length === 6,
      forty_representative_cases: coverage.caseCount >= 40,
      ninety_percent_correct_classifications: accuracy >= 0.9,
      no_stale_undated_unsupported_admitted_as_verified: !errors.some((item) =>
        item.includes("admitted as"),
      ),
      awarded_parks_as_intelligence: DISCOVERY_RELEASE_QUALITY_CASES.filter(
        (item) => item.expectedDisposition === "awarded",
      ).every((item) => item.expectedReviewState === "parked"),
      tender_not_stale_by_news_window:
        DISCOVERY_RELEASE_QUALITY_CASES.find(
          (item) => item.id === "tender-old-still-open",
        )?.expectedDisposition === "actionable",
      two_distinct_tenders:
        new Set(
          DISCOVERY_RELEASE_QUALITY_CASES.filter(
            (item) => item.family === "tender" && item.expectedDisposition === "actionable",
          ).map((item) => item.sourceUrl),
        ).size >= 2,
      duplicate_identity_does_not_open_twice: !errors.some((item) =>
        item.includes("second candidate"),
      ),
      private_excerpt_excluded_from_packet: DISCOVERY_RELEASE_QUALITY_CASES.filter(
        (item) => item.visibilityScope === "private",
      ).every((item) => item.expectedExcerptIncluded === false),
      restricted_excerpt_excluded_from_packet:
        DISCOVERY_RELEASE_QUALITY_CASES.filter(
          (item) => item.visibilityScope === "restricted",
        ).every((item) => item.expectedExcerptIncluded === false),
      import_route_reuses_discovery_evaluate: imported.every(
        (row) => row.evaluation?.packet.route === "import",
      ),
      mock_packet_only_collectors_off: !errors.some((item) =>
        item.includes("packet is not mock-only"),
      ),
    };

    expect({
      caseCount: coverage.caseCount,
      correct,
      accuracy,
      errors,
      gates,
      gateList: DISCOVERY_RELEASE_QUALITY_GATES,
    }).toMatchObject({
      caseCount: coverage.caseCount,
      errors: [],
      gates: Object.fromEntries(
        DISCOVERY_RELEASE_QUALITY_GATES.map((gate) => [gate, true]),
      ),
    });
    expect(accuracy).toBe(1);
  });
});
