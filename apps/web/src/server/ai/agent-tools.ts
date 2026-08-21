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

  let createdTaskId: string | undefined;

  if (
    input.scope.clientId &&
    (want("tasks.create") || want("delivery.create") || want("tasks.write"))
  ) {
    try {
      const { createDeliveryTask } = await import("../tasks/delivery-tasks");
      const title =
        input.prompt.trim().slice(0, 120) || "Agent-created delivery task";
      let task = await createDeliveryTask({
        clientId: input.scope.clientId,
        taskType: "social_cutdowns",
        title: `[agent] ${title}`,
        status: "backlog",
        ownerEmployeeId: input.scope.employeeId ?? null,
      });
      if (!task) {
        const store = getDemoStore();
        const taskId = crypto.randomUUID();
        const demoTask = {
          taskId,
          clientId: input.scope.clientId,
          calendarId: null as string | null,
          month: null as string | null,
          taskType: "social_cutdowns",
          title: `[agent] ${title}`,
          status: "backlog",
          situationalState: null as string | null,
          ownerEmployeeId: input.scope.employeeId ?? null,
          deadline: null as string | null,
          priority: "medium" as string | null,
          qcPassed: false,
          qcNotes: null as string | null,
          clientRevisionCount: 0,
          revisionBoundaryAck: false,
          briefId: null as string | null,
        };
        store.tasks.set(taskId, demoTask);
        task = demoTask;
      }
      if (task?.taskId) createdTaskId = task.taskId;
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
    input.scope.clientId &&
    (want("campaigns.draft") ||
      want("campaign.create") ||
      want("campaigns.write"))
  ) {
    try {
      const { createCampaignDraft } = await import("../campaigns/repository");
      const title =
        input.prompt.trim().slice(0, 120) || "Agent campaign draft";
      const scheduledFor = new Date().toISOString().slice(0, 10);
      const row = await createCampaignDraft({
        title: `[agent] ${title}`,
        channel: "linkedin",
        scheduledFor,
        clientId: input.scope.clientId,
      });
      results.push({
        tool: "campaigns.draft",
        ok: true,
        data: {
          campaignItemId: row.campaignItemId,
          clientId: row.clientId,
          channel: row.channel,
          status: row.status,
          title: row.title,
        },
      });
    } catch (err) {
      results.push({
        tool: "campaigns.draft",
        ok: false,
        error: err instanceof Error ? err.message : "campaigns_draft_failed",
      });
    }
  }

  const briefTaskId = input.scope.taskId ?? createdTaskId;
  if (
    briefTaskId &&
    (want("briefs.draft") || want("brief.draft") || want("briefs.write"))
  ) {
    try {
      const { validateDor } = await import("@hrmny/gate");
      const { upsertDeliveryBriefForTask } = await import(
        "../tasks/delivery-tasks"
      );
      const snippet = input.prompt.trim().slice(0, 200) || "Agent brief";
      const body: Record<string, unknown> = {
        title: `[agent] ${snippet.slice(0, 80)}`,
        objective: snippet,
        audience: "Target audience (agent draft — refine before lock)",
        deliverables: "Creative deliverables (agent draft)",
        deadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        brandAssets: { logo: true, agentDraft: true },
        channels: ["linkedin"],
        successMetric: "Engagement (agent draft)",
      };
      const dor = validateDor(body);
      const brief = await upsertDeliveryBriefForTask({
        taskId: briefTaskId,
        body,
        dorComplete: dor.dorComplete,
        missingRequiredCount: dor.missingRequiredCount,
      });
      if (brief) {
        results.push({
          tool: "briefs.draft",
          ok: true,
          data: {
            briefId: brief.briefId,
            taskId: brief.taskId,
            dorComplete: brief.dorComplete,
            missingRequiredCount: brief.missingRequiredCount,
            lockedAt: brief.lockedAt,
          },
        });
      } else {
        // Memory / demo path when Postgres brief helpers return null
        const store = getDemoStore();
        const task = store.tasks.get(briefTaskId);
        if (!task) throw new Error("task_not_found_for_brief");
        const briefId = crypto.randomUUID();
        const demoBrief = {
          briefId,
          taskId: briefTaskId,
          body,
          dorComplete: dor.dorComplete,
          missingRequiredCount: dor.missingRequiredCount,
          missing: [...dor.missing],
          lockedAt: null as string | null,
        };
        store.briefs.set(briefId, demoBrief);
        task.briefId = briefId;
        task.status = "briefing";
        results.push({
          tool: "briefs.draft",
          ok: true,
          data: {
            briefId,
            taskId: briefTaskId,
            dorComplete: dor.dorComplete,
            missingRequiredCount: dor.missingRequiredCount,
            lockedAt: null,
            mode: "memory",
          },
        });
      }
    } catch (err) {
      results.push({
        tool: "briefs.draft",
        ok: false,
        error: err instanceof Error ? err.message : "briefs_draft_failed",
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

  if (
    !input.scope.clientId &&
    (want("crm.prospect") ||
      want("apollo.import") ||
      want("prospect.apollo") ||
      want("crm.apollo"))
  ) {
    try {
      const { resolveIntegrationApiKey } = await import(
        "../integrations/resolve-keys"
      );
      const { createApolloLive, createEmailVerificationAdapter } =
        await import("@hrmny/integrations");
      const { importApolloCompaniesToCrm } = await import(
        "../crm/apollo-import"
      );
      const query =
        input.prompt.trim().slice(0, 200) || "UAE retail brands";
      const { apiKey } = await resolveIntegrationApiKey(
        "apollo",
        input.scope.employeeId,
      );
      const hunter = await resolveIntegrationApiKey(
        "hunter",
        input.scope.employeeId,
      );
      const apolloClient = apiKey
        ? createApolloLive({ mode: "live", apiKey })
        : getDemoStore().apollo;
      const mode = apiKey ? ("live" as const) : ("mock" as const);
      const hits = await apolloClient.searchCompanies(query);
      const imported = await importApolloCompaniesToCrm({
        query,
        companies: hits as Record<string, unknown>[],
        mode,
        ownerEmployeeId: input.scope.employeeId,
        limit: 3,
        verifier: createEmailVerificationAdapter(
          hunter.apiKey
            ? { mode: "live", apiKey: hunter.apiKey }
            : { mode: "mock" },
        ),
      });
      results.push({
        tool: "crm.prospect",
        ok: true,
        data: {
          mode: imported.mode,
          verifyMode: imported.verifyMode,
          query: imported.query,
          dealCount: imported.deals.length,
          deals: imported.deals.slice(0, 3).map((d) => ({
            dealId: d.dealId,
            companyName: d.companyName,
            stage: d.stage,
            emailVerified: d.emailVerified,
          })),
        },
      });
    } catch (err) {
      results.push({
        tool: "crm.prospect",
        ok: false,
        error: err instanceof Error ? err.message : "crm_prospect_failed",
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
