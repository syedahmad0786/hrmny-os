import { createProvider, runHarness, type HarnessTool } from "@hrmny/ai";
import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { nextLinksFromToolResults } from "../../lib/agent-next-links";
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
        return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
        return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
        return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
        return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
            },
          } satisfies HarnessTool,
          {
            name: "briefs_os_lock",
            description:
              "Lock a DoR-ready brief and spawn creative_spawn (Traffic→Creative). Prompt must mention lock brief + briefId or taskId UUID. No Canva required.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const briefId =
                typeof args.briefId === "string" ? args.briefId : "";
              const taskId =
                typeof args.taskId === "string" ? args.taskId : "";
              const base = String(
                args.prompt ?? args.query ?? "Lock the brief",
              );
              let prompt = base;
              if (briefId && !/brief(?:Id)?\s*[:=]/i.test(prompt)) {
                prompt = `${prompt} briefId: ${briefId}`;
              }
              if (taskId && !/task(?:Id)?\s*[:=]/i.test(prompt)) {
                prompt = `${prompt} taskId: ${taskId}`;
              }
              const results = await runAgentTools({
                allowedTools: ["briefs.os_lock"],
                prompt,
                scope: {
                  employeeId: scope.employeeId,
                  taskId: taskId || undefined,
                },
              });
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
            },
          } satisfies HarnessTool,
          {
            name: "portal_os_approve",
            description:
              "Org-only: approve/reject a client_review portal item. Prompt must mention portal approve + taskId/approvalId UUID.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const id =
                typeof args.approvalId === "string"
                  ? args.approvalId
                  : typeof args.taskId === "string"
                    ? args.taskId
                    : "";
              const base = String(
                args.prompt ?? args.query ?? "Approve OS portal",
              );
              const prompt = id ? `${base} taskId: ${id}` : base;
              const results = await runAgentTools({
                allowedTools: ["portal.os_approve"],
                prompt,
                scope: {
                  employeeId: scope.employeeId,
                  taskId: id || undefined,
                },
              });
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
            },
          } satisfies HarnessTool,
          {
            name: "onboarding_os_signoff",
            description:
              "Org-only: sign off an active onboarding phase. Prompt must mention sign off + optional clientId/phaseIndex.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const id =
                typeof args.clientId === "string" ? args.clientId : "";
              const base = String(
                args.prompt ?? args.query ?? "Sign off onboarding phase",
              );
              const prompt = id ? `${base} clientId: ${id}` : base;
              const results = await runAgentTools({
                allowedTools: ["onboarding.os_signoff"],
                prompt,
                scope: { employeeId: scope.employeeId },
              });
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
            },
          } satisfies HarnessTool,
          {
            name: "calendar_os_ref_approve",
            description:
              "Org-only: ref-approve a delivery calendar. Prompt must mention ref-approve + calendarId UUID.",
            run: async (args: Record<string, unknown>) => {
              const { runAgentTools } = await import("../ai/agent-tools");
              const id =
                typeof args.calendarId === "string" ? args.calendarId : "";
              const base = String(
                args.prompt ?? args.query ?? "Ref-approve calendar",
              );
              const prompt = id ? `${base} calendarId: ${id}` : base;
              const results = await runAgentTools({
                allowedTools: ["calendar.os_ref_approve"],
                prompt,
                scope: { employeeId: scope.employeeId },
              });
              return {
          nextLinks: nextLinksFromToolResults(results),
          tools: results,
        };
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
    const { listRunnableCustomAgents } = await import("./ai-admin-router");
    const agents = await listRunnableCustomAgents();
    return agents.map((a) => ({
      customAgentId: a.customAgentId,
      slug: a.slug,
      displayName: a.displayName,
      model: a.model,
      toolCount: a.allowedTools.length,
      toolsPreview: a.allowedTools.slice(0, 6),
    }));
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

      const providerBase = createProvider({});
      let customSystem = "";
      let agentModel: string | undefined;
      let agentTools: string[] = [];
      if (thread.agentSlug) {
        const { getRunnableCustomAgentBySlug } = await import(
          "./ai-admin-router"
        );
        const custom = await getRunnableCustomAgentBySlug(thread.agentSlug);
        if (custom) {
          customSystem = [
            custom.systemPrompt?.trim() ||
              `You are ${custom.displayName} (${thread.agentSlug}).`,
            custom.responsibility?.trim()
              ? `Responsibility: ${custom.responsibility.trim()}`
              : "",
            custom.allowedTools.length
              ? `Allowlisted tools: ${custom.allowedTools.join(", ")}.`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
          agentModel = custom.model?.trim() || undefined;
          agentTools = custom.allowedTools;
        }
      }
      const provider = agentModel
        ? createProvider({ defaultModel: agentModel })
        : providerBase;
      const generateSafe = async (
        args: Parameters<typeof provider.generate>[0],
      ) => {
        try {
          return await provider.generate(args);
        } catch (err) {
          // Demo-ready: free OpenRouter routes flake (429/empty). Keep tool
          // results usable by falling back to mock like Settings AI run.
          const mock = createProvider({ provider: "mock" });
          const fallback = await mock.generate({
            ...args,
            model: "mock",
          });
          return {
            ...fallback,
            text: `${fallback.text}\n\n(note: live LLM unavailable — ${
              err instanceof Error ? err.message.slice(0, 120) : "llm_error"
            })`,
          };
        }
      };
      const system = [
        customSystem ||
          "You are Hrmny — the multiplayer agent harness for Creative Harmony staff.",
        "Hrmny staff agent: plan → call allowlisted CRM/OS tools → observe → answer.",
        "Be concise. Prefer tools for factual lookups. Never invent client data.",
        `Effort level: ${effort}.`,
        !customSystem && thread.agentSlug
          ? `Preferred agent persona: ${thread.agentSlug}.`
          : "",
        thread.clientId
          ? `Client sandbox id: ${thread.clientId}.`
          : "Org / staff scope (no client sandbox).",
        agentTools.length
          ? "When the user asks you to act, call agent_act with their prompt so allowlisted OS/CRM tools can run."
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      const harnessTools: HarnessTool[] = [
        ...defaultTools({
          employeeId,
          clientId: thread.clientId,
        }),
      ];
      if (agentTools.length) {
        harnessTools.unshift({
          name: "agent_act",
          description:
            "Run this custom agent's allowlisted tools (CRM/OS/funnel) inside the current sandbox. Pass the user intent as prompt.",
          run: async (args: Record<string, unknown>) => {
            const { runAgentTools } = await import("../ai/agent-tools");
            const prompt = String(
              args.prompt ?? args.query ?? input.content,
            ).slice(0, 4000);
            const results = await runAgentTools({
              allowedTools: agentTools,
              prompt,
              scope: {
                clientId: thread.clientId ?? undefined,
                employeeId,
              },
            });
            // nextLinks first so 4k observation truncation keeps CTAs.
            return {
              nextLinks: nextLinksFromToolResults(results),
              agentSlug: thread.agentSlug,
              tools: results,
            };
          },
        } satisfies HarnessTool);
      }

      const steps: Array<Record<string, unknown>> = [];
      const harnessResult =
        input.harness === "direct"
          ? await (async () => {
              // Direct mode still executes allowlisted agent tools once so
              // selecting an agent is never a no-op.
              if (agentTools.length) {
                const { runAgentTools } = await import("../ai/agent-tools");
                const toolResults = await runAgentTools({
                  allowedTools: agentTools,
                  prompt: input.content,
                  scope: {
                    clientId: thread.clientId ?? undefined,
                    employeeId,
                  },
                });
                const nextLinks = nextLinksFromToolResults(toolResults);
                steps.push({
                  iteration: 0,
                  toolName: "agent_act",
                  nextLinks,
                  // nextLinks first so truncation keeps closed-loop CTAs.
                  observation: JSON.stringify({
                    nextLinks,
                    tools: toolResults,
                  }).slice(0, 4000),
                });
                const res = await generateSafe({
                  messages: [
                    { role: "system", content: system },
                    {
                      role: "user",
                      content: `${input.content}\n\ntoolResults: ${JSON.stringify(toolResults).slice(0, 6000)}`,
                    },
                  ],
                  temperature,
                  task: "generic",
                });
                return {
                  answer: res.text,
                  steps: [
                    ...steps,
                    { iteration: 1, answer: res.text },
                  ],
                };
              }
              const res = await generateSafe({
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
              tools: harnessTools,
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
                const res = await generateSafe({
                  messages: folded,
                  temperature,
                  task: "generic",
                });
                return res.text;
              },
              onStep: (step) => {
                const row = { ...(step as unknown as Record<string, unknown>) };
                if (typeof row.observation === "string") {
                  const links = nextLinksFromToolResults(
                    (() => {
                      try {
                        const parsed = JSON.parse(row.observation) as {
                          tools?: Array<{ data?: unknown }>;
                          nextLinks?: unknown;
                        };
                        if (Array.isArray(parsed.nextLinks)) return [];
                        return parsed.tools ?? [];
                      } catch {
                        return [];
                      }
                    })(),
                  );
                  // Prefer links already embedded; else recompute from tools.
                  if (!Array.isArray(row.nextLinks) || row.nextLinks.length === 0) {
                    const embedded = (() => {
                      try {
                        const parsed = JSON.parse(String(row.observation)) as {
                          nextLinks?: unknown;
                        };
                        return Array.isArray(parsed.nextLinks)
                          ? parsed.nextLinks
                          : links;
                      } catch {
                        return links;
                      }
                    })();
                    if (embedded.length) row.nextLinks = embedded;
                  }
                }
                steps.push(row);
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
          model: agentModel ?? process.env.LLM_DEFAULT_MODEL ?? null,
          agentSlug: thread.agentSlug,
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
