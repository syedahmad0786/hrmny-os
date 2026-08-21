import { sql } from "@hrmny/db";
import { listDeals, listCompanies, getDeal } from "../crm/repository";
import { listDeliveryTasks } from "../tasks/delivery-tasks";
import { listDeliveryCalendars } from "../tasks/delivery-calendars";
import { listOutreach } from "../leadgen/store";
import { getClientOnboarding } from "../clients/onboarding";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import { searchMemory } from "./memory-db";
import { createN8nAdapter } from "@hrmny/integrations";
import { resolveIntegrationApiKey } from "../integrations/resolve-keys";

export type AgentToolScope = {
  clientId?: string;
  employeeId?: string | null;
  dealId?: string;
  taskId?: string;
};

export type AgentToolResult = {
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

type ResolvedCrmScope = {
  dealId?: string;
  companyId?: string;
};

/**
 * Map a client sandbox to its won deal + company so CRM tools never leak
 * org-wide deals/companies when only clientId is set (delivery board).
 */
async function resolveClientCrmScope(
  clientId: string,
): Promise<ResolvedCrmScope> {
  const db = getDb();
  if (db) {
    const rows = await db.execute<{ dealId: string | null }>(sql`
      select deal_id as "dealId"
      from public.client
      where client_id = ${clientId}::uuid
      limit 1
    `);
    const dealId = rows[0]?.dealId ?? undefined;
    if (!dealId) return {};
    const deal = await getDeal(dealId);
    return {
      dealId,
      companyId: deal?.companyId ?? undefined,
    };
  }
  const client = getDemoStore().clients.get(clientId);
  if (!client?.dealId) return {};
  const deal = await getDeal(client.dealId);
  return {
    dealId: client.dealId,
    companyId: deal?.companyId ?? undefined,
  };
}

function normalizeTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase());
}

/**
 * Execute allowlisted agent tools inside the client/user/deal/task sandbox.
 * Unknown tools are skipped (ok:false) — never escalate privileges.
 */
export async function runAgentTools(input: {
  allowedTools: unknown;
  prompt: string;
  scope: AgentToolScope;
}): Promise<AgentToolResult[]> {
  const allowed = normalizeTools(input.allowedTools);
  if (!allowed.length) return [];

  const results: AgentToolResult[] = [];
  const want = (name: string) =>
    allowed.includes(name) ||
    allowed.includes(name.split(".")[0]!) ||
    allowed.some((a) => a === "*" || a.endsWith(".*") && name.startsWith(a.slice(0, -1)));

  if (want("memory.search") || want("memory")) {
    try {
      const hits = await searchMemory({
        query: input.prompt,
        clientId: input.scope.clientId,
        employeeId: input.scope.clientId
          ? undefined
          : input.scope.employeeId ?? undefined,
        dealId: input.scope.dealId,
        taskId: input.scope.taskId,
        limit: 5,
      });
      results.push({ tool: "memory.search", ok: true, data: hits });
    } catch (err) {
      results.push({
        tool: "memory.search",
        ok: false,
        error: err instanceof Error ? err.message : "memory_failed",
      });
    }
  }

  const clientCrm = input.scope.clientId
    ? await resolveClientCrmScope(input.scope.clientId)
    : {};
  const scopedDealId = input.scope.dealId ?? clientCrm.dealId;
  const scopedCompanyId = clientCrm.companyId;

  if (want("crm.read") || want("crm.deals") || want("crm")) {
    try {
      // Client sandbox without a linked deal: return empty, never org-wide.
      if (input.scope.clientId && !scopedDealId && !scopedCompanyId) {
        results.push({
          tool: "crm.read",
          ok: true,
          data: { dealCount: 0, deals: [], sandbox: "client_unlinked" },
        });
      } else {
        const deals = await listDeals(
          scopedCompanyId ? { companyId: scopedCompanyId } : undefined,
        );
        let scoped = deals;
        if (scopedDealId) {
          scoped = deals.filter((d) => d.dealId === scopedDealId);
        } else if (!scopedCompanyId) {
          scoped = deals.slice(0, 12);
        }
        const deal = scopedDealId ? await getDeal(scopedDealId) : null;
        results.push({
          tool: "crm.read",
          ok: true,
          data: {
            dealCount: scoped.length,
            deals: (deal ? [deal] : scoped).slice(0, 8).map((d) => ({
              dealId: d.dealId,
              companyName: d.companyName,
              stage: d.stage,
              closeOutcome: d.closeOutcome,
            })),
          },
        });
      }
    } catch (err) {
      results.push({
        tool: "crm.read",
        ok: false,
        error: err instanceof Error ? err.message : "crm_failed",
      });
    }
  }

  if (want("crm.companies") || want("crm.read")) {
    try {
      if (input.scope.clientId && !scopedCompanyId) {
        results.push({
          tool: "crm.companies",
          ok: true,
          data: [],
        });
      } else {
        const companies = await listCompanies();
        const filtered = scopedCompanyId
          ? companies.filter((c) => c.companyId === scopedCompanyId)
          : companies.slice(0, 8);
        results.push({
          tool: "crm.companies",
          ok: true,
          data: filtered.map((c) => ({
            companyId: c.companyId,
            name: c.name,
            website: c.website,
          })),
        });
      }
    } catch (err) {
      results.push({
        tool: "crm.companies",
        ok: false,
        error: err instanceof Error ? err.message : "companies_failed",
      });
    }
  }

  if (
    input.scope.clientId &&
    (want("tasks.read") || want("delivery.read") || want("tasks"))
  ) {
    try {
      const tasks = await listDeliveryTasks({ clientId: input.scope.clientId });
      const calendars = await listDeliveryCalendars({
        clientId: input.scope.clientId,
      });
      results.push({
        tool: "delivery.read",
        ok: true,
        data: {
          tasks: tasks.slice(0, 10).map((t) => ({
            taskId: t.taskId,
            status: t.status,
            taskType: t.taskType,
            title: t.title,
          })),
          calendars: calendars.slice(0, 5).map((c) => ({
            calendarId: c.calendarId,
            month: c.month,
            state: c.state,
            shootDate: c.shootDate,
          })),
        },
      });
    } catch (err) {
      results.push({
        tool: "delivery.read",
        ok: false,
        error: err instanceof Error ? err.message : "delivery_failed",
      });
    }
  }

  if (want("outreach.read") || want("outreach") || want("leadgen.outreach")) {
    try {
      const outreachDealId = scopedDealId;
      // Client sandbox without deal: empty outreach (no org-wide leak).
      if (input.scope.clientId && !outreachDealId) {
        results.push({
          tool: "outreach.read",
          ok: true,
          data: { count: 0, items: [], sandbox: "client_unlinked" },
        });
      } else {
      const rows = await listOutreach(
        outreachDealId ? { dealId: outreachDealId } : undefined,
      );
      results.push({
        tool: "outreach.read",
        ok: true,
        data: {
          count: rows.length,
          items: rows.slice(0, 8).map((r) => ({
            id: r.id,
            dealId: r.dealId,
            channel: r.channel,
            state: r.state,
            recipient: r.recipient,
            subject: r.subject,
          })),
        },
      });
      }
    } catch (err) {
      results.push({
        tool: "outreach.read",
        ok: false,
        error: err instanceof Error ? err.message : "outreach_failed",
      });
    }
  }

  if (
    input.scope.clientId &&
    (want("onboarding.read") || want("onboarding") || want("clients.onboarding"))
  ) {
    try {
      const phases = await getClientOnboarding(input.scope.clientId);
      const active = phases.find((p) => p.status === "active");
      results.push({
        tool: "onboarding.read",
        ok: true,
        data: {
          phaseCount: phases.length,
          activePhase: active
            ? {
                phaseIndex: active.phaseIndex,
                name: active.name,
                status: active.status,
              }
            : null,
          phases: phases.map((p) => ({
            phaseIndex: p.phaseIndex,
            name: p.name,
            status: p.status,
            stepsDone: p.steps.filter((s) => s.done).length,
            stepsTotal: p.steps.length,
          })),
        },
      });
    } catch (err) {
      results.push({
        tool: "onboarding.read",
        ok: false,
        error: err instanceof Error ? err.message : "onboarding_failed",
      });
    }
  }

  if (want("n8n.health") || want("n8n") || want("automation.smoke")) {
    try {
      const resolved = await resolveIntegrationApiKey(
        "n8n",
        input.scope.employeeId,
      );
      const n8n = createN8nAdapter(
        resolved.apiKey ? { apiKey: resolved.apiKey } : {},
      );
      const health = await n8n.health();
      results.push({
        tool: "n8n.health",
        ok: health.ok,
        data: {
          mode: health.mode,
          apiKeyConfigured: health.apiKeyConfigured,
          baseUrl: health.baseUrl,
        },
      });
    } catch (err) {
      results.push({
        tool: "n8n.health",
        ok: false,
        error: err instanceof Error ? err.message : "n8n_failed",
      });
    }
  }

  // ── Sandboxed writes (never send email / never escalate outside scope) ──

  if (
    input.scope.clientId &&
    (want("tasks.create") || want("delivery.create") || want("tasks.write"))
  ) {
    try {
      const { createDeliveryTask } = await import("../tasks/delivery-tasks");
      const title =
        input.prompt.trim().slice(0, 120) || "Agent-created delivery task";
      const task = await createDeliveryTask({
        clientId: input.scope.clientId,
        taskType: "social_cutdowns",
        title: `[agent] ${title}`,
        status: "backlog",
        ownerEmployeeId: input.scope.employeeId ?? null,
      });
      results.push({
        tool: "tasks.create",
        ok: Boolean(task?.taskId),
        data: task
          ? {
              taskId: task.taskId,
              clientId: task.clientId,
              status: task.status,
              taskType: task.taskType,
              title: task.title,
            }
          : undefined,
        error: task ? undefined : "task_create_failed",
      });
    } catch (err) {
      results.push({
        tool: "tasks.create",
        ok: false,
        error: err instanceof Error ? err.message : "tasks_create_failed",
      });
    }
  }

  if (
    scopedDealId &&
    (want("outreach.draft") || want("outreach.write") || want("leadgen.draft"))
  ) {
    try {
      const { draftOutreach } = await import("../trpc/leadgen-router");
      const subject = `Agent draft · ${input.prompt.trim().slice(0, 80) || "follow-up"}`;
      const body =
        input.prompt.trim().slice(0, 2000) ||
        "Drafted by agent — human must approve before send.";
      const item = await draftOutreach({
        dealId: scopedDealId,
        channel: "gmail",
        subject,
        body,
      });
      results.push({
        tool: "outreach.draft",
        ok: true,
        data: {
          id: item.id,
          dealId: item.dealId,
          state: item.state,
          subject: item.subject,
        },
      });
    } catch (err) {
      results.push({
        tool: "outreach.draft",
        ok: false,
        error: err instanceof Error ? err.message : "outreach_draft_failed",
      });
    }
  }

  if (want("crm.note") || want("memory.note") || want("memory.write")) {
    try {
      const { persistMemoryChunk } = await import("./memory-db");
      const sourceId =
        input.scope.taskId ??
        scopedDealId ??
        input.scope.clientId ??
        input.scope.employeeId ??
        undefined;
      const saved = await persistMemoryChunk({
        sourceType: "note",
        sourceId: sourceId ?? null,
        content: input.prompt.trim().slice(0, 4000) || "Agent note",
        metadata: {
          kind: "agent.crm_note",
          clientId: input.scope.clientId ?? null,
          dealId: scopedDealId ?? null,
          taskId: input.scope.taskId ?? null,
          employeeId: input.scope.employeeId ?? null,
        },
      });
      results.push({
        tool: "crm.note",
        ok: true,
        data: { id: saved.id, sandbox: input.scope },
      });
    } catch (err) {
      results.push({
        tool: "crm.note",
        ok: false,
        error: err instanceof Error ? err.message : "crm_note_failed",
      });
    }
  }

  return results;
}
