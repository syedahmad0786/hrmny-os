import { z } from "zod";
import type { AgentId } from "./agents/registry";

/**
 * Frozen agent I/O contract (M7). Every live agent run records its cost and
 * gate outcome so the `agent_runs` table (M7 migration) and the admin cost
 * panel have a stable shape. Downstream M8/M9 tasks type against these.
 */

/** What an agent is asked to do — free-text or structured, plus overrides. */
export type AgentRunInput = {
  agent: AgentId;
  /** Overrides the agent's default model; cost is logged against what ran. */
  model?: string;
  input: string | Record<string, unknown>;
  /** Retrieved memory / deal / client context injected before the draft. */
  context?: Record<string, unknown>;
  /** Explicit user-triggered, bounded OpenRouter web grounding. */
  webSearch?: boolean;
  /** Private employee context: cost ledger retains metrics, never content. */
  privateContext?: boolean;
  /** Actor roles for sandbox routing (primary privileged-data control). */
  roles?: string[];
  /** Explicit privileged domains this run needs (salaries, margin, etc.). */
  privilegedDomains?: Array<
    | "salary"
    | "payroll_amount"
    | "client_payment_terms"
    | "margin_pct"
    | "bank_account"
    | "personal_financial"
  >;
};

/** Where a run ended relative to the gate it feeds (HITL is never skipped). */
export const AgentGateOutcomeSchema = z.enum([
  /** Produced a draft awaiting human approve. */
  "pending",
  /** Human approved and the gate authorized the transition. */
  "approved",
  /** A gate blocked the proposed transition. */
  "blocked",
  /** Read-only run with no gate (research, classify, report). */
  "not_applicable",
]);
export type AgentGateOutcome = z.infer<typeof AgentGateOutcomeSchema>;

export type AgentRunOutput = {
  agent: AgentId;
  model: string;
  output: string | Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  /** Cost in AED, charged against the monthly cap in provider.ts. */
  costAed: number;
  gateOutcome: AgentGateOutcome;
  providerRequestId?: string;
  sourceCitations?: Array<{ url: string; title?: string }>;
  webSearchRequests?: number;
};

/** M8 competitor-research finding — structured into pgvector memory. */
export type CompetitorFinding = {
  competitor: string;
  source: "site" | "social" | "ads_library" | "other";
  headline: string;
  detail: string;
  url?: string;
  /** ISO timestamp of capture. */
  capturedAt: string;
  /** Deal / client this scan was scoped to, when applicable. */
  scopeId?: string;
};

/** M7 reply-intent classifier — drives deal-stage transitions in M8. */
export const ReplyIntentSchema = z.enum([
  "interested",
  "not_now",
  "unsubscribe",
  "question",
  "other",
]);
export type ReplyIntent = z.infer<typeof ReplyIntentSchema>;

export type ReplyIntentClassification = {
  intent: ReplyIntent;
  /** 0–1 model confidence. */
  confidence: number;
  rationale?: string;
};
