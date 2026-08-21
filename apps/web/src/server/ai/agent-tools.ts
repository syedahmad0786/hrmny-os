import { listDeals, listCompanies, getDeal } from "../crm/repository";
import { listDeliveryTasks } from "../tasks/delivery-tasks";
import { listDeliveryCalendars } from "../tasks/delivery-calendars";
import { listOutreach } from "../leadgen/store";
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

  if (want("crm.read") || want("crm.deals") || want("crm")) {
    try {
      const deals = await listDeals();
      const scoped = input.scope.dealId
        ? deals.filter((d) => d.dealId === input.scope.dealId)
        : deals.slice(0, 12);
      const deal = input.scope.dealId
        ? await getDeal(input.scope.dealId)
        : null;
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
      const companies = await listCompanies();
      results.push({
        tool: "crm.companies",
        ok: true,
        data: companies.slice(0, 8).map((c) => ({
          companyId: c.companyId,
          name: c.name,
          website: c.website,
        })),
      });
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
      const rows = await listOutreach(
        input.scope.dealId ? { dealId: input.scope.dealId } : undefined,
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
    } catch (err) {
      results.push({
        tool: "outreach.read",
        ok: false,
        error: err instanceof Error ? err.message : "outreach_failed",
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

  return results;
}
