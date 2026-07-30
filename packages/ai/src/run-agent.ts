import type {
  AgentGateOutcome,
  AgentRunInput,
  AgentRunOutput,
} from "./agent-io";
import type { AgentId } from "./agents/registry";
import {
  AGENT_REGISTRY,
  agentDisabledRefusal,
  isAgentEnabled,
} from "./agents/registry";
import {
  assertScheduledAllowed,
  defaultAutonomyPolicy,
  PolicyViolationError,
  policyViolationRefusal,
  type AutonomyPolicy,
  type ScheduledAllowedAction,
} from "./policy";
import {
  createProvider,
  estimateCostAed,
  withMetering,
  type LLMGenerateOptions,
  type LLMProvider,
  type MeteringOptions,
} from "./provider";

/**
 * Canonical agent-runner seam (M7). One entry point every live agent run flows
 * through: kill switch → provider (metered, cap-breakered) → AgentRunOutput.
 * M8/M10 accept a `RunAgent` dependency and bind it to this at wiring time.
 *
 * Mock-first: with no keys, createProvider() returns the mock, cost is 0, and
 * the cap never trips. The cap breaker still throws MonthlyCapExceededError
 * when a live spend source is wired past the cap (fail closed by design).
 */
export type RunAgent = (input: AgentRunInput) => Promise<AgentRunOutput>;

/** Where this run originated. Scheduled runs are held to the autonomy policy. */
export type InvocationContext = { trigger: "user" | "scheduled" };

export type RunAgentDeps = {
  /** Defaults to createProvider() (mock without keys). */
  provider?: LLMProvider;
  /** Persist the run (e.g. insert an agent_runs row). */
  onCost?: MeteringOptions["onCost"];
  /** Month-to-date spend source that arms the cap breaker. */
  getMonthlySpendAed?: MeteringOptions["getMonthlySpendAed"];
  monthlyCapAed?: number;
  /** Defaults to a user-triggered run (no policy enforcement). */
  invocationContext?: InvocationContext;
  /** Governance policy for scheduled runs; defaults to manual (fail closed). */
  policy?: AutonomyPolicy;
};

/** Mock task hint so the mock/eval provider returns structured output. */
function taskFor(agent: AgentId): LLMGenerateOptions["task"] {
  if (agent === "outreach-draft") return "outreach_draft";
  if (agent === "finance-assist") return "invoice_extract";
  return "generic";
}

/** Draft producers stop at HITL (pending); read-only agents have no gate. */
function gateOutcomeFor(agent: AgentId): AgentGateOutcome {
  return AGENT_REGISTRY[agent].producesDrafts ? "pending" : "not_applicable";
}

export async function runAgent(
  input: AgentRunInput,
  deps: RunAgentDeps = {},
): Promise<AgentRunOutput> {
  const { agent } = input;
  const model =
    input.model ?? process.env.LLM_DEFAULT_MODEL?.trim() ?? "mock";

  if (!isAgentEnabled(agent)) {
    return {
      agent,
      model,
      output: agentDisabledRefusal(agent),
      inputTokens: 0,
      outputTokens: 0,
      costAed: 0,
      gateOutcome: "blocked",
    };
  }

  // Scheduled runs are internal-only: a cron may research/draft, never side-effect.
  // A scheduled agent's own action is bounded by whether it drafts; sends/spend/
  // etc. cross the gate later with a human, so they never reach runAgent.
  if ((deps.invocationContext?.trigger ?? "user") === "scheduled") {
    const policy = deps.policy ?? defaultAutonomyPolicy();
    const action: ScheduledAllowedAction = AGENT_REGISTRY[agent].producesDrafts
      ? "draft"
      : "research";
    try {
      assertScheduledAllowed(policy, agent, action);
    } catch (err) {
      if (err instanceof PolicyViolationError) {
        return {
          agent,
          model,
          output: policyViolationRefusal(err),
          inputTokens: 0,
          outputTokens: 0,
          costAed: 0,
          gateOutcome: "blocked",
        };
      }
      throw err;
    }
  }

  const provider = withMetering(
    deps.provider ?? createProvider({ defaultModel: input.model }),
    {
      agent,
      onCost: deps.onCost,
      getMonthlySpendAed: deps.getMonthlySpendAed,
      monthlyCapAed: deps.monthlyCapAed,
    },
  );

  const userText =
    typeof input.input === "string" ? input.input : JSON.stringify(input.input);
  const context = input.context
    ? `\n\ncontext: ${JSON.stringify(input.context)}`
    : "";

  const result = await provider.generate({
    task: taskFor(agent),
    model: input.model,
    messages: [
      { role: "system", content: AGENT_REGISTRY[agent].responsibility },
      { role: "user", content: `${userText}${context}` },
    ],
  });

  const inputTokens = result.inputTokens ?? 0;
  const outputTokens = result.outputTokens ?? 0;
  return {
    agent,
    model: result.model,
    output: (result.object as Record<string, unknown>) ?? result.text,
    inputTokens,
    outputTokens,
    costAed: estimateCostAed(result.model, inputTokens, outputTokens),
    gateOutcome: gateOutcomeFor(agent),
  };
}
