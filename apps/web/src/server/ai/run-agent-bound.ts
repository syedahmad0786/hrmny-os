import {
  runAgent as baseRunAgent,
  type AgentRunInput,
  type AgentRunOutput,
  type RunAgent,
} from "@hrmny/ai";
import { sql } from "@hrmny/db";
import { getDb } from "../db";
import { recallMemory } from "../memory/postgres";

async function getMonthlySpendAed(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const rows = (await db.execute(sql`
    select coalesce(sum(cost_aed), 0)::float8 as spend
    from public.agent_runs
    where created_at >= date_trunc('month', now())
  `)) as unknown as Array<{ spend: number }>;
  return Number(rows[0]?.spend ?? 0);
}

async function persistAgentRun(
  input: AgentRunInput,
  output: AgentRunOutput,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(sql`
    insert into public.agent_runs (
      agent, model, input, output, tokens_in, tokens_out, cost_aed, gate_outcome
    ) values (
      ${output.agent},
      ${output.model},
      ${JSON.stringify(input.input ?? {})}::jsonb,
      ${JSON.stringify(output.output ?? {})}::jsonb,
      ${output.inputTokens},
      ${output.outputTokens},
      ${output.costAed},
      ${output.gateOutcome}
    )
  `);
}

/**
 * Production RunAgent binding:
 * 1) retrieve memory for deal/company context
 * 2) run metered agent
 * 3) persist agent_runs for cost panel / future evals
 */
export const boundRunAgent: RunAgent = async (input) => {
  const dealId =
    typeof input.input === "object" &&
    input.input &&
    "dealId" in input.input &&
    typeof (input.input as { dealId?: unknown }).dealId === "string"
      ? (input.input as { dealId: string }).dealId
      : undefined;

  const query =
    typeof input.input === "string"
      ? input.input
      : JSON.stringify(input.input ?? {});

  let memoryContext: Array<{ content: string; score: number }> = [];
  try {
    if (getDb()) {
      const chunks = await recallMemory({
        query: query.slice(0, 500),
        dealId,
        limit: 6,
      });
      memoryContext = chunks.map((c) => ({
        content: c.content,
        score: c.score,
      }));
    }
  } catch {
    memoryContext = [];
  }

  const enriched: AgentRunInput = {
    ...input,
    context: {
      ...(input.context ?? {}),
      memory: memoryContext,
    },
  };

  const output = await baseRunAgent(enriched, {
    onCost: async () => {
      // Persistence happens after the full run so gateOutcome is known.
    },
    getMonthlySpendAed,
    monthlyCapAed: Number(process.env.LLM_MONTHLY_CAP_AED) || 1500,
  });

  try {
    await persistAgentRun(enriched, output);
  } catch {
    // Cost row failure must not break the agent response path.
  }

  return output;
};
