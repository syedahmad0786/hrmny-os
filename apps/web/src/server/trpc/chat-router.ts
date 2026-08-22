import { createProvider, runHarness, type HarnessTool } from "@hrmny/ai";
import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import { searchMemory } from "../ai/memory-db";
import { staffProcedure, router } from "./trpc";

type ThreadRow = {
  chatThreadId: string;
  employeeId: string;
  title: string;
  agentSlug: string | null;
  clientId: string | null;
  harness: string;
  createdAt: string;
  updatedAt: string;
};

type MessageRow = {
  chatMessageId: string;
  chatThreadId: string;
  role: string;
  content: string;
  toolName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const memThreads = new Map<string, ThreadRow>();
const memMessages = new Map<string, MessageRow[]>();

function nowIso() {
  return new Date().toISOString();
}

/** Exported for unit tests — chat harness tools for a staff/client sandbox. */
export function buildChatDefaultTools(scope: {
  employeeId: string;
  clientId?: string | null;
}): HarnessTool[] {
  return [
    {
      name: "search_memory",
      description:
        "Search org memory for client/deal context snippets (respects client sandbox)",
      run: async (args) => {
        const query = String(args.query ?? "").slice(0, 500);
        if (!query) return { hits: [] };
        const hits = await searchMemory({
          query,
          clientId: scope.clientId ?? undefined,
          employeeId: scope.clientId ? undefined : scope.employeeId,
          limit: 5,
        });
        return {
          hits: hits.map((h) => ({
            content: h.content.slice(0, 500),
            score: h.score,
          })),
        };
      },
    },
    {
      name: "crm_read",
      description: "Read durable CRM deals/companies in the current sandbox",
      run: async (args) => {
        const { runAgentTools } = await import("../ai/agent-tools");
        const results = await runAgentTools({
          allowedTools: ["crm.read", "crm.companies"],
          prompt: String(args.query ?? args.prompt ?? "crm snapshot"),
          scope: {
            clientId: scope.clientId ?? undefined,
            employeeId: scope.employeeId,
            dealId:
              typeof args.dealId === "string" ? args.dealId : undefined,
          },
        });
        return { tools: results };
      },
    },
    {
      name: "delivery_read",
      description:
        "Read delivery tasks and content calendars for the sandboxed client",
      run: async (args) => {
        if (!scope.clientId) {
          return { error: "client_sandbox_required" };
        }
        const { runAgentTools } = await import("../ai/agent-tools");
        const results = await runAgentTools({
          allowedTools: ["delivery.read", "onboarding.read"],
          prompt: String(args.query ?? args.prompt ?? "delivery snapshot"),
          scope: {
            clientId: scope.clientId,
            employeeId: scope.employeeId,
          },
        });
        return { tools: results };
      },
    },
    {
      name: "outreach_read",
      description: "List HITL outreach drafts/sends (optionally for a dealId)",
      run: async (args) => {
        const { runAgentTools } = await import("../ai/agent-tools");
        const results = await runAgentTools({
          allowedTools: ["outreach.read"],
          prompt: String(args.query ?? "outreach queue"),
          scope: {
            clientId: scope.clientId ?? undefined,
            employeeId: scope.employeeId,
            dealId:
              typeof args.dealId === "string" ? args.dealId : undefined,
          },
        });
        return { tools: results };
      },
    },
    {
      name: "funnel_act",
      description:
        "Run sandboxed funnel writes for the bound client (tasks, briefs, campaigns, portal invite, creative→portal). Requires client sandbox.",
      run: async (args) => {
        if (!scope.clientId) {
          return { error: "client_sandbox_required" };
        }
        const { runAgentTools, DEFAULT_FUNNEL_AGENT_TOOLS } = await import(
          "../ai/agent-tools"
        );
        const writes = DEFAULT_FUNNEL_AGENT_TOOLS.filter(
          (t) =>
            t === "tasks.create" ||
            t === "outreach.draft" ||
            t === "crm.note" ||
            t === "campaigns.draft" ||
            t === "briefs.draft" ||
            t === "portal.invite" ||
            t === "creative.sendToPortal",
        );
        const results = await runAgentTools({
          allowedTools: [...writes],
          prompt: String(
            args.prompt ?? args.query ?? "Advance client funnel drafts",
          ),
          scope: {
            clientId: scope.clientId,
            employeeId: scope.employeeId,
            dealId:
              typeof args.dealId === "string" ? args.dealId : undefined,
            taskId:
              typeof args.taskId === "string" ? args.taskId : undefined,
          },
        });
        return { tools: results };
      },
    },
    ...(scope.clientId
      ? []
      : [
          {
            name: "crm_closed_loop",
            description:
              "Org-only: prospect → won → handover → onboarding. Prompt must mention closed loop (or won handover). Returns portal magic links.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const results = await runAgentTools({
                allowedTools: ["crm.closed_loop"],
                prompt: String(
                  args.prompt ?? args.query ?? "Run demo closed loop",
                ),
                scope: {
                  employeeId: scope.employeeId,
                },
              });
              return { tools: results };
            },
          } satisfies HarnessTool,
          {
            name: "finance_os_approve",
            description:
              "Org-only: approve a proposed OS invoice. Prompt must mention approve + invoiceId UUID.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const id =
                typeof args.invoiceId === "string" ? args.invoiceId : "";
              const base = String(
                args.prompt ?? args.query ?? "Approve OS invoice",
              );
              const prompt = id
                ? `${base} invoiceId: ${id}`
                : base;
              const results = await runAgentTools({
                allowedTools: ["finance.os_approve"],
                prompt,
                scope: { employeeId: scope.employeeId },
              });
              return { tools: results };
            },
          } satisfies HarnessTool,
          {
            name: "finance_os_issue",
            description:
              "Org-only: issue an approved OS invoice (OS-only when Xero write off). Prompt must mention issue + invoiceId UUID.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const id =
                typeof args.invoiceId === "string" ? args.invoiceId : "";
              const base = String(
                args.prompt ?? args.query ?? "Issue OS invoice",
              );
              const prompt = id
                ? `${base} invoiceId: ${id}`
                : base;
              const results = await runAgentTools({
                allowedTools: ["finance.os_issue"],
                prompt,
                scope: { employeeId: scope.employeeId },
              });
              return { tools: results };
            },
          } satisfies HarnessTool,
          {
            name: "outreach_os_approve",
            description:
              "Org-only: approve a drafted outreach (HITL). Prompt must mention approve + outreachId UUID. Does not send.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const id =
                typeof args.outreachId === "string" ? args.outreachId : "";
              const base = String(
                args.prompt ?? args.query ?? "Approve OS outreach",
              );
              const prompt = id
                ? `${base} outreachId: ${id}`
                : base;
              const results = await runAgentTools({
                allowedTools: ["outreach.os_approve"],
                prompt,
                scope: { employeeId: scope.employeeId },
              });
              return { tools: results };
            },
          } satisfies HarnessTool,
          {
            name: "creative_os_qc",
            description:
              "Org-only: pass/fail/waive creative QC on a delivery task. Prompt must mention pass QC + taskId UUID.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const id =
                typeof args.taskId === "string" ? args.taskId : "";
              const base = String(
                args.prompt ?? args.query ?? "Pass QC on creative task",
              );
              const prompt = id ? `${base} taskId: ${id}` : base;
              const results = await runAgentTools({
                allowedTools: ["creative.os_qc"],
                prompt,
                scope: {
                  employeeId: scope.employeeId,
                  taskId: id || undefined,
                },
              });
              return { tools: results };
            },
          } satisfies HarnessTool,
          {
            name: "campaigns_os_approve",
            description:
              "Org-only: approve a draft campaign. Prompt must mention approve + campaignItemId UUID.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const id =
                typeof args.campaignItemId === "string"
                  ? args.campaignItemId
                  : "";
              const base = String(
                args.prompt ?? args.query ?? "Approve OS campaign",
              );
              const prompt = id
                ? `${base} campaignItemId: ${id}`
                : base;
              const results = await runAgentTools({
                allowedTools: ["campaigns.os_approve"],
                prompt,
                scope: { employeeId: scope.employeeId },
              });
              return { tools: results };
            },
          } satisfies HarnessTool,
          {
            name: "campaigns_os_publish",
            description:
              "Org-only: publish an approved campaign via LinkedIn stub (no live LI). Prompt must mention publish + campaignItemId.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const id =
                typeof args.campaignItemId === "string"
                  ? args.campaignItemId
                  : "";
              const base = String(
                args.prompt ?? args.query ?? "Publish OS campaign stub",
              );
              const prompt = id
                ? `${base} campaignItemId: ${id}`
                : base;
              const results = await runAgentTools({
                allowedTools: ["campaigns.os_publish"],
                prompt,
                scope: { employeeId: scope.employeeId },
              });
              return { tools: results };
            },
          } satisfies HarnessTool,
        ]),
    {
      name: "now",
      description: "Return the current UTC timestamp",
      run: async () => ({ utc: nowIso() }),
    },
  ];
}

function defaultTools(scope: {
  employeeId: string;
  clientId?: string | null;
}): HarnessTool[] {
  return buildChatDefaultTools(scope);
}

export const chatRouter = router({
  /** Enabled custom agents staff can bind to a chat thread (no AI-admin gate). */
  listRunnableAgents: staffProcedure.query(async () => {
    const db = getDb();
    if (!db) {
      return [] as Array<{
        slug: string;
        displayName: string;
        customAgentId: string;
      }>;
    }
    return db.execute<{
      slug: string;
      displayName: string;
      customAgentId: string;
    }>(sql`
      select
        custom_agent_id as "customAgentId",
        slug,
        display_name as "displayName"
      from public.custom_agent
      where enabled = true
      order by display_name asc
      limit 100
    `);
  }),

  listThreads: staffProcedure.query(async ({ ctx }) => {
    const employeeId = ctx.employeeId!;
    const db = getDb();
    if (!db) {
      return [...memThreads.values()]
        .filter((t) => t.employeeId === employeeId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return db.execute<ThreadRow>(sql`
      select
        chat_thread_id as "chatThreadId",
        employee_id as "employeeId",
        title,
        agent_slug as "agentSlug",
        client_id as "clientId",
        harness,
        created_at::text as "createdAt",
        updated_at::text as "updatedAt"
      from public.chat_thread
      where employee_id = ${employeeId}::uuid
      order by updated_at desc
      limit 50
    `);
  }),

  createThread: staffProcedure
    .input(
      z.object({
        title: z.string().min(1).max(120).optional(),
        agentSlug: z.string().max(80).optional(),
        clientId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId!;
      const db = getDb();
      if (!db) {
        const row: ThreadRow = {
          chatThreadId: crypto.randomUUID(),
          employeeId,
          title: input.title ?? "Chat",
          agentSlug: input.agentSlug ?? null,
          clientId: input.clientId ?? null,
          harness: "react",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        memThreads.set(row.chatThreadId, row);
        memMessages.set(row.chatThreadId, []);
        return row;
      }
      const rows = await db.execute<ThreadRow>(sql`
        insert into public.chat_thread (
          employee_id, title, agent_slug, client_id, harness
        ) values (
          ${employeeId}::uuid,
          ${input.title ?? "Chat"},
          ${input.agentSlug ?? null},
          ${input.clientId ?? null}::uuid,
          'react'
        )
        returning
          chat_thread_id as "chatThreadId",
          employee_id as "employeeId",
          title,
          agent_slug as "agentSlug",
          client_id as "clientId",
          harness,
          created_at::text as "createdAt",
          updated_at::text as "updatedAt"
      `);
      return rows[0]!;
    }),

  messages: staffProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId!;
      const db = getDb();
      if (!db) {
        const thread = memThreads.get(input.threadId);
        if (!thread || thread.employeeId !== employeeId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return memMessages.get(input.threadId) ?? [];
      }
      const owned = await db.execute<{ id: string }>(sql`
        select chat_thread_id as id from public.chat_thread
        where chat_thread_id = ${input.threadId}::uuid
          and employee_id = ${employeeId}::uuid
        limit 1
      `);
      if (!owned[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return db.execute<MessageRow>(sql`
        select
          chat_message_id as "chatMessageId",
          chat_thread_id as "chatThreadId",
          role, content,
          tool_name as "toolName",
          coalesce(metadata, '{}'::jsonb) as metadata,
          created_at::text as "createdAt"
        from public.chat_message
        where chat_thread_id = ${input.threadId}::uuid
        order by created_at asc
        limit 200
      `);
    }),

  send: staffProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        content: z.string().min(1).max(8000),
        effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
        harness: z.enum(["react", "direct"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId!;
      const db = getDb();
      const effort = input.effort ?? "medium";
      const maxIterations =
        input.harness === "direct"
          ? 1
          : effort === "low"
            ? 2
            : effort === "high"
              ? 5
              : effort === "xhigh"
                ? 6
                : 4;
      const temperature =
        effort === "low" ? 0.2 : effort === "xhigh" ? 0.5 : 0.3;

      let thread: ThreadRow | undefined;
      if (!db) {
        thread = memThreads.get(input.threadId);
        if (!thread || thread.employeeId !== employeeId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
      } else {
        const rows = await db.execute<ThreadRow>(sql`
          select
            chat_thread_id as "chatThreadId",
            employee_id as "employeeId",
            title,
            agent_slug as "agentSlug",
            client_id as "clientId",
            harness,
            created_at::text as "createdAt",
            updated_at::text as "updatedAt"
          from public.chat_thread
          where chat_thread_id = ${input.threadId}::uuid
            and employee_id = ${employeeId}::uuid
          limit 1
        `);
        thread = rows[0];
        if (!thread) throw new TRPCError({ code: "NOT_FOUND" });
      }

      const userMsg: MessageRow = {
        chatMessageId: crypto.randomUUID(),
        chatThreadId: input.threadId,
        role: "user",
        content: input.content,
        toolName: null,
        metadata: {},
        createdAt: nowIso(),
      };

      if (!db) {
        const list = memMessages.get(input.threadId) ?? [];
        list.push(userMsg);
        memMessages.set(input.threadId, list);
      } else {
        await db.execute(sql`
          insert into public.chat_message (
            chat_message_id, chat_thread_id, role, content
          ) values (
            ${userMsg.chatMessageId}::uuid,
            ${input.threadId}::uuid,
            'user',
            ${input.content}
          )
        `);
      }

      const provider = createProvider({});
      let customSystem = "";
      if (thread.agentSlug) {
        const dbAgent = getDb();
        if (dbAgent) {
          const rows = await dbAgent.execute<{
            systemPrompt: string;
            displayName: string;
            responsibility: string;
          }>(sql`
            select
              system_prompt as "systemPrompt",
              display_name as "displayName",
              responsibility
            from public.custom_agent
            where slug = ${thread.agentSlug}
              and enabled = true
            limit 1
          `);
          const custom = rows[0];
          if (custom) {
            customSystem = [
              custom.systemPrompt?.trim() ||
                `You are ${custom.displayName} (${thread.agentSlug}).`,
              custom.responsibility?.trim()
                ? `Responsibility: ${custom.responsibility.trim()}`
                : "",
            ]
              .filter(Boolean)
              .join("\n");
          }
        }
      }
      const system = [
        customSystem ||
          "You are Hrmny — the multiplayer agent harness for Creative Harmony staff.",
        "Inspired by QM (YC Software): plan → act → observe, then answer.",
        "Be concise. Prefer tools for factual lookups. Never invent client data.",
        `Effort level: ${effort}.`,
        !customSystem && thread.agentSlug
          ? `Preferred agent persona: ${thread.agentSlug}.`
          : "",
        thread.clientId ? `Client sandbox id: ${thread.clientId}.` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const steps: Array<Record<string, unknown>> = [];
      const harnessResult =
        input.harness === "direct"
          ? await (async () => {
              const res = await provider.generate({
                messages: [
                  { role: "system", content: system },
                  { role: "user", content: input.content },
                ],
                temperature,
                task: "generic",
              });
              return {
                answer: res.text,
                steps: [{ iteration: 0, answer: res.text }],
              };
            })()
          : await runHarness({
              system,
              user: input.content,
              tools: defaultTools({
                employeeId,
                clientId: thread.clientId,
              }),
              maxIterations,
              generate: async (messages) => {
                const folded = messages.map((m) => {
                  if (m.role === "tool") {
                    return {
                      role: "user" as const,
                      content: `Observation from ${m.toolName ?? "tool"}:\n${m.content}`,
                    };
                  }
                  return {
                    role: m.role as "system" | "user" | "assistant",
                    content: m.content,
                  };
                });
                const res = await provider.generate({
                  messages: folded,
                  temperature,
                  task: "generic",
                });
                return res.text;
              },
              onStep: (step) => {
                steps.push(step as unknown as Record<string, unknown>);
              },
            });

      const assistantMsg: MessageRow = {
        chatMessageId: crypto.randomUUID(),
        chatThreadId: input.threadId,
        role: "assistant",
        content: harnessResult.answer,
        toolName: null,
        metadata: {
          provider: provider.name,
          harness: input.harness ?? "react",
          effort,
          steps:
            "steps" in harnessResult && Array.isArray(harnessResult.steps)
              ? harnessResult.steps
              : steps,
        },
        createdAt: nowIso(),
      };

      if (!db) {
        const list = memMessages.get(input.threadId) ?? [];
        list.push(assistantMsg);
        memMessages.set(input.threadId, list);
        thread.updatedAt = nowIso();
        if (thread.title === "Chat") {
          thread.title = input.content.slice(0, 60);
        }
      } else {
        await db.execute(sql`
          insert into public.chat_message (
            chat_message_id, chat_thread_id, role, content, metadata
          ) values (
            ${assistantMsg.chatMessageId}::uuid,
            ${input.threadId}::uuid,
            'assistant',
            ${assistantMsg.content},
            ${JSON.stringify(assistantMsg.metadata)}::jsonb
          )
        `);
        await db.execute(sql`
          update public.chat_thread
          set updated_at = now(),
              title = case
                when title = 'Chat' then ${input.content.slice(0, 60)}
                else title
              end
          where chat_thread_id = ${input.threadId}::uuid
        `);
      }

      return {
        user: userMsg,
        assistant: assistantMsg,
        provider: provider.name,
        steps,
      };
    }),
});
