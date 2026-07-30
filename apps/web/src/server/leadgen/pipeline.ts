import type {
  EmailVerificationAdapter,
  LeadCandidate,
  LeadSearchCriteria,
  LeadSourceAdapter,
} from "@hrmny/integrations";
import { dedupeIntoCrm } from "./dedupe";
import { buildDigest, type MorningDigest, type ScoredLead } from "./digest";
import { defaultRunAgent, type RunAgent } from "./agent-run";

/**
 * Daily lead-gen pipeline (M8): search → dedupe into CRM → verify each new
 * email → BUAF score via the research agent → morning digest. Plain async fn,
 * all I/O injected — the Inngest wrapper and tests both call this. Idempotent:
 * dedupe skips existing contacts, so a re-run produces zero fresh leads.
 */

export type LeadGenDeps = {
  leadSource: LeadSourceAdapter;
  verifier: EmailVerificationAdapter;
  /** M7 runner; defaults to the mock-first binding, mockable in tests. */
  runAgent?: RunAgent;
  /** Delivers the assembled digest (Slack/Chat/email at wiring time). */
  digestSink?: (digest: MorningDigest) => Promise<void> | void;
};

export const DEFAULT_ICP: LeadSearchCriteria = {
  query: "marketing agency prospects UAE",
  titles: ["CMO", "Head of Marketing", "Founder"],
  locations: ["United Arab Emirates"],
  perPage: 3,
};

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function extractScore(output: unknown): { buafScore: number; temperature: string } {
  const o = (typeof output === "object" && output ? output : {}) as Record<string, unknown>;
  const buafScore = num(o.buafScore, 0);
  const temperature =
    typeof o.temperature === "string"
      ? o.temperature
      : buafScore >= 75
        ? "hot"
        : buafScore >= 50
          ? "warm"
          : buafScore >= 25
            ? "cool"
            : "cold";
  return { buafScore, temperature };
}

export async function runDailyLeadGen(
  deps: LeadGenDeps,
  criteria: LeadSearchCriteria = DEFAULT_ICP,
): Promise<MorningDigest> {
  const runAgent = deps.runAgent ?? defaultRunAgent;

  const candidates = await deps.leadSource.searchLeads(criteria);
  const byExternalId = new Map<string, LeadCandidate>(
    candidates.map((c) => [c.externalId, c]),
  );

  const { created } = await dedupeIntoCrm(candidates);

  const scored: ScoredLead[] = [];
  for (const rec of created) {
    const cand = byExternalId.get(rec.externalId);
    const verification = rec.email
      ? await deps.verifier.verify(rec.email)
      : null;

    const run = await runAgent({ agent: "research", input: { lead: cand ?? rec } });
    const { buafScore, temperature } = extractScore(run.output);

    scored.push({
      externalId: rec.externalId,
      fullName: cand?.fullName ?? null,
      email: rec.email,
      companyName: cand?.companyName ?? null,
      emailVerified: verification?.emailVerified ?? false,
      verdict: verification?.verdict ?? "unknown",
      buafScore,
      temperature,
      contactId: rec.contactId,
      dealId: rec.dealId,
    });
  }

  const digest = buildDigest(scored);
  await deps.digestSink?.(digest);
  return digest;
}
