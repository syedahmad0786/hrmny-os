import { describe, expect, it } from "vitest";
import {
  buildDiscoveryResearchHref,
  parseDiscoveryResearchNav,
  safeExternalHttpsUrl,
} from "./discovery-research-nav";

describe("discovery research navigation", () => {
  it("restores URL-backed view, queue and entity selections", () => {
    const candidateId = "11111111-1111-4111-8111-111111111111";
    const programmeId = "22222222-2222-4222-8222-222222222222";
    const runId = "33333333-3333-4333-8333-333333333333";

    expect(
      parseDiscoveryResearchNav(
        new URLSearchParams(
          `view=runs&programmeId=${programmeId}&runId=${runId}&queue=accepted&candidateId=${candidateId}`,
        ),
      ),
    ).toEqual({
      view: "runs",
      candidateId: null,
      programmeId,
      runId,
      queue: "needs_review",
    });

    expect(
      parseDiscoveryResearchNav(
        new URLSearchParams(`candidateId=${candidateId}&queue=parked`),
      ),
    ).toEqual({
      view: "review",
      candidateId,
      programmeId: null,
      runId: null,
      queue: "parked",
    });

    expect(
      buildDiscoveryResearchHref({
        view: "runs",
        programmeId,
        runId,
      }),
    ).toBe(`/crm/research?view=runs&programmeId=${programmeId}&runId=${runId}`);

    expect(
      buildDiscoveryResearchHref(
        { view: "review", candidateId, queue: "accepted" },
        {
          view: "runs",
          candidateId: null,
          programmeId,
          runId,
          queue: "needs_review",
        },
      ),
    ).toBe(`/crm/research?queue=accepted&candidateId=${candidateId}`);
  });

  it("only exposes https evidence URLs as external links", () => {
    expect(safeExternalHttpsUrl("https://www.timeoutdubai.com/news/a")).toBe(
      "https://www.timeoutdubai.com/news/a",
    );
    expect(safeExternalHttpsUrl("http://insecure.example/news")).toBeNull();
    expect(safeExternalHttpsUrl("javascript:alert(1)")).toBeNull();
  });
});
