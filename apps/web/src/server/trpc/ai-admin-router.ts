import { sql } from "@hrmny/db";
import {
  AgentIdSchema,
  isAgentEnabled,
  listParentAgents,
  memorySandboxMetadata,
  setAgentEnabled,
  type AgentGateOutcome,
} from "@hrmny/ai";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import { writeAudit } from "../m1-persistence";
import { persistMemoryChunk, searchMemory } from "../ai/memory-db";
import { boundRunAgent } from "../ai/run-agent-bound";
import { router, staffProcedure, type TrpcContext } from "./trpc";

/**
 * M7 AI admin surface — shaped to satisfy the settings/ai page's useAiAdmin()
 * hook (agents w/ enabled + spend/runs, recent runs, monthly cap). Read paths
 * return empty/zero in mock mode (no DATABASE_URL) so the panel still renders.
 *
 * Module only — the orchestrator registers this on appRouter (see PR notes).
 */

const AI_ADMIN_ROLES = ["partner", "director", "finance"] as const;

function requireAiAdmin(ctx: TrpcContext) {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!ctx.roles.some((role) => AI_ADMIN_ROLES.includes(role as never))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "AI admin access required",
    });
  }
  return { employeeId: ctx.employeeId, roles: ctx.roles };
}

/** Bridge the frozen gate enum to the settings/ai page's presentation vocab. */
const GATE_TO_UI: Record<
  AgentGateOutcome,
  "approved" | "auto" | "pending" | "rejected"
> = {
  approved: "approved",
  pending: "pending",
  blocked: "rejected",
  not_applicable: "auto",
};

type RollupRow = { agent: string; runs: number; spend_aed: number };
type RunRow = {
  id: string;
  agent: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_aed: number;
  gate_outcome: AgentGateOutcome | null;
  created_at: string;
};

function monthlyCapAed(): number | null {
  const cap = Number(process.env.LLM_MONTHLY_CAP_AED);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

export const aiAdminRouter = router({
  /** Everything the AI control panel renders in one call. */
  dashboard: staffProcedure
    .input(
      z.object({ runsLimit: z.number().int().min(1).max(200).default(20) }),
    )
    .query(async ({ ctx, input }) => {
      requireAiAdmin(ctx);
      const db = getDb();

      const rollup = new Map<string, RollupRow>();
      let runs: RunRow[] = [];
      if (db) {
        // Current-month spend + run count per agent.
        const rollupRows = (await db.execute(sql`
          SELECT agent, COUNT(*)::int AS runs,
                 COALESCE(SUM(cost_aed), 0)::float8 AS spend_aed
          FROM public.agent_runs
          WHERE created_at >= date_trunc('month', now())
          GROUP BY agent
        `)) as unknown as RollupRow[];
        for (const row of rollupRows) rollup.set(row.agent, row);

        runs = (await db.execute(sql`
          SELECT agent_run_id AS id, agent, model, tokens_in, tokens_out,
                 cost_aed::float8 AS cost_aed, gate_outcome,
                 created_at::text AS created_at
          FROM public.agent_runs
          ORDER BY created_at DESC
          LIMIT ${input.runsLimit}
        `)) as unknown as RunRow[];
      }

      const agents = listParentAgents().map((agent) => {
        const stats = rollup.get(agent.id);
        return {
          key: agent.id,
          name: agent.displayName,
          purpose: agent.responsibility,
          enabled: isAgentEnabled(agent.id),
          spendAed: stats?.spend_aed ?? 0,
          runs: stats?.runs ?? 0,
        };
      });

      return {
        agents,
        runs: runs.map((run) => ({
          id: run.id,
          agent: run.agent,
          model: run.model,
          tokensIn: run.tokens_in,
          tokensOut: run.tokens_out,
          costAed: run.cost_aed,
          gate: GATE_TO_UI[run.gate_outcome ?? "not_applicable"],
          at: run.created_at,
        })),
        monthlyCapAed: monthlyCapAed(),
      };
    }),

  /** Kill switch. Disabled agents return a typed refusal at call time. */
  toggleAgent: staffProcedure
    .input(z.object({ agentId: AgentIdSchema, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireAiAdmin(ctx);
      setAgentEnabled(input.agentId, input.enabled);
      await writeAudit({
        actorEmployeeId: actor.employeeId,
        action: input.enabled ? "ai.agent.enabled" : "ai.agent.disabled",
        entityType: "agent",
        entityId: input.agentId,
        before: null,
        after: { enabled: input.enabled },
        reason: null,
      });
      return { agentId: input.agentId, enabled: isAgentEnabled(input.agentId) };
    }),

  /**
   * Run any registered agent on command. Optionally scopes memory to a
   * client + actor (per-user / per-client sandbox).
   */
  runAgent: staffProcedure
    .input(
      z.object({
        agentId: AgentIdSchema,
        prompt: z.string().min(1).max(8000),
        clientId: z.string().uuid().optional(),
        dealId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAiAdmin(ctx);
      const scope = memorySandboxMetadata({
        clientId: input.clientId,
        employeeId: ctx.employeeId ?? undefined,
        dealId: input.dealId,
      });
      if (Object.keys(scope).length) {
        await persistMemoryChunk({
          sourceType: "note",
          content: input.prompt,
          metadata: { ...scope, kind: "run_prompt" },
        });
      }
      // Client sandbox: filter by clientId only so immersion/handover chunks
      // (without employeeId) are visible. User sandbox when no client selected.
      const memory = await searchMemory({
        query: input.prompt,
        clientId: input.clientId,
        employeeId: input.clientId
          ? undefined
          : (ctx.employeeId ?? undefined),
        dealId: input.dealId,
        limit: 6,
      });
      const result = await boundRunAgent({
        agent: input.agentId,
        input: input.prompt,
        roles: ctx.roles,
        context: {
          sandbox: scope,
          memory,
        },
      });
      return result;
    }),
});
