import {
  createProvider,
  runHarness,
  runtimeLlmSnapshot,
  type HarnessTool,
} from "@hrmny/ai";
import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { nextLinksFromToolResults } from "../../lib/agent-next-links";
import { getDb } from "../db";
import { featureEnabled } from "../features";
import { searchMemory } from "../ai/memory-db";
import { isPortalDecisionIntent } from "../ai/agent-tools";
import {
  composioAiConnectedApps,
  searchComposioConnectedData,
} from "../composio-connected-data-ai";
import { getVerifiedWorkAppConnection } from "./connections-router";
import { getDemoWork } from "./work-management-router";
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

type OperationsQueue = {
  projectId: string;
  name: string;
  ownerName: string | null;
  sourcePlatform: string;
  openTasks: number;
  overdueTasks: number;
  unassignedTasks: number;
};

function nowIso() {
  return new Date().toISOString();
}

export async function readWorkOperations(scope: {
  employeeId: string;
  clientId?: string | null;
  roles?: readonly string[];
}) {
  const enabled = await featureEnabled("work.projects", {
    userId: scope.employeeId,
    clientId: scope.clientId,
    roles: scope.roles,
  });
  if (!enabled) return { error: "work_projects_not_enabled" };

  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    const projects = [...store.projects.values()].filter(
      (project) =>
        project.projectKind !== "personal" &&
        (!scope.clientId || project.clientId === scope.clientId),
    );
    const projectIds = new Set(projects.map((project) => project.projectId));
    const items = [...store.items.values()].filter(
      (item) => projectIds.has(item.projectId) && !item.completedAt,
    );
    const queues: OperationsQueue[] = projects
      .map((project) => {
        const projectItems = items.filter(
          (item) => item.projectId === project.projectId,
        );
        return {
          projectId: project.projectId,
          name: project.name,
          ownerName: project.ownerName ?? null,
          sourcePlatform: project.sourcePlatform,
          openTasks: projectItems.length,
          overdueTasks: projectItems.filter(
            (item) => item.dueAt && new Date(item.dueAt) < new Date(),
          ).length,
          unassignedTasks: projectItems.filter(
            (item) => !item.assigneeEmployeeId,
          ).length,
        };
      })
      .sort(
        (a, b) =>
          b.overdueTasks - a.overdueTasks ||
          b.unassignedTasks - a.unassignedTasks ||
          b.openTasks - a.openTasks,
      )
      .slice(0, 10);
    return {
      source: "demo",
      freshness: null,
      totals: {
        projects: projects.length,
        openTasks: items.length,
        overdueTasks: items.filter(
          (item) => item.dueAt && new Date(item.dueAt) < new Date(),
        ).length,
        unassignedTasks: items.filter((item) => !item.assigneeEmployeeId)
          .length,
      },
      queues,
      nextLinks: [
        { href: "/work", label: "Open Work" },
        { href: "/work/planning", label: "Review workload" },
        { href: "/settings/asana-migration", label: "Asana sync" },
      ],
    };
  }

  const rows = await db.execute<
    OperationsQueue & { totalProjects: number }
  >(sql`
    with visible_projects as (
      select distinct project.work_project_id, project.name,
        project.owner_employee_id, project.source_platform
      from public.work_project project
      left join public.work_project_member member
        on member.work_project_id = project.work_project_id
        and member.employee_id = ${scope.employeeId}::uuid
      left join public.work_team_project team_project
        on team_project.work_project_id = project.work_project_id
      left join public.work_team_member team_member
        on team_member.work_team_id = team_project.work_team_id
        and team_member.employee_id = ${scope.employeeId}::uuid
      where project.archived_at is null
        and project.project_kind = 'standard'
        and (${scope.clientId ?? null}::uuid is null
          or project.client_id = ${scope.clientId ?? null}::uuid)
        and (
          project.privacy = 'organization'
          or project.created_by_employee_id = ${scope.employeeId}::uuid
          or project.owner_employee_id = ${scope.employeeId}::uuid
          or member.employee_id is not null
          or team_member.employee_id is not null
        )
    ), queue as (
      select project.work_project_id as "projectId", project.name,
        owner.display_name as "ownerName",
        project.source_platform as "sourcePlatform",
        count(distinct item.work_item_id) filter (
          where item.completed_at is null
        )::int as "openTasks",
        count(distinct item.work_item_id) filter (
          where item.completed_at is null and item.due_at < now()
        )::int as "overdueTasks",
        count(distinct item.work_item_id) filter (
          where item.completed_at is null and item.assignee_employee_id is null
        )::int as "unassignedTasks"
      from visible_projects project
      left join public.employee owner
        on owner.employee_id = project.owner_employee_id
      left join public.work_project_item membership
        on membership.work_project_id = project.work_project_id
      left join public.work_item item
        on item.work_item_id = membership.work_item_id
        and item.archived_at is null
      group by project.work_project_id, project.name, owner.display_name,
        project.source_platform
    )
    select queue.*, count(*) over ()::int as "totalProjects"
    from queue
    order by "overdueTasks" desc, "unassignedTasks" desc, "openTasks" desc,
      lower(name)
    limit 10
  `);
  const [totals] = await db.execute<{
    openTasks: number;
    overdueTasks: number;
    unassignedTasks: number;
  }>(sql`
    with visible_projects as (
      select distinct project.work_project_id
      from public.work_project project
      left join public.work_project_member member
        on member.work_project_id = project.work_project_id
        and member.employee_id = ${scope.employeeId}::uuid
      left join public.work_team_project team_project
        on team_project.work_project_id = project.work_project_id
      left join public.work_team_member team_member
        on team_member.work_team_id = team_project.work_team_id
        and team_member.employee_id = ${scope.employeeId}::uuid
      where project.archived_at is null and project.project_kind = 'standard'
        and (${scope.clientId ?? null}::uuid is null
          or project.client_id = ${scope.clientId ?? null}::uuid)
        and (project.privacy = 'organization'
          or project.created_by_employee_id = ${scope.employeeId}::uuid
          or project.owner_employee_id = ${scope.employeeId}::uuid
          or member.employee_id is not null or team_member.employee_id is not null)
    ), visible_items as (
      select distinct item.work_item_id, item.due_at,
        item.assignee_employee_id
      from visible_projects project
      join public.work_project_item membership
        on membership.work_project_id = project.work_project_id
      join public.work_item item on item.work_item_id = membership.work_item_id
      where item.archived_at is null and item.completed_at is null
    )
    select count(*)::int as "openTasks",
      count(*) filter (where due_at < now())::int as "overdueTasks",
      count(*) filter (where assignee_employee_id is null)::int as "unassignedTasks"
    from visible_items
  `);
  const [freshness] = await db.execute<{
    status: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
  }>(sql`
    select status, last_synced_at::text as "lastSyncedAt",
      last_error as "lastError"
    from public.asana_sync_state
    order by last_synced_at desc nulls last, updated_at desc
    limit 1
  `);
  return {
    source: rows.some((row) => row.sourcePlatform === "asana")
      ? "asana_via_work"
      : "work",
    freshness: freshness ?? null,
    totals: {
      projects: rows[0]?.totalProjects ?? 0,
      openTasks: totals?.openTasks ?? 0,
      overdueTasks: totals?.overdueTasks ?? 0,
      unassignedTasks: totals?.unassignedTasks ?? 0,
    },
    queues: rows.map(({ totalProjects: _totalProjects, ...queue }) => queue),
    nextLinks: [
      { href: "/work", label: "Open Work" },
      { href: "/work/planning", label: "Review workload" },
      { href: "/settings/asana-migration", label: "Asana sync" },
    ],
  };
}

export function externalChatThreadId(
  employeeId: string,
  externalRef: string,
): string {
  const bytes = createHash("sha256")
    .update("hrmny.external-chat.v1\0")
    .update(employeeId)
    .update("\0")
    .update(externalRef)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One durable HRMNY conversation for each employee + external chat scope. */
export async function getOrCreateExternalChatThread(input: {
  employeeId: string;
  externalRef: string;
  title: string;
}): Promise<ThreadRow> {
  if (!input.employeeId.trim() || !input.externalRef.trim()) {
    throw new Error("EXTERNAL_CHAT_SCOPE_REQUIRED");
  }
  const chatThreadId = externalChatThreadId(
    input.employeeId,
    input.externalRef,
  );
  const title = input.title.trim().slice(0, 120) || "Google Chat";
  const db = getDb();
  if (!db) {
    const existing = memThreads.get(chatThreadId);
    if (existing) {
      if (existing.employeeId !== input.employeeId) {
        throw new Error("EXTERNAL_CHAT_SCOPE_CONFLICT");
      }
      return existing;
    }
    const createdAt = nowIso();
    const row: ThreadRow = {
      chatThreadId,
      employeeId: input.employeeId,
      title,
      agentSlug: null,
      clientId: null,
      harness: "direct",
      createdAt,
      updatedAt: createdAt,
    };
    memThreads.set(chatThreadId, row);
    memMessages.set(chatThreadId, []);
    return row;
  }

  await db.execute(sql`
    insert into public.chat_thread (
      chat_thread_id, employee_id, title, harness
    ) values (
      ${chatThreadId}::uuid, ${input.employeeId}::uuid, ${title}, 'direct'
    )
    on conflict (chat_thread_id) do nothing
  `);
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
    where chat_thread_id = ${chatThreadId}::uuid
      and employee_id = ${input.employeeId}::uuid
    limit 1
  `);
  if (!rows[0]) throw new Error("EXTERNAL_CHAT_THREAD_NOT_FOUND");
  return rows[0];
}

/** Exported for unit tests — chat harness tools for a staff/client sandbox. */
export function buildChatDefaultTools(scope: {
  employeeId: string;
  clientId?: string | null;
  roles?: readonly string[];
  immutableUserPrompt?: string;
}): HarnessTool[] {
  const tools: HarnessTool[] = [
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
      name: "operations_read",
      description:
        "Read the current Work operating picture: visible projects, open work, overdue work, unassigned work, source freshness, and highest-risk queues",
      run: async () => readWorkOperations(scope),
    },
    {
      name: "connected_search",
      description:
        "Read up to five relevant results from each approved, employee-connected Composio work app; never changes external data",
      run: async (args) => {
        const query = String(args.query ?? args.prompt ?? "")
          .trim()
          .slice(0, 2_000);
        if (!query) return { error: "query_required" };
        const sources = await Promise.allSettled(
          composioAiConnectedApps.map(async (definition) => {
            const verified = await getVerifiedWorkAppConnection(
              scope.employeeId,
              definition.app,
              { clientId: scope.clientId, roles: scope.roles ?? [] },
            );
            return verified
              ? searchComposioConnectedData({
                  client: verified.client,
                  connectedAccountId: verified.account.id,
                  app: definition.app,
                  query,
                })
              : [];
          }),
        );
        const results = sources.flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        );
        return {
          results,
          connectedSources: results.length,
          nextLinks: [
            { href: "/settings/connections", label: "Manage connections" },
          ],
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
  // Client-bound free-form Chat is read-only. Effectful client work must enter
  // through a typed command/effect broker, never a model-selected generic tool.
  // Recognizable portal-decision wording remains a second fail-closed guard for
  // org Chat, but it is not the authorization boundary.
  if (
    scope.clientId ||
    isPortalDecisionIntent(scope.immutableUserPrompt ?? "")
  ) {
    const readOnly = new Set([
      "search_memory",
      "operations_read",
      "connected_search",
      "crm_read",
      "delivery_read",
      "outreach_read",
      "now",
    ]);
    return tools.filter((tool) => readOnly.has(tool.name));
  }
  return tools;
}

function defaultTools(scope: {
  employeeId: string;
  clientId?: string | null;
  roles?: readonly string[];
  immutableUserPrompt?: string;
}): HarnessTool[] {
  return buildChatDefaultTools(scope);
}

export const chatRouter = router({
  /** Effective LLM provider + default model (no secrets). */
  runtimeLlm: staffProcedure.query(() => runtimeLlmSnapshot()),

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
          ? "Custom-agent tools are descriptive in Chat; effectful execution requires a typed server command."
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      const harnessTools: HarnessTool[] = [
        ...defaultTools({
          employeeId,
          clientId: thread.clientId,
          roles: ctx.roles,
          immutableUserPrompt: input.content,
        }),
      ];
      const steps: Array<Record<string, unknown>> = [];
      const harnessResult =
        input.harness === "direct"
          ? await (async () => {
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
