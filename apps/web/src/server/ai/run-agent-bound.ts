import { sql } from "@hrmny/db";
import {
  runAgent,
  type AgentRunInput,
  type AgentRunOutput,
  type RunAgent,
} from "@hrmny/ai";
import { getDb } from "../db";

/** Append one agent_runs row so Settings → AI shows live history. */
export async function persistAgentRun(
  input: AgentRunInput,
  output: AgentRunOutput,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.execute(sql`
      insert into public.agent_runs (
        agent, model, input, output, tokens_in, tokens_out, cost_aed, gate_outcome
      ) values (
        ${output.agent},
        ${output.model},
        ${JSON.stringify({
          input: input.input,
          context: input.context ?? null,
          roles: input.roles ?? [],
          webSearch: input.webSearch ?? false,
        })}::jsonb,
        ${JSON.stringify(
          typeof output.output === "string"
            ? { text: output.output }
            : output.output,
        )}::jsonb,
        ${output.inputTokens},
        ${output.outputTokens},
        ${output.costAed.toFixed(4)},
        ${output.gateOutcome}
      )
    `);
  } catch {
    /* never block the agent path on audit write */
  }
}

/** Canonical app binding: run + durable cost ledger. */
export const boundRunAgent: RunAgent = async (input) => {
  const output = await runAgent(input);
  await persistAgentRun(input, output);
  return output;
};
