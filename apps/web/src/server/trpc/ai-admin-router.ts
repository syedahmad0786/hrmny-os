import { sql } from "@hrmny/db";
import {
  AgentIdSchema,
  agentEnabledStates,
  getAgent,
  isAgentEnabled,
  setAgentEnabled,
} from "@hrmny/ai";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import { writeAudit } from "../m1-persistence";
import { router, staffProcedure, type TrpcContext } from "./trpc";

/**
 * M7 AI admin surface: agent roster + kill switch, run log with cost totals,
 * and monthly LLM spend. Read paths return empty in mock mode (no DATABASE_URL)
 * so the panel stays functional before the AI layer is live.
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

type RunRow = {
  agent_run_id: string;
  agent: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_aed: number;
  gate_outcome: string | null;
  created_at: string;
};

const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM")
  .optional();

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export const aiAdminRouter = router({
  /** Agent roster with live kill-switch state. */
  listAgents: staffProcedure.query(({ ctx }) => {
    requireAiAdmin(ctx);
    return agentEnabledStates().map(({ id, enabled }) => {
      const agent = getAgent(id);
      return {
        id,
        displayName: agent.displayName,
        responsibility: agent.responsibility,
        parentId: agent.parentId ?? null,
        enabled,
      };
    });
  }),

  /** Flip an agent on/off. Disabled agents return a typed refusal at call time. */
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

  /** Recent runs (newest first) plus cost/token totals over the same filter. */
  listRuns: staffProcedure
    .input(
      z.object({
        agent: AgentIdSchema.optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireAiAdmin(ctx);
      const db = getDb();
      if (!db) return { runs: [], totals: { runs: 0, costAed: 0 } };

      const agentFilter = input.agent
        ? sql`WHERE agent = ${input.agent}`
        : sql``;
      const rows = (await db.execute(sql`
        SELECT agent_run_id, agent, model, tokens_in, tokens_out,
               cost_aed::float8 AS cost_aed, gate_outcome,
               created_at::text AS created_at
        FROM public.agent_runs
        ${agentFilter}
        ORDER BY created_at DESC
        LIMIT ${input.limit}
      `)) as unknown as RunRow[];

      const [totals] = (await db.execute(sql`
        SELECT COUNT(*)::int AS runs,
               COALESCE(SUM(cost_aed), 0)::float8 AS cost_aed
        FROM public.agent_runs
        ${agentFilter}
      `)) as unknown as Array<{ runs: number; cost_aed: number }>;

      return {
        runs: rows,
        totals: { runs: totals?.runs ?? 0, costAed: totals?.cost_aed ?? 0 },
      };
    }),

  /** Monthly spend vs. the configured cap, with a per-agent breakdown. */
  monthlySpend: staffProcedure
    .input(z.object({ month: monthSchema }))
    .query(async ({ ctx, input }) => {
      requireAiAdmin(ctx);
      const month = input.month ?? currentMonth();
      const capRaw = Number(process.env.LLM_MONTHLY_CAP_AED);
      const capAed = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null;

      const db = getDb();
      if (!db) {
        return { month, capAed, totalCostAed: 0, runCount: 0, byAgent: [] };
      }

      const start = sql`(${`${month}-01`})::date`;
      const byAgent = (await db.execute(sql`
        SELECT agent, COUNT(*)::int AS runs,
               COALESCE(SUM(cost_aed), 0)::float8 AS cost_aed
        FROM public.agent_runs
        WHERE created_at >= ${start}
          AND created_at < (${start} + interval '1 month')
        GROUP BY agent
        ORDER BY SUM(cost_aed) DESC NULLS LAST
      `)) as unknown as Array<{ agent: string; runs: number; cost_aed: number }>;

      const totalCostAed = byAgent.reduce((sum, row) => sum + row.cost_aed, 0);
      const runCount = byAgent.reduce((sum, row) => sum + row.runs, 0);
      return {
        month,
        capAed,
        totalCostAed: Math.round(totalCostAed * 10_000) / 10_000,
        runCount,
        byAgent: byAgent.map((row) => ({
          agent: row.agent,
          runs: row.runs,
          costAed: row.cost_aed,
        })),
      };
    }),
});
