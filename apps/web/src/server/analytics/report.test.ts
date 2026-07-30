import { describe, expect, it } from "vitest";
import { runAgent, type RunAgent } from "@hrmny/ai";
import { assembleWeeklyReport, type WeeklyReportFacts } from "./report";

const FACTS: WeeklyReportFacts = {
  weekOf: "2026-07-27",
  pipeline: { open: 5, weightedValueAed: "120000.00" },
  capacityUtilizationPct: 0.82,
  churnRiskCount: 2,
  churnTop: [{ name: "Acme", risk: 0.7 }],
  portfolioMarginPct: 0.35,
};

/** Minimal RunAgent stub returning a fixed narrative string. */
const mockRun =
  (output: string): RunAgent =>
  async () => ({
    agent: "research",
    model: "mock",
    output,
    inputTokens: 0,
    outputTokens: 0,
    costAed: 0,
    gateOutcome: "not_applicable",
  });

describe("assembleWeeklyReport", () => {
  it("uses the live LLM narrative when one is produced", async () => {
    const rep = await assembleWeeklyReport(
      FACTS,
      mockRun("Partners: strong week, pipeline climbing, keep an eye on Acme."),
    );
    expect(rep.narrative).toBe(
      "Partners: strong week, pipeline climbing, keep an eye on Acme.",
    );
  });

  it("falls back to a coherent deterministic narrative under the mock provider", async () => {
    const rep = await assembleWeeklyReport(
      FACTS,
      mockRun("[mock:mock] stub response"),
    );
    expect(rep.narrative).not.toContain("[mock:");
    expect(rep.narrative).toContain("5 open deals");
    expect(rep.narrative).toContain("82%");
    expect(rep.narrative).toContain("2 client(s) flagged");
  });

  it("never throws when the agent runner fails — read-only report", async () => {
    const throwing: RunAgent = async () => {
      throw new Error("provider down");
    };
    const rep = await assembleWeeklyReport(FACTS, throwing);
    expect(rep.narrative).toContain("open deals");
  });

  it("returns exactly the frozen output shape", async () => {
    const rep = await assembleWeeklyReport(FACTS, mockRun("live"));
    expect(Object.keys(rep).sort()).toEqual([
      "capacityUtilizationPct",
      "churnRiskCount",
      "narrative",
      "pipeline",
      "weekOf",
    ]);
    expect(rep.pipeline).toEqual(FACTS.pipeline);
    expect(rep.capacityUtilizationPct).toBe(0.82);
    expect(rep.churnRiskCount).toBe(2);
    expect(rep.weekOf).toBe("2026-07-27");
  });

  it("produces a non-empty narrative with the real runAgent + mock provider", async () => {
    // Acceptance: weeklyReport must yield a narrative under LLM_PROVIDER=mock.
    const rep = await assembleWeeklyReport(FACTS, runAgent);
    expect(rep.narrative.length).toBeGreaterThan(0);
  });
});
