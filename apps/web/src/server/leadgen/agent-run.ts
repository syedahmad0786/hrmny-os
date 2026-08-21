import {
  type AgentRunInput,
  type AgentRunOutput,
  type RunAgent,
} from "@hrmny/ai";
import { boundRunAgent } from "../ai/run-agent-bound";

/**
 * The M8 agent-runner seam. `RunAgent` is the frozen dependency type from
 * `@hrmny/ai`; the live binding persists to `agent_runs` when DATABASE_URL is set.
 * Tests inject `createMockRunAgent()` so scoring is deterministic and provider-free.
 */
export type { RunAgent };

/** Bind M8 to the durable runner (ledger + sandbox-aware provider). */
export const defaultRunAgent: RunAgent = boundRunAgent;

/** Stable 0–100 score from a seed so re-runs and tests are deterministic. */
function stableScore(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 101;
}

function temperatureFor(score: number): "hot" | "warm" | "cool" | "cold" {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  if (score >= 25) return "cool";
  return "cold";
}

/**
 * Deterministic mock runner for tests + the mock-first pipeline. Produces a
 * BUAF-shaped score for `research`, draft copy for `outreach-draft`, and a
 * generic echo otherwise — all with cost 0 and no gate side effects.
 */
export function createMockRunAgent(): RunAgent {
  return async (input: AgentRunInput): Promise<AgentRunOutput> => {
    const seed =
      typeof input.input === "string" ? input.input : JSON.stringify(input.input);
    let output: Record<string, unknown>;
    if (input.agent === "research") {
      const buafScore = stableScore(seed);
      output = {
        buafScore,
        temperature: temperatureFor(buafScore),
        rationale: `mock BUAF score ${buafScore} for ${seed.slice(0, 60)}`,
      };
    } else if (input.agent === "outreach-draft") {
      output = {
        subject: "Quick idea for your team",
        body: `Hi — mock outreach draft grounded in: ${seed.slice(0, 80)}`,
      };
    } else {
      output = { echo: seed.slice(0, 120) };
    }
    return {
      agent: input.agent,
      model: input.model ?? "mock",
      output,
      inputTokens: 0,
      outputTokens: 0,
      costAed: 0,
      gateOutcome: input.agent === "outreach-draft" ? "pending" : "not_applicable",
    };
  };
}
