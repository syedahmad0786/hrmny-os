import type { RunAgent } from "@hrmny/ai";

/**
 * M10 weekly agency report — assemble pipeline + capacity + churn into the
 * frozen shape and generate the narrative via the injected agent runner.
 * Read-only, runs unattended (no HITL). ponytail: a deterministic narrative is
 * composed from the numbers and used as-is under the mock provider, so the
 * report is coherent in CI (LLM_PROVIDER=mock) and only upgraded when a live
 * model returns real prose.
 */

export type WeeklyReportFacts = {
  weekOf: string;
  pipeline: { open: number; weightedValueAed: string };
  capacityUtilizationPct: number;
  churnRiskCount: number;
  /** Narrative flavour only — not part of the frozen output shape. */
  churnTop?: Array<{ name: string; risk: number }>;
  portfolioMarginPct?: number | null;
};

export type WeeklyReport = {
  weekOf: string;
  pipeline: { open: number; weightedValueAed: string };
  capacityUtilizationPct: number;
  churnRiskCount: number;
  narrative: string;
};

function deterministicNarrative(f: WeeklyReportFacts): string {
  const util = Math.round(f.capacityUtilizationPct * 100);
  const churn =
    f.churnRiskCount === 0
      ? "No clients flagged for churn risk"
      : `${f.churnRiskCount} client(s) flagged for churn risk${
          f.churnTop?.length ? ` (top: ${f.churnTop[0]!.name})` : ""
        }`;
  const margin =
    f.portfolioMarginPct != null
      ? ` Portfolio margin is ${Math.round(f.portfolioMarginPct * 100)}%.`
      : "";
  return (
    `Week of ${f.weekOf}: ${f.pipeline.open} open deals worth AED ` +
    `${f.pipeline.weightedValueAed} weighted. Assigned-team capacity is at ` +
    `${util}%. ${churn}.${margin}`
  );
}

/** Mock provider echoes a stub; treat that as "no live narrative". */
function isLiveNarrative(text: string): boolean {
  return text.length > 0 && !text.startsWith("[mock:");
}

export async function assembleWeeklyReport(
  facts: WeeklyReportFacts,
  runAgent: RunAgent,
): Promise<WeeklyReport> {
  const fallback = deterministicNarrative(facts);

  let narrative = fallback;
  try {
    const res = await runAgent({
      agent: "research",
      input: {
        task: "weekly_agency_report",
        instruction:
          "Write a concise 2-3 sentence weekly agency status narrative for partners from these facts.",
        facts,
      },
    });
    const text = (typeof res.output === "string" ? res.output : "").trim();
    if (isLiveNarrative(text)) narrative = text;
  } catch {
    // Read-only report must never fail the caller; keep the deterministic text.
    narrative = fallback;
  }

  return {
    weekOf: facts.weekOf,
    pipeline: facts.pipeline,
    capacityUtilizationPct: facts.capacityUtilizationPct,
    churnRiskCount: facts.churnRiskCount,
    narrative,
  };
}
