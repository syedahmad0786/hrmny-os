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
import {
  DEFAULT_DEMO_OS_SETTLE_AGENT_TOOLS,
  DEFAULT_FUNNEL_AGENT_TOOLS,
  resolveAgentAllowedTools,
  resolveAgentToolPreset,
  type AgentToolPreset,
} from "../ai/agent-tools";
import { OPENROUTER_FREE_DEFAULT_MODEL } from "@hrmny/ai";
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

/** Stable demo agent so Delivery "Run agent on task" works without Settings setup. */
export const DEMO_DELIVERY_AGENT_ID = "a9000000-0000-4000-8000-0000000000d1";
export const DEMO_DELIVERY_AGENT_SLUG = "delivery-coach";

/** Org-only OS settle agent for Chat / Settings demos (closed loop → settle). */
export const DEMO_OS_SETTLE_AGENT_ID = "a9000000-0000-4000-8000-0000000000d2";
export const DEMO_OS_SETTLE_AGENT_SLUG = "os-settle";

function demoDeliveryAgentRow(): CustomAgentRow {
  const now = new Date().toISOString();
  return {
    customAgentId: DEMO_DELIVERY_AGENT_ID,
    slug: DEMO_DELIVERY_AGENT_SLUG,
    displayName: "Delivery coach",
    responsibility:
      "Suggest the next concrete delivery action for a selected client task.",
    systemPrompt:
      "You are a concise delivery coach for Creative Harmony. Propose the next concrete action for the selected task. Stay inside the client/task sandbox.",
    model: null,
    enabled: true,
    producesDrafts: true,
    allowedTools: [...DEFAULT_FUNNEL_AGENT_TOOLS],
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function demoOsSettleAgentRow(): CustomAgentRow {
  const now = new Date().toISOString();
  return {
    customAgentId: DEMO_OS_SETTLE_AGENT_ID,
    slug: DEMO_OS_SETTLE_AGENT_SLUG,
    displayName: "OS settle",
    responsibility:
      "Org-only closed loop then finance/outreach/brief-lock/QC/portal/campaigns/onboarding/month1/calendar settle.",
    systemPrompt:
      "You are the Hrmny OS settle agent. Prefer agent_act / allowlisted OS tools. Run closed loop then settle: finance, outreach, lock DoR brief (Traffic→Creative), creative QC, portal, campaigns, onboarding signoff, month1 advance, calendar ref-approve. Stay org-scoped (no client sandbox).",
    model: OPENROUTER_FREE_DEFAULT_MODEL,
    enabled: true,
    producesDrafts: true,
    allowedTools: [...DEFAULT_DEMO_OS_SETTLE_AGENT_TOOLS],
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Ensure memory-mode (and empty durable) registries expose runnable demo agents. */
export async function ensureDemoDeliveryAgent() {
  const db = getDb();
  if (!db) {
    if (
      !memCustomAgents.some((a) => a.slug === DEMO_DELIVERY_AGENT_SLUG)
    ) {
      memCustomAgents.unshift(demoDeliveryAgentRow());
    }
    if (!memCustomAgents.some((a) => a.slug === DEMO_OS_SETTLE_AGENT_SLUG)) {
      memCustomAgents.unshift(demoOsSettleAgentRow());
    }
    return;
  }
  try {
    await db.execute(sql`
      insert into public.custom_agent (
        custom_agent_id, slug, display_name, responsibility, system_prompt,
        model, enabled, produces_drafts, allowed_tools, created_by_employee_id
      ) values (
        ${DEMO_DELIVERY_AGENT_ID}::uuid,
        ${DEMO_DELIVERY_AGENT_SLUG},
        ${"Delivery coach"},
        ${"Suggest the next concrete delivery action for a selected client task."},
        ${"You are a concise delivery coach for Creative Harmony. Propose the next concrete action for the selected task. Stay inside the client/task sandbox."},
        null,
        true,
        true,
        ${JSON.stringify([...DEFAULT_FUNNEL_AGENT_TOOLS])}::jsonb,
        null
      )
      on conflict (slug) do nothing
    `);
    await db.execute(sql`
      insert into public.custom_agent (
        custom_agent_id, slug, display_name, responsibility, system_prompt,
        model, enabled, produces_drafts, allowed_tools, created_by_employee_id
      ) values (
        ${DEMO_OS_SETTLE_AGENT_ID}::uuid,
        ${DEMO_OS_SETTLE_AGENT_SLUG},
        ${"OS settle"},
        ${"Org-only closed loop then finance/outreach/brief-lock/QC/portal/campaigns/onboarding/month1/calendar settle."},
        ${"You are the Hrmny OS settle agent. Prefer agent_act / allowlisted OS tools. Run closed loop then settle: finance, outreach, lock DoR brief (Traffic→Creative), creative QC, portal, campaigns, onboarding signoff, month1 advance, calendar ref-approve. Stay org-scoped (no client sandbox)."},
        ${OPENROUTER_FREE_DEFAULT_MODEL},
        true,
        true,
        ${JSON.stringify([...DEFAULT_DEMO_OS_SETTLE_AGENT_TOOLS])}::jsonb,
        null
      )
      on conflict (slug) do update set
        responsibility = excluded.responsibility,
        system_prompt = excluded.system_prompt,
        allowed_tools = excluded.allowed_tools,
        model = coalesce(public.custom_agent.model, excluded.model),
        enabled = true,
        updated_at = now()
    `);
  } catch {
    /* table/constraint missing in some envs — memory path still covers CI */
  }
}

export type RunnableCustomAgent = {
  customAgentId: string;
  slug: string;
  displayName: string;
  model: string | null;
  allowedTools: string[];
  systemPrompt: string;
  responsibility: string;
};

/** Staff chat + Settings: list enabled custom agents (memory or durable). */
export async function listRunnableCustomAgents(): Promise<
  RunnableCustomAgent[]
> {
  await ensureDemoDeliveryAgent();
  const db = getDb();
  if (!db) {
    return memCustomAgents
      .filter((a) => a.enabled)
      .map((a) => ({
        customAgentId: a.customAgentId,
        slug: a.slug,
        displayName: a.displayName,
        model: a.model,
        allowedTools: resolveAgentAllowedTools(a.allowedTools),
        systemPrompt: a.systemPrompt,
        responsibility: a.responsibility,
      }));
  }
  const rows = await db.execute<{
    customAgentId: string;
    slug: string;
    displayName: string;
    model: string | null;
    allowedTools: unknown;
    systemPrompt: string;
    responsibility: string;
  }>(sql`
    select
      custom_agent_id as "customAgentId",
      slug,
      display_name as "displayName",
      model,
      coalesce(allowed_tools, '[]'::jsonb) as "allowedTools",
      system_prompt as "systemPrompt",
      responsibility
    from public.custom_agent
    where enabled = true
    order by display_name asc
    limit 100
  `);
  return rows.map((a) => ({
    customAgentId: a.customAgentId,
    slug: a.slug,
    displayName: a.displayName,
    model: a.model,
    allowedTools: resolveAgentAllowedTools(a.allowedTools),
    systemPrompt: a.systemPrompt,
    responsibility: a.responsibility,
  }));
}

export async function getRunnableCustomAgentBySlug(
  slug: string,
): Promise<RunnableCustomAgent | null> {
  const all = await listRunnableCustomAgents();
  return all.find((a) => a.slug === slug) ?? null;
}

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

/** Load durable agent kill-switches from feature_override into process memory. */
async function hydrateAgentKillSwitches() {
  const db = getDb();
  if (!db) return;
  const rows = await db.execute<{ featureKey: string; enabled: boolean }>(sql`
    select feature_key as "featureKey", enabled
    from public.feature_override
    where scope_type = 'global'
      and scope_key = 'global'
      and feature_key like 'agent.%'
  `);
  for (const row of rows) {
    const id = row.featureKey.slice("agent.".length);
    const parsed = AgentIdSchema.safeParse(id);
    if (parsed.success) setAgentEnabled(parsed.data, row.enabled);
  }
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
      await hydrateAgentKillSwitches();

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
      const db = getDb();
      if (db) {
        await db.execute(sql`
          insert into public.feature_override (
            feature_key, scope_type, scope_key, enabled, updated_by_employee_id
          ) values (
            ${`agent.${input.agentId}`},
            'global',
            'global',
            ${input.enabled},
            ${actor.employeeId}::uuid
          )
          on conflict (feature_key, scope_type, scope_key)
          do update set
            enabled = excluded.enabled,
            updated_by_employee_id = excluded.updated_by_employee_id,
            updated_at = now()
        `);
      }
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
      await hydrateAgentKillSwitches();
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
      const { runAgentTools } = await import("../ai/agent-tools");
      const toolResults = await runAgentTools({
        allowedTools: [...DEFAULT_FUNNEL_AGENT_TOOLS],
        prompt: input.prompt,
        scope: {
          clientId: input.clientId,
          employeeId: ctx.employeeId,
          dealId: input.dealId,
        },
      });
      const result = await boundRunAgent({
        agent: input.agentId,
        input: input.prompt,
        roles: ctx.roles,
        context: {
          sandbox: scope,
          memory,
          toolResults,
        },
      });
      return { ...result, sandbox: scope, toolResults };
    }),

  /** Custom agents (CrewAI/LangSmith-style registry) — Postgres or memory. */
  customAgents: router({
    list: staffProcedure.query(async ({ ctx }) => {
      requireAiAdmin(ctx);
      const db = getDb();
      await ensureDemoDeliveryAgent();
      const toolsJson = JSON.stringify([...DEFAULT_FUNNEL_AGENT_TOOLS]);
      if (!db) {
        for (const row of memCustomAgents) {
          const stored = Array.isArray(row.allowedTools)
            ? row.allowedTools.filter(
                (t): t is string => typeof t === "string" && t.trim().length > 0,
              )
            : [];
          if (stored.length === 0) {
            row.allowedTools = [...DEFAULT_FUNNEL_AGENT_TOOLS];
          }
        }
      } else {
        await db.execute(sql`
          update public.custom_agent
          set
            allowed_tools = ${toolsJson}::jsonb,
            updated_at = now()
          where coalesce(jsonb_array_length(allowed_tools), 0) = 0
        `);
      }
      const rows = !db
        ? memCustomAgents
        : await db.execute<CustomAgentRow>(sql`
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
      return rows.map((row) => {
        const effective = resolveAgentAllowedTools(row.allowedTools);
        const stored = Array.isArray(row.allowedTools)
          ? row.allowedTools.filter(
              (t): t is string => typeof t === "string" && t.trim().length > 0,
            )
          : [];
        return {
          ...row,
          allowedTools: row.allowedTools,
          effectiveAllowedTools: effective,
          toolsEmpty: stored.length === 0,
        };
      });
    }),

    /** Persist funnel defaults onto agents that still have empty allowlists. */
    repairEmptyAllowlists: staffProcedure.mutation(async ({ ctx }) => {
      const actor = requireAiAdmin(ctx);
      const toolsJson = JSON.stringify([...DEFAULT_FUNNEL_AGENT_TOOLS]);
      const db = getDb();
      if (!db) {
        let repaired = 0;
        for (const row of memCustomAgents) {
          const stored = Array.isArray(row.allowedTools)
            ? row.allowedTools.filter(
                (t): t is string => typeof t === "string" && t.trim().length > 0,
              )
            : [];
          if (stored.length === 0) {
            row.allowedTools = [...DEFAULT_FUNNEL_AGENT_TOOLS];
            repaired += 1;
          }
        }
        await writeAudit({
          actorEmployeeId: actor.employeeId,
          action: "ai.custom_agent.repair_allowlists",
          entityType: "custom_agent",
          entityId: null,
          before: null,
          after: { repaired, mode: "memory" },
          reason: null,
        });
        return { ok: true as const, repaired, mode: "memory" as const };
      }
      const rows = await db.execute<{ id: string }>(sql`
        update public.custom_agent
        set
          allowed_tools = ${toolsJson}::jsonb,
          updated_at = now()
        where coalesce(jsonb_array_length(allowed_tools), 0) = 0
        returning custom_agent_id as id
      `);
      await writeAudit({
        actorEmployeeId: actor.employeeId,
        action: "ai.custom_agent.repair_allowlists",
        entityType: "custom_agent",
        entityId: null,
        before: null,
        after: { repaired: rows.length, mode: "durable" },
        reason: null,
      });
      return {
        ok: true as const,
        repaired: rows.length,
        mode: "durable" as const,
      };
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
          /** funnel (default) or demo_os_settle — ignored when allowedTools is set. */
          toolPreset: z.enum(["funnel", "demo_os_settle"]).optional(),
          allowedTools: z.array(z.string()).max(40).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const actor = requireAiAdmin(ctx);
        const presetTools = [
          ...resolveAgentToolPreset(input.toolPreset as AgentToolPreset | undefined),
        ];
        const tools =
          input.allowedTools !== undefined ? input.allowedTools : presetTools;
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
            allowedTools: tools,
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
            after: { slug: row.slug, toolPreset: input.toolPreset ?? "funnel" },
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
              ${JSON.stringify(tools)}::jsonb,
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
            after: { slug: row.slug, toolPreset: input.toolPreset ?? "funnel" },
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

        const { runAgentTools, resolveAgentAllowedTools } = await import(
          "../ai/agent-tools"
        );
        const toolResults = await runAgentTools({
          allowedTools: resolveAgentAllowedTools(agent.allowedTools),
          prompt: input.prompt,
          scope: {
            clientId: input.clientId,
            employeeId: actor.employeeId,
            dealId: input.dealId,
            taskId: input.taskId,
          },
        });

        const system = [
          agent.systemPrompt?.trim() ||
            `You are ${agent.displayName} (${agent.slug}).`,
          agent.responsibility?.trim()
            ? `Responsibility: ${agent.responsibility.trim()}`
            : "",
          "Stay inside the assigned client/user/task memory sandbox. Do not invent client facts.",
          toolResults.length
            ? "Use toolResults as ground truth for CRM/delivery/n8n facts in this turn."
            : "",
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
                  toolResults,
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
                  toolResults,
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
              toolResults,
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
            tools: toolResults.map((t) => t.tool),
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
          toolResults,
        };
      }),
  }),
});
