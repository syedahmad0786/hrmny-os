import { sql } from "@hrmny/db";
import {
  AgentIdSchema,
  createProvider,
  estimateCostAed,
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
import { boundRunAgent, persistAgentRun } from "../ai/run-agent-bound";
import { router, staffProcedure, type TrpcContext } from "./trpc";

/**
 * M7 AI admin surface — shaped to satisfy the settings/ai page's useAiAdmin()
 * hook (agents w/ enabled + spend/runs, recent runs, monthly cap). Read paths
 * return empty/zero in mock mode (no DATABASE_URL) so the panel still renders.
 *
 * Module only — the orchestrator registers this on appRouter (see PR notes).
 */

const AI_ADMIN_ROLES = ["partner", "director", "finance"] as const;

type CustomAgentRow = {
  customAgentId: string;
  slug: string;
  displayName: string;
  responsibility: string;
  systemPrompt: string;
  model: string | null;
  enabled: boolean;
  producesDrafts: boolean;
  allowedTools: unknown;
  createdByEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
};

const memCustomAgents: CustomAgentRow[] = [];

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

  /** Custom agents (CrewAI/LangSmith-style registry) — Postgres or memory. */
  customAgents: router({
    list: staffProcedure.query(async ({ ctx }) => {
      requireAiAdmin(ctx);
      const db = getDb();
      if (!db) return memCustomAgents;
      return db.execute<CustomAgentRow>(sql`
        select
          custom_agent_id as "customAgentId",
          slug, display_name as "displayName",
          responsibility, system_prompt as "systemPrompt",
          model, enabled,
          produces_drafts as "producesDrafts",
          coalesce(allowed_tools, '[]'::jsonb) as "allowedTools",
          created_by_employee_id as "createdByEmployeeId",
          created_at::text as "createdAt",
          updated_at::text as "updatedAt"
        from public.custom_agent
        order by updated_at desc
        limit 100
      `);
    }),

    create: staffProcedure
      .input(
        z.object({
          slug: z
            .string()
            .trim()
            .min(2)
            .max(80)
            .regex(/^[a-z0-9][a-z0-9_-]*$/),
          displayName: z.string().min(1).max(120),
          responsibility: z.string().max(500).optional(),
          systemPrompt: z.string().max(8000).optional(),
          model: z.string().max(120).optional(),
          producesDrafts: z.boolean().optional(),
          allowedTools: z.array(z.string()).max(40).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const actor = requireAiAdmin(ctx);
        const db = getDb();
        if (!db) {
          if (memCustomAgents.some((a) => a.slug === input.slug)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Slug already exists",
            });
          }
          const row: CustomAgentRow = {
            customAgentId: crypto.randomUUID(),
            slug: input.slug,
            displayName: input.displayName,
            responsibility: input.responsibility ?? "",
            systemPrompt: input.systemPrompt ?? "",
            model: input.model ?? null,
            enabled: true,
            producesDrafts: input.producesDrafts ?? true,
            allowedTools: input.allowedTools ?? [],
            createdByEmployeeId: actor.employeeId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          memCustomAgents.unshift(row);
          await writeAudit({
            actorEmployeeId: actor.employeeId,
            action: "ai.custom_agent.created",
            entityType: "custom_agent",
            entityId: row.customAgentId,
            before: null,
            after: { slug: row.slug },
            reason: null,
          });
          return row;
        }
        try {
          const rows = await db.execute<CustomAgentRow>(sql`
            insert into public.custom_agent (
              slug, display_name, responsibility, system_prompt, model,
              produces_drafts, allowed_tools, created_by_employee_id
            ) values (
              ${input.slug},
              ${input.displayName},
              ${input.responsibility ?? ""},
              ${input.systemPrompt ?? ""},
              ${input.model ?? null},
              ${input.producesDrafts ?? true},
              ${JSON.stringify(input.allowedTools ?? [])}::jsonb,
              ${actor.employeeId}::uuid
            )
            returning
              custom_agent_id as "customAgentId",
              slug, display_name as "displayName",
              responsibility, system_prompt as "systemPrompt",
              model, enabled,
              produces_drafts as "producesDrafts",
              coalesce(allowed_tools, '[]'::jsonb) as "allowedTools",
              created_by_employee_id as "createdByEmployeeId",
              created_at::text as "createdAt",
              updated_at::text as "updatedAt"
          `);
          const row = rows[0]!;
          await writeAudit({
            actorEmployeeId: actor.employeeId,
            action: "ai.custom_agent.created",
            entityType: "custom_agent",
            entityId: row.customAgentId,
            before: null,
            after: { slug: row.slug },
            reason: null,
          });
          return row;
        } catch (e) {
          throw new TRPCError({
            code: "CONFLICT",
            message: e instanceof Error ? e.message : "Could not create agent",
          });
        }
      }),

    update: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          displayName: z.string().min(1).max(120).optional(),
          responsibility: z.string().max(500).optional(),
          systemPrompt: z.string().max(8000).optional(),
          model: z.string().max(120).nullable().optional(),
          enabled: z.boolean().optional(),
          producesDrafts: z.boolean().optional(),
          allowedTools: z.array(z.string()).max(40).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const actor = requireAiAdmin(ctx);
        const db = getDb();
        if (!db) {
          const row = memCustomAgents.find((a) => a.customAgentId === input.id);
          if (!row) throw new TRPCError({ code: "NOT_FOUND" });
          if (input.displayName !== undefined) row.displayName = input.displayName;
          if (input.responsibility !== undefined)
            row.responsibility = input.responsibility;
          if (input.systemPrompt !== undefined)
            row.systemPrompt = input.systemPrompt;
          if (input.model !== undefined) row.model = input.model;
          if (input.enabled !== undefined) row.enabled = input.enabled;
          if (input.producesDrafts !== undefined)
            row.producesDrafts = input.producesDrafts;
          if (input.allowedTools !== undefined)
            row.allowedTools = input.allowedTools;
          row.updatedAt = new Date().toISOString();
          await writeAudit({
            actorEmployeeId: actor.employeeId,
            action: "ai.custom_agent.updated",
            entityType: "custom_agent",
            entityId: row.customAgentId,
            before: null,
            after: { slug: row.slug, enabled: row.enabled },
            reason: null,
          });
          return row;
        }
        const rows = await db.execute<CustomAgentRow>(sql`
          update public.custom_agent set
            display_name = coalesce(${input.displayName ?? null}, display_name),
            responsibility = coalesce(${input.responsibility ?? null}, responsibility),
            system_prompt = coalesce(${input.systemPrompt ?? null}, system_prompt),
            model = case
              when ${input.model === undefined}::boolean then model
              else ${input.model ?? null}
            end,
            enabled = coalesce(${input.enabled ?? null}::boolean, enabled),
            produces_drafts = coalesce(${input.producesDrafts ?? null}::boolean, produces_drafts),
            allowed_tools = coalesce(${input.allowedTools ? JSON.stringify(input.allowedTools) : null}::jsonb, allowed_tools),
            updated_at = now()
          where custom_agent_id = ${input.id}::uuid
          returning
            custom_agent_id as "customAgentId",
            slug, display_name as "displayName",
            responsibility, system_prompt as "systemPrompt",
            model, enabled,
            produces_drafts as "producesDrafts",
            coalesce(allowed_tools, '[]'::jsonb) as "allowedTools",
            created_by_employee_id as "createdByEmployeeId",
            created_at::text as "createdAt",
            updated_at::text as "updatedAt"
        `);
        const row = rows[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        await writeAudit({
          actorEmployeeId: actor.employeeId,
          action: "ai.custom_agent.updated",
          entityType: "custom_agent",
          entityId: row.customAgentId,
          before: null,
          after: { slug: row.slug, enabled: row.enabled },
          reason: null,
        });
        return row;
      }),

    remove: staffProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireAiAdmin(ctx);
        const db = getDb();
        if (!db) {
          const idx = memCustomAgents.findIndex(
            (a) => a.customAgentId === input.id,
          );
          if (idx < 0) throw new TRPCError({ code: "NOT_FOUND" });
          const [removed] = memCustomAgents.splice(idx, 1);
          await writeAudit({
            actorEmployeeId: actor.employeeId,
            action: "ai.custom_agent.removed",
            entityType: "custom_agent",
            entityId: input.id,
            before: { slug: removed?.slug },
            after: null,
            reason: null,
          });
          return { ok: true };
        }
        const rows = await db.execute<{ id: string; slug: string }>(sql`
          delete from public.custom_agent
          where custom_agent_id = ${input.id}::uuid
          returning custom_agent_id as id, slug
        `);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await writeAudit({
          actorEmployeeId: actor.employeeId,
          action: "ai.custom_agent.removed",
          entityType: "custom_agent",
          entityId: input.id,
          before: { slug: rows[0].slug },
          after: null,
          reason: null,
        });
        return { ok: true };
      }),

    /**
     * Run a custom agent on command with per-client / per-user memory sandbox.
     * Uses the agent system_prompt (mock LLM when keys/credits unavailable).
     */
    run: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          prompt: z.string().min(1).max(8000),
          clientId: z.string().uuid().optional(),
          dealId: z.string().uuid().optional(),
          taskId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const actor = requireAiAdmin(ctx);
        const db = getDb();
        let agent: CustomAgentRow | undefined;
        if (!db) {
          agent = memCustomAgents.find((a) => a.customAgentId === input.id);
        } else {
          const rows = await db.execute<CustomAgentRow>(sql`
            select
              custom_agent_id as "customAgentId",
              slug, display_name as "displayName",
              responsibility, system_prompt as "systemPrompt",
              model, enabled,
              produces_drafts as "producesDrafts",
              coalesce(allowed_tools, '[]'::jsonb) as "allowedTools",
              created_by_employee_id as "createdByEmployeeId",
              created_at::text as "createdAt",
              updated_at::text as "updatedAt"
            from public.custom_agent
            where custom_agent_id = ${input.id}::uuid
            limit 1
          `);
          agent = rows[0];
        }
        if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
        if (!agent.enabled) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Custom agent "${agent.slug}" is disabled`,
          });
        }

        const scope = memorySandboxMetadata({
          clientId: input.clientId,
          employeeId: actor.employeeId,
          dealId: input.dealId,
          taskId: input.taskId,
        });
        if (Object.keys(scope).length) {
          await persistMemoryChunk({
            sourceType: "note",
            content: input.prompt,
            metadata: {
              ...scope,
              kind: "custom_agent_run_prompt",
              agentSlug: agent.slug,
            },
          });
        }
        const memory = await searchMemory({
          query: input.prompt,
          clientId: input.clientId,
          employeeId: input.clientId ? undefined : actor.employeeId,
          dealId: input.dealId,
          taskId: input.taskId,
          limit: 6,
        });

        const system = [
          agent.systemPrompt?.trim() ||
            `You are ${agent.displayName} (${agent.slug}).`,
          agent.responsibility?.trim()
            ? `Responsibility: ${agent.responsibility.trim()}`
            : "",
          "Stay inside the assigned client/user/task memory sandbox. Do not invent client facts.",
        ]
          .filter(Boolean)
          .join("\n");

        const provider = createProvider({
          defaultModel: agent.model ?? undefined,
        });
        let generated;
        try {
          generated = await provider.generate({
            model: agent.model ?? undefined,
            task: "generic",
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: `${input.prompt}\n\ncontext: ${JSON.stringify({
                  sandbox: scope,
                  memory,
                  agentSlug: agent.slug,
                })}`,
              },
            ],
          });
        } catch (err) {
          // Demo-ready: fall back to mock when OpenRouter has no credits/keys.
          const mock = createProvider({ provider: "mock" });
          generated = await mock.generate({
            model: "mock",
            task: "generic",
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: `${input.prompt}\n\ncontext: ${JSON.stringify({
                  sandbox: scope,
                  memory,
                  agentSlug: agent.slug,
                  fallback:
                    err instanceof Error ? err.message.slice(0, 120) : "llm_error",
                })}`,
              },
            ],
          });
        }

        const inputTokens = generated.inputTokens ?? 0;
        const outputTokens = generated.outputTokens ?? 0;
        const output = {
          agent: `custom:${agent.slug}` as const,
          model: generated.model,
          output:
            (generated.object as Record<string, unknown>) ?? generated.text,
          inputTokens,
          outputTokens,
          costAed: estimateCostAed(generated.model, inputTokens, outputTokens),
          gateOutcome: (agent.producesDrafts
            ? "pending"
            : "not_applicable") as AgentGateOutcome,
        };

        await persistAgentRun(
          {
            agent: "research" as never,
            input: input.prompt,
            roles: actor.roles,
            model: agent.model ?? undefined,
            context: {
              sandbox: scope,
              memory,
              customAgentId: agent.customAgentId,
              customAgentSlug: agent.slug,
            },
          },
          { ...output, agent: `custom:${agent.slug}` as never },
        ).catch(() => undefined);

        await writeAudit({
          actorEmployeeId: actor.employeeId,
          action: "ai.custom_agent.run",
          entityType: "custom_agent",
          entityId: agent.customAgentId,
          before: null,
          after: {
            slug: agent.slug,
            clientId: input.clientId ?? null,
            model: output.model,
          },
          reason: null,
        });

        return {
          ...output,
          customAgentId: agent.customAgentId,
          slug: agent.slug,
          displayName: agent.displayName,
          sandbox: scope,
          provider: generated.provider,
        };
      }),
  }),
});
