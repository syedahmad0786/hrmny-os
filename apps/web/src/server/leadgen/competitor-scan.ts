import type { CompetitorFinding } from "@hrmny/ai";
import { defaultRunAgent, type RunAgent } from "./agent-run";
import {
  insertCompetitorFindings,
  listCompetitorFindings,
  type CompetitorFindingRow,
} from "./store";

/**
 * Competitor-research job skeleton (M8). Runs the `research` agent over a
 * competitor across the requested sources, structures the output into the
 * frozen `CompetitorFinding[]` shape, and stores it in `competitor_findings`
 * (lead_intel / slot 0060) via the store repository — retrievable for the
 * weekly competitor digest.
 *
 * ponytail: mock-first — the structured findings wrap whatever the injected
 * runner returns as their research basis. When M9 gives the research agent
 * real competitor-scan instructions, `detail`/`headline` carry live findings
 * with no change here.
 */

export type CompetitorScanInput = {
  competitor: string;
  /** Deal / client the scan is scoped to (weekly digest per active pitch). */
  scopeId?: string;
  sources?: CompetitorFinding["source"][];
  /** M7 runner; defaults to the mock-first binding, mockable in tests. */
  runAgent?: RunAgent;
};

const DEFAULT_SOURCES: CompetitorFinding["source"][] = [
  "site",
  "social",
  "ads_library",
];

export async function runCompetitorScan(
  input: CompetitorScanInput,
): Promise<CompetitorFindingRow[]> {
  const runAgent = input.runAgent ?? defaultRunAgent;
  const sources = input.sources?.length ? input.sources : DEFAULT_SOURCES;

  const run = await runAgent({
    agent: "research",
    input: { task: "competitor_scan", competitor: input.competitor, sources },
    context: input.scopeId ? { scopeId: input.scopeId } : undefined,
  });
  const basis =
    typeof run.output === "string" ? run.output : JSON.stringify(run.output);
  const capturedAt = new Date().toISOString();

  const findings: CompetitorFinding[] = sources.map((source) => ({
    competitor: input.competitor,
    source,
    headline: `${input.competitor} — ${source} scan`,
    detail: `Research basis: ${basis.slice(0, 200)}`,
    capturedAt,
    scopeId: input.scopeId,
  }));

  return insertCompetitorFindings(findings);
}

export { listCompetitorFindings };
