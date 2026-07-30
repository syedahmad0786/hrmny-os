// mock data — replace with tRPC hooks when the `aiAdmin` router lands (M7).
// agents  → agent registry + per-agent `enabled` kill switch
// spend   → agent_runs cost rollup vs LLM_MONTHLY_CAP_AED
// runs    → agent_runs (input/output/model/tokens/cost/gate outcome)

export const MONTHLY_CAP_AED = 1500;

export type AiAgent = {
  key: string;
  name: string;
  purpose: string;
  enabled: boolean;
  spendAed: number;
  runs: number;
};

export type GateOutcome = "approved" | "pending" | "rejected" | "auto";

export type AgentRun = {
  id: string;
  agent: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costAed: number;
  gate: GateOutcome;
  at: string;
};

export const MOCK_AGENTS: readonly AiAgent[] = [
  {
    key: "outreach-draft",
    name: "Outreach draft",
    purpose: "Personalises cold-intro emails from BUAF-scored leads.",
    enabled: true,
    spendAed: 213.4,
    runs: 486,
  },
  {
    key: "reply-intent",
    name: "Reply-intent classifier",
    purpose: "Classifies inbound replies to drive deal-stage transitions.",
    enabled: true,
    spendAed: 61.2,
    runs: 1240,
  },
  {
    key: "research",
    name: "Research",
    purpose: "ICP + competitor scans folded into pgvector memory.",
    enabled: true,
    spendAed: 302.8,
    runs: 178,
  },
  {
    key: "creative",
    name: "Creative",
    purpose: "Drafts social/content posts and portal calendar items.",
    enabled: true,
    spendAed: 154.9,
    runs: 92,
  },
  {
    key: "buaf-score",
    name: "BUAF scoring",
    purpose: "Scores G1–G6 deal gates on the live model.",
    enabled: true,
    spendAed: 47.6,
    runs: 903,
  },
  {
    key: "agency-report",
    name: "Weekly agency report",
    purpose: "Unattended pipeline/capacity/margin narrative (M10).",
    enabled: false,
    spendAed: 0,
    runs: 0,
  },
];

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

export const MOCK_RUNS: readonly AgentRun[] = [
  {
    id: "run_9f2",
    agent: "outreach-draft",
    model: "anthropic/claude-sonnet-5",
    tokensIn: 1840,
    tokensOut: 320,
    costAed: 0.42,
    gate: "pending",
    at: minsAgo(8),
  },
  {
    id: "run_9e7",
    agent: "reply-intent",
    model: "anthropic/claude-haiku-4-5",
    tokensIn: 640,
    tokensOut: 40,
    costAed: 0.03,
    gate: "auto",
    at: minsAgo(19),
  },
  {
    id: "run_9d1",
    agent: "creative",
    model: "anthropic/claude-sonnet-5",
    tokensIn: 2100,
    tokensOut: 510,
    costAed: 0.31,
    gate: "pending",
    at: minsAgo(41),
  },
  {
    id: "run_9c4",
    agent: "buaf-score",
    model: "anthropic/claude-haiku-4-5",
    tokensIn: 980,
    tokensOut: 120,
    costAed: 0.05,
    gate: "auto",
    at: minsAgo(63),
  },
  {
    id: "run_9b8",
    agent: "research",
    model: "anthropic/claude-sonnet-5",
    tokensIn: 5400,
    tokensOut: 1290,
    costAed: 1.18,
    gate: "auto",
    at: minsAgo(96),
  },
  {
    id: "run_9a2",
    agent: "outreach-draft",
    model: "anthropic/claude-sonnet-5",
    tokensIn: 1720,
    tokensOut: 280,
    costAed: 0.39,
    gate: "rejected",
    at: minsAgo(142),
  },
];

export function useAiAdmin() {
  return { agents: MOCK_AGENTS, runs: MOCK_RUNS };
}
