import { sql } from "@hrmny/db";
import { listDeals, listCompanies, getDeal } from "../crm/repository";
import { listDeliveryTasks } from "../tasks/delivery-tasks";
import { listDeliveryCalendars } from "../tasks/delivery-calendars";
import { listOutreach } from "../leadgen/store";
import { getClientOnboarding } from "../clients/onboarding";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import { searchMemory } from "./memory-db";

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

/** Default allowlist for custom agents / on-command runs when vault row is empty. */
export const DEFAULT_FUNNEL_AGENT_TOOLS = [
  "memory.search",
  "crm.read",
  "delivery.read",
  "outreach.read",
  "onboarding.read",
  "n8n.health",
  "tasks.create",
  "outreach.draft",
  "crm.note",
  "campaigns.draft",
  "briefs.draft",
  "crm.prospect",
  "portal.invite",
  "creative.sendToPortal",
] as const;

/**
 * Demo / Settings preset for org-only OS settle tools (closed loop → finance →
 * outreach → creative QC → portal → campaigns). Never used as empty-allowlist
 * fallback — that stays funnel-only. Prompt gates still apply per tool.
 */
export const DEFAULT_DEMO_OS_SETTLE_AGENT_TOOLS = [
  "memory.search",
  "crm.read",
  "delivery.read",
  "outreach.read",
  "onboarding.read",
  "crm.closed_loop",
  "finance.os_approve",
  "finance.os_issue",
  "outreach.os_approve",
  "briefs.os_lock",
  "creative.os_qc",
  "campaigns.os_approve",
  "campaigns.os_publish",
  "portal.os_approve",
  "onboarding.os_signoff",
  "calendar.os_ref_approve",
  "clients.os_month1_advance",
] as const;

export type AgentToolPreset = "funnel" | "demo_os_settle";

/** Resolve create-time toolPreset to an allowlist (explicit allowedTools wins). */
export function resolveAgentToolPreset(
  preset: AgentToolPreset | undefined,
): readonly string[] {
  if (preset === "demo_os_settle") return DEFAULT_DEMO_OS_SETTLE_AGENT_TOOLS;
  return DEFAULT_FUNNEL_AGENT_TOOLS;
}

/** Empty or invalid allowlists fall back to the funnel defaults. */
export function resolveAgentAllowedTools(raw: unknown): string[] {
  const normalize = (tools: readonly string[]) =>
    tools.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
  if (!Array.isArray(raw)) return normalize(DEFAULT_FUNNEL_AGENT_TOOLS);
  const cleaned = normalize(
    raw.filter((t): t is string => typeof t === "string"),
  );
  return cleaned.length > 0 ? cleaned : normalize(DEFAULT_FUNNEL_AGENT_TOOLS);
}

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

/**
 * Execute allowlisted agent tools inside the client/user/deal/task sandbox.
 * Unknown tools are skipped (ok:false) — never escalate privileges.
 */
export async function runAgentTools(input: {
  allowedTools: unknown;
  prompt: string;
  scope: AgentToolScope;
}): Promise<AgentToolResult[]> {
  const allowed = resolveAgentAllowedTools(input.allowedTools);
  if (!allowed.length) return [];

  const results: AgentToolResult[] = [];
  const want = (name: string) => {
    const key = name.toLowerCase();
    return (
      allowed.includes(key) ||
      allowed.includes(key.split(".")[0]!) ||
      allowed.some(
        (a) =>
          a === "*" || (a.endsWith(".*") && key.startsWith(a.slice(0, -1))),
      )
    );
  };

  if (want("memory.search") || want("memory")) {
    try {
      const hits = await searchMemory({
        query: input.prompt,
        clientId: input.scope.clientId,
        employeeId: input.scope.clientId
          ? undefined
          : (input.scope.employeeId ?? undefined),
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
    (want("onboarding.read") ||
      want("onboarding") ||
      want("clients.onboarding"))
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
      const { createResolvedN8nAdapter } =
        await import("../integrations/n8n-adapter");
      const n8n = await createResolvedN8nAdapter(input.scope.employeeId);
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
              next: {
                delivery: `/delivery?clientId=${encodeURIComponent(task.clientId)}&taskId=${encodeURIComponent(task.taskId)}`,
                creative: `/creative?clientId=${encodeURIComponent(task.clientId)}&taskId=${encodeURIComponent(task.taskId)}`,
                traffic: `/traffic?clientId=${encodeURIComponent(task.clientId)}`,
              },
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
      const title = input.prompt.trim().slice(0, 120) || "Agent campaign draft";
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
          next: {
            creative: `/creative?clientId=${encodeURIComponent(row.clientId ?? input.scope.clientId!)}`,
            delivery: `/delivery?clientId=${encodeURIComponent(row.clientId ?? input.scope.clientId!)}`,
          },
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
      const { upsertDeliveryBriefForTask } =
        await import("../tasks/delivery-tasks");
      const snippet = input.prompt.trim().slice(0, 200) || "Agent brief";
      const body: Record<string, unknown> = {
        title: `[agent] ${snippet.slice(0, 80)}`,
        objective: snippet,
        audience: "Target audience (agent draft — refine before lock)",
        deliverables: "Creative deliverables (agent draft)",
        deadline: new Date(Date.now() + 14 * 86400000)
          .toISOString()
          .slice(0, 10),
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
            next: {
              traffic: input.scope.clientId
                ? `/traffic?clientId=${encodeURIComponent(input.scope.clientId)}&taskId=${encodeURIComponent(brief.taskId)}`
                : `/traffic?taskId=${encodeURIComponent(brief.taskId)}`,
              delivery: input.scope.clientId
                ? `/delivery?clientId=${encodeURIComponent(input.scope.clientId)}&taskId=${encodeURIComponent(brief.taskId)}`
                : `/delivery?taskId=${encodeURIComponent(brief.taskId)}`,
            },
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
            next: {
              traffic: input.scope.clientId
                ? `/traffic?clientId=${encodeURIComponent(input.scope.clientId)}&taskId=${encodeURIComponent(briefTaskId)}`
                : `/traffic?taskId=${encodeURIComponent(briefTaskId)}`,
              delivery: input.scope.clientId
                ? `/delivery?clientId=${encodeURIComponent(input.scope.clientId)}&taskId=${encodeURIComponent(briefTaskId)}`
                : `/delivery?taskId=${encodeURIComponent(briefTaskId)}`,
            },
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
          next: {
            deal: `/crm/deals/${encodeURIComponent(item.dealId)}`,
            approvals: `/approvals?id=${encodeURIComponent(item.id)}`,
            outreach: `/crm/outreach?id=${encodeURIComponent(item.id)}`,
          },
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

  /**
   * Org-wide prospect → won → handover → onboarding. Runs BEFORE settle tools
   * so one-shot OS settle can chain IDs from the loop. Prompt-gated; never in
   * DEFAULT_FUNNEL_AGENT_TOOLS.
   */
  const wantsClosedLoop =
    !input.scope.clientId &&
    (want("crm.closed_loop") ||
      want("crm.runDemoClosedLoop") ||
      want("funnel.closed_loop")) &&
    /closed\s*loop|runDemoClosedLoop|won\s*handover|prospect\s*(?:→|->|to)\s*won/i.test(
      input.prompt,
    );

  const loopSeed: {
    invoiceId?: string;
    outreachId?: string;
    taskId?: string;
    campaignItemId?: string;
    clientId?: string;
    calendarId?: string;
  } = {};

  if (wantsClosedLoop) {
    try {
      const { runDemoClosedLoopCore } = await import("../crm/closed-loop");
      const viaApollo =
        /via\s*apollo|closed\s*loop[^\n]{0,40}apollo|apollo[^\n]{0,40}closed\s*loop/i.test(
          input.prompt,
        );
      const companyMatch = input.prompt.match(
        /(?:company|for)\s*[:=]\s*["']?([A-Za-z0-9 .&'-]{2,80}?)["']?(?:\s|$|,|\.|via)/i,
      );
      const loop = await runDemoClosedLoopCore({
        companyName: companyMatch?.[1]?.trim(),
        viaApollo,
        actorEmployeeId: input.scope.employeeId,
      });
      if (!loop.ok) {
        results.push({
          tool: "crm.closed_loop",
          ok: false,
          error: `${loop.step}: ${loop.reason}`,
          data: loop,
        });
      } else {
        if (loop.invoiceId) loopSeed.invoiceId = loop.invoiceId;
        if (loop.outreachId) loopSeed.outreachId = loop.outreachId;
        if (loop.taskId) loopSeed.taskId = loop.taskId;
        if (loop.campaignItemId) loopSeed.campaignItemId = loop.campaignItemId;
        if (loop.clientId) loopSeed.clientId = loop.clientId;
        if (loop.calendarId) loopSeed.calendarId = loop.calendarId;
        results.push({
          tool: "crm.closed_loop",
          ok: true,
          data: {
            clientId: loop.clientId,
            clientName: loop.clientName,
            dealId: loop.dealId,
            companyId: loop.companyId,
            taskId: loop.taskId,
            calendarId: loop.calendarId,
            outreachId: loop.outreachId,
            invoiceId: loop.invoiceId,
            campaignItemId: loop.campaignItemId,
            onboardingPhases: loop.onboardingPhases,
            viaApollo: loop.viaApollo,
            apolloMode: loop.apolloMode,
            portalInvite: loop.portalInvite,
            next: loop.next,
            fired: loop.fired,
          },
        });
      }
    } catch (err) {
      results.push({
        tool: "crm.closed_loop",
        ok: false,
        error: err instanceof Error ? err.message : "crm_closed_loop_failed",
      });
    }
  }

  /**
   * OS finance approve/issue (propose → approve → issue). Prompt-gated;
   * never in DEFAULT_FUNNEL_AGENT_TOOLS. Org-only (no client sandbox).
   * Issue is OS-only when Xero write is disabled. Accepts IDs from prompt or
   * from crm.closed_loop seed in the same run (one-shot settle).
   */
  const wantsFinanceApprove =
    !input.scope.clientId &&
    (want("finance.os_approve") ||
      want("finance.approve") ||
      want("invoices.approve")) &&
    /(?:finance\s+approve|os[_\s-]?approve|approve\s+(?:and\s+issue\b|(?:the\s+)?(?:os\s+)?invoice)|invoice[^\n]{0,40}approv)/i.test(
      input.prompt,
    );

  const wantsFinanceIssue =
    !input.scope.clientId &&
    (want("finance.os_issue") ||
      want("finance.issue") ||
      want("invoices.issue")) &&
    /(?:finance\s+issue|approve\s+and\s+issue|os[_\s-]?issue|issue\s+(?:the\s+)?(?:os\s+)?invoice|invoice[^\n]{0,40}issue|mark\s+issued)/i.test(
      input.prompt,
    );

  if (wantsFinanceApprove || wantsFinanceIssue) {
    const { approveOsInvoice, issueOsInvoice, parseInvoiceIdFromPrompt } =
      await import("../finance/os-invoice-actions");
    const invoiceId =
      parseInvoiceIdFromPrompt(input.prompt) ?? loopSeed.invoiceId ?? null;
    const employeeId =
      input.scope.employeeId ?? "c0000000-0000-4000-8000-000000000001";

    if (wantsFinanceApprove) {
      if (!invoiceId) {
        results.push({
          tool: "finance.os_approve",
          ok: false,
          error: "invoiceId_required",
        });
      } else {
        try {
          const out = await approveOsInvoice({
            invoiceId,
            actor: { employeeId },
          });
          results.push({
            tool: "finance.os_approve",
            ok: out.ok,
            error: out.ok ? undefined : out.reason,
            data: out.invoice
              ? {
                  invoiceId: out.invoice.invoiceId,
                  status: out.invoice.status,
                  contactName: out.invoice.contactName,
                  amount: out.invoice.amount,
                  next: {
                    finance: `/finance?invoiceId=${encodeURIComponent(out.invoice.invoiceId)}`,
                  },
                }
              : { invoiceId },
          });
        } catch (err) {
          results.push({
            tool: "finance.os_approve",
            ok: false,
            error:
              err instanceof Error ? err.message : "finance_os_approve_failed",
          });
        }
      }
    }

    if (wantsFinanceIssue) {
      if (!invoiceId) {
        results.push({
          tool: "finance.os_issue",
          ok: false,
          error: "invoiceId_required",
        });
      } else {
        try {
          const out = await issueOsInvoice({
            invoiceId,
            actor: { employeeId },
          });
          results.push({
            tool: "finance.os_issue",
            ok: out.ok,
            error: out.ok ? undefined : out.reason,
            data: out.invoice
              ? {
                  invoiceId: out.invoice.invoiceId,
                  status: out.invoice.status,
                  contactName: out.invoice.contactName,
                  amount: out.invoice.amount,
                  xeroWrite: out.xeroWrite ?? false,
                  xeroInvoiceId: out.invoice.xeroInvoiceId,
                  next: {
                    finance: `/finance?invoiceId=${encodeURIComponent(out.invoice.invoiceId)}`,
                  },
                }
              : { invoiceId },
          });
        } catch (err) {
          results.push({
            tool: "finance.os_issue",
            ok: false,
            error:
              err instanceof Error ? err.message : "finance_os_issue_failed",
          });
        }
      }
    }
  }

  /**
   * OS outreach approve (draft → approved). Prompt-gated; never sends.
   * Org-only. Never in DEFAULT_FUNNEL_AGENT_TOOLS.
   */
  const wantsOutreachApprove =
    !input.scope.clientId &&
    (want("outreach.os_approve") ||
      want("outreach.approve") ||
      want("leadgen.approve")) &&
    /(?:os[_\s-]?approve|approve\s+(?:the\s+)?(?:os\s+)?outreach|outreach[^\n]{0,40}approv|approve\s+hitl)/i.test(
      input.prompt,
    );

  if (wantsOutreachApprove) {
    const { approveOsOutreach, parseOutreachIdFromPrompt } =
      await import("../leadgen/os-outreach-actions");
    const outreachId =
      parseOutreachIdFromPrompt(input.prompt) ?? loopSeed.outreachId ?? null;
    const employeeId =
      input.scope.employeeId ?? "c0000000-0000-4000-8000-000000000001";
    if (!outreachId) {
      results.push({
        tool: "outreach.os_approve",
        ok: false,
        error: "outreachId_required",
      });
    } else {
      try {
        const out = await approveOsOutreach({
          outreachId,
          actor: { employeeId },
        });
        results.push({
          tool: "outreach.os_approve",
          ok: out.ok,
          error: out.ok ? undefined : out.reason,
          data: out.outreach
            ? {
                id: out.outreach.id,
                state: out.outreach.state,
                dealId: out.outreach.dealId,
                subject: out.outreach.subject,
                next: {
                  approvals: `/approvals?id=${encodeURIComponent(out.outreach.id)}`,
                  outreach: `/crm/outreach?id=${encodeURIComponent(out.outreach.id)}`,
                },
              }
            : { id: outreachId },
        });
      } catch (err) {
        results.push({
          tool: "outreach.os_approve",
          ok: false,
          error:
            err instanceof Error ? err.message : "outreach_os_approve_failed",
        });
      }
    }
  }

  /**
   * Lock a DoR-ready brief and spawn creative_spawn. Prompt-gated.
   * Allowed in client sandbox or org scope. Never in DEFAULT_FUNNEL_AGENT_TOOLS.
   * No Canva required — Traffic → Creative handoff on command.
   */
  const wantsBriefLock =
    (want("briefs.os_lock") ||
      want("brief.os_lock") ||
      want("briefs.lock") ||
      want("traffic.lock_brief")) &&
    /(?:lock\s+(?:the\s+)?(?:dor\s+)?brief|brief\s+lock|os[_\s-]?lock(?:\s+brief)?|lock\s+dor)/i.test(
      input.prompt,
    );

  if (wantsBriefLock) {
    try {
      const { runOsBriefLock } = await import("../tasks/os-brief-lock");
      const out = await runOsBriefLock({
        prompt: input.prompt,
        actorEmployeeId:
          input.scope.employeeId ?? "c0000000-0000-4000-8000-000000000001",
        taskId: input.scope.taskId ?? loopSeed.taskId ?? null,
        clientId: input.scope.clientId ?? null,
      });
      const clientId = out.clientId;
      const spawnId = out.spawnedTaskId;
      results.push({
        tool: "briefs.os_lock",
        ok: out.ok,
        error: out.ok ? undefined : out.reason,
        data: out.ok
          ? {
              briefId: out.briefId,
              taskId: out.taskId,
              clientId,
              taskStatus: out.taskStatus,
              spawnedTaskId: spawnId,
              reuse: out.reuse ?? false,
              seamEventId: out.seamEventId ?? null,
              next: clientId
                ? {
                    traffic: `/traffic?clientId=${encodeURIComponent(clientId)}${
                      out.taskId
                        ? `&taskId=${encodeURIComponent(out.taskId)}`
                        : ""
                    }`,
                    creative: spawnId
                      ? `/creative?clientId=${encodeURIComponent(clientId)}&taskId=${encodeURIComponent(spawnId)}`
                      : `/creative?clientId=${encodeURIComponent(clientId)}`,
                    delivery: `/delivery?clientId=${encodeURIComponent(clientId)}`,
                  }
                : undefined,
            }
          : {
              briefId: out.briefId,
              code: out.code,
            },
      });
    } catch (err) {
      results.push({
        tool: "briefs.os_lock",
        ok: false,
        error: err instanceof Error ? err.message : "briefs_os_lock_failed",
      });
    }
  }

  /**
   * Creative QC pass/fail/waive on a delivery task. Prompt-gated; org-only.
   * Never in DEFAULT_FUNNEL_AGENT_TOOLS. No live Canva required.
   */
  const wantsCreativeQc =
    !input.scope.clientId &&
    (want("creative.os_qc") || want("creative.qc") || want("tasks.qc")) &&
    /(?:pass\s+(?:qc|quality)|qc\s+pass|creative\s+qc|os[_\s-]?qc|waive\s+qc|fail\s+qc)/i.test(
      input.prompt,
    );

  if (wantsCreativeQc) {
    const { runOsCreativeQc, parseTaskIdFromPrompt } =
      await import("../tasks/os-creative-qc");
    const taskId =
      parseTaskIdFromPrompt(input.prompt) ??
      input.scope.taskId ??
      loopSeed.taskId ??
      null;
    const employeeId =
      input.scope.employeeId ?? "c0000000-0000-4000-8000-000000000001";
    if (!taskId) {
      results.push({
        tool: "creative.os_qc",
        ok: false,
        error: "taskId_required",
      });
    } else {
      try {
        const out = await runOsCreativeQc({
          taskId,
          prompt: input.prompt,
          actorEmployeeId: employeeId,
        });
        results.push({
          tool: "creative.os_qc",
          ok: out.ok,
          error: out.ok ? undefined : out.reason,
          data: out.task
            ? {
                taskId: out.task.taskId,
                clientId: out.task.clientId,
                status: out.task.status,
                qcPassed: out.task.qcPassed,
                qcNotes: out.task.qcNotes,
                title: out.task.title,
                seamEventId: out.seamEventId ?? null,
                advanced: out.advanced ?? false,
                next: {
                  creative: `/creative?clientId=${encodeURIComponent(out.task.clientId)}&taskId=${encodeURIComponent(out.task.taskId)}`,
                  portal: `/portal/approvals`,
                },
              }
            : { taskId },
        });
      } catch (err) {
        results.push({
          tool: "creative.os_qc",
          ok: false,
          error: err instanceof Error ? err.message : "creative_os_qc_failed",
        });
      }
    }
  }

  /**
   * Campaign draft → approved / approved → published (stub). Prompt-gated;
   * org-only. Never in DEFAULT_FUNNEL_AGENT_TOOLS. Stub publish needs no LI.
   */
  const wantsCampaignApprove =
    !input.scope.clientId &&
    (want("campaigns.os_approve") ||
      want("campaign.os_approve") ||
      want("campaigns.approve")) &&
    /(?:os[_\s-]?approve|approve\s+(?:the\s+)?(?:os\s+)?campaign|campaign[^\n]{0,40}approv)/i.test(
      input.prompt,
    );

  const wantsCampaignPublish =
    !input.scope.clientId &&
    (want("campaigns.os_publish") ||
      want("campaign.os_publish") ||
      want("campaigns.publish")) &&
    /(?:os[_\s-]?publish|publish\s+(?:the\s+)?(?:os\s+)?campaign|campaign[^\n]{0,40}publish|stub\s+publish)/i.test(
      input.prompt,
    );

  if (wantsCampaignApprove || wantsCampaignPublish) {
    const { approveOsCampaign, publishOsCampaign, parseCampaignIdFromPrompt } =
      await import("../campaigns/os-campaign-actions");
    const campaignItemId =
      parseCampaignIdFromPrompt(input.prompt) ??
      loopSeed.campaignItemId ??
      null;
    const employeeId =
      input.scope.employeeId ?? "c0000000-0000-4000-8000-000000000001";

    if (wantsCampaignApprove) {
      if (!campaignItemId) {
        results.push({
          tool: "campaigns.os_approve",
          ok: false,
          error: "campaignItemId_required",
        });
      } else {
        try {
          const out = await approveOsCampaign({
            campaignItemId,
            actor: { employeeId },
          });
          results.push({
            tool: "campaigns.os_approve",
            ok: out.ok,
            error: out.ok ? undefined : out.reason,
            data: out.campaign
              ? {
                  campaignItemId: out.campaign.campaignItemId,
                  status: out.campaign.status,
                  title: out.campaign.title,
                  channel: out.campaign.channel,
                  next: {
                    campaigns: `/approvals?id=${encodeURIComponent(out.campaign.campaignItemId)}`,
                  },
                }
              : { campaignItemId },
          });
        } catch (err) {
          results.push({
            tool: "campaigns.os_approve",
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "campaigns_os_approve_failed",
          });
        }
      }
    }

    if (wantsCampaignPublish) {
      if (!campaignItemId) {
        results.push({
          tool: "campaigns.os_publish",
          ok: false,
          error: "campaignItemId_required",
        });
      } else {
        try {
          const out = await publishOsCampaign({
            campaignItemId,
            actor: { employeeId },
          });
          results.push({
            tool: "campaigns.os_publish",
            ok: out.ok,
            error: out.ok ? undefined : out.reason,
            data: out.campaign
              ? {
                  campaignItemId: out.campaign.campaignItemId,
                  status: out.campaign.status,
                  title: out.campaign.title,
                  channel: out.campaign.channel,
                  publishMode: out.campaign.publishMode ?? "stub",
                  next: {
                    campaigns: `/approvals?id=${encodeURIComponent(out.campaign.campaignItemId)}`,
                  },
                }
              : { campaignItemId },
          });
        } catch (err) {
          results.push({
            tool: "campaigns.os_publish",
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "campaigns_os_publish_failed",
          });
        }
      }
    }
  }

  /**
   * Portal client approve/reject on a client_review task. Prompt-gated;
   * org-only. Completes creative.os_qc → portal path without magic links.
   */
  const wantsPortalApprove =
    !input.scope.clientId &&
    (want("portal.os_approve") ||
      want("portal.approve") ||
      want("portal.approvals")) &&
    /(?:os[_\s-]?approve|approve\s+(?:the\s+)?(?:os\s+)?portal|portal[^\n]{0,40}approv|client[_\s-]?approv|reject\s+(?:the\s+)?portal)/i.test(
      input.prompt,
    );

  if (wantsPortalApprove) {
    const { runOsPortalApprove, parseApprovalIdFromPrompt } =
      await import("../portal/os-portal-approve");
    const approvalId =
      parseApprovalIdFromPrompt(input.prompt) ??
      input.scope.taskId ??
      loopSeed.taskId ??
      null;
    const employeeId =
      input.scope.employeeId ?? "c0000000-0000-4000-8000-000000000001";
    if (!approvalId) {
      results.push({
        tool: "portal.os_approve",
        ok: false,
        error: "approvalId_required",
      });
    } else {
      try {
        const out = await runOsPortalApprove({
          approvalId,
          prompt: input.prompt,
          actorEmployeeId: employeeId,
        });
        results.push({
          tool: "portal.os_approve",
          ok: out.ok,
          error: out.ok ? undefined : out.reason,
          data: {
            approvalId: out.approvalId ?? approvalId,
            clientId: out.clientId,
            status: out.status,
            action: out.action,
            next: out.clientId
              ? {
                  portal: `/portal/approvals`,
                  creative: `/creative?clientId=${encodeURIComponent(out.clientId)}`,
                }
              : undefined,
          },
        });
      } catch (err) {
        results.push({
          tool: "portal.os_approve",
          ok: false,
          error:
            err instanceof Error ? err.message : "portal_os_approve_failed",
        });
      }
    }
  }

  /**
   * Onboarding phase signoff (active → signed_off). Org-only; prompt-gated.
   * Seeds clientId from closed_loop when present. Default phaseIndex = 0.
   */
  const wantsOnboardingSignoff =
    !input.scope.clientId &&
    (want("onboarding.os_signoff") ||
      want("onboarding.signoff") ||
      want("clients.signoff")) &&
    /(?:onboarding\s+sign\s*off|sign\s*off\s+(?:onboarding\s+)?phase|os[_\s-]?signoff|phase\s+sign\s*off)/i.test(
      input.prompt,
    );

  if (wantsOnboardingSignoff) {
    const {
      signoffOsOnboardingPhase,
      parseClientIdFromPrompt,
      parsePhaseIndexFromPrompt,
    } = await import("../clients/os-onboarding-signoff");
    const clientId =
      parseClientIdFromPrompt(input.prompt) ?? loopSeed.clientId ?? null;
    const phaseIndex = parsePhaseIndexFromPrompt(input.prompt) ?? 0;
    const employeeId =
      input.scope.employeeId ?? "c0000000-0000-4000-8000-000000000001";
    if (!clientId) {
      results.push({
        tool: "onboarding.os_signoff",
        ok: false,
        error: "clientId_required",
      });
    } else {
      try {
        const out = await signoffOsOnboardingPhase({
          clientId,
          phaseIndex,
          actorEmployeeId: employeeId,
        });
        results.push({
          tool: "onboarding.os_signoff",
          ok: out.ok,
          error: out.ok ? undefined : out.reason,
          data: {
            clientId: out.clientId,
            phaseIndex: out.phaseIndex,
            advanced: out.advanced,
            phaseName: out.phaseName,
            nextPhaseName: out.nextPhaseName,
            next: {
              client: `/clients/${encodeURIComponent(out.clientId)}`,
              onboarding: `/clients/${encodeURIComponent(out.clientId)}`,
            },
          },
        });
      } catch (err) {
        results.push({
          tool: "onboarding.os_signoff",
          ok: false,
          error:
            err instanceof Error ? err.message : "onboarding_os_signoff_failed",
        });
      }
    }
  }

  /**
   * Month-1 phase advance (active → done, next → active). Org-only; prompt-gated.
   * Seeds clientId from closed_loop when present. Complements onboarding.os_signoff
   * (Account Month-1 board is a separate memory map; durable path shares onboarding).
   */
  const wantsMonth1Advance =
    !input.scope.clientId &&
    (want("clients.os_month1_advance") ||
      want("month1.advance") ||
      want("clients.month1")) &&
    /(?:month[_\s-]?1|month1)\s*(?:advance|phase)|advance\s+(?:month[_\s-]?1|month1)|os[_\s-]?month1/i.test(
      input.prompt,
    );

  if (wantsMonth1Advance) {
    const {
      advanceOsMonth1,
      parseClientIdFromPrompt,
      parsePhaseIndexFromPrompt,
    } = await import("../clients/os-month1-advance");
    const { getDb } = await import("../db");
    const clientId =
      parseClientIdFromPrompt(input.prompt) ?? loopSeed.clientId ?? null;
    const toPhaseRaw = parsePhaseIndexFromPrompt(input.prompt);
    const employeeId =
      input.scope.employeeId ?? "c0000000-0000-4000-8000-000000000001";
    if (!clientId) {
      results.push({
        tool: "clients.os_month1_advance",
        ok: false,
        error: "clientId_required",
      });
    } else if (
      getDb() &&
      results.some((r) => r.tool === "onboarding.os_signoff" && r.ok)
    ) {
      // Durable Account month1 is the onboarding map — skip second advance.
      results.push({
        tool: "clients.os_month1_advance",
        ok: true,
        data: {
          clientId,
          skipped: "onboarding_already_signed",
          next: {
            account: `/account?clientId=${encodeURIComponent(clientId)}`,
          },
        },
      });
    } else {
      try {
        const out = await advanceOsMonth1({
          clientId,
          toPhase: toPhaseRaw ?? undefined,
          actorEmployeeId: employeeId,
        });
        results.push({
          tool: "clients.os_month1_advance",
          ok: out.ok,
          error: out.ok ? undefined : (out.reason ?? out.code),
          data: {
            clientId: out.clientId,
            fromPhase: out.fromPhase,
            toPhase: out.toPhase,
            phases: out.phases,
            next: {
              account: `/account?clientId=${encodeURIComponent(out.clientId)}`,
            },
          },
        });
      } catch (err) {
        results.push({
          tool: "clients.os_month1_advance",
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "clients_os_month1_advance_failed",
        });
      }
    }
  }

  /**
   * Calendar ref-approve → ref_approved. Org-only; prompt-gated.
   * Uses closed_loop calendarId seed when present (memory now seeds calendars).
   */
  const wantsCalendarRefApprove =
    !input.scope.clientId &&
    (want("calendar.os_ref_approve") ||
      want("calendars.ref_approve") ||
      want("calendar.refApprove")) &&
    /(?:ref[_\s-]?approv|calendar\s+ref|os[_\s-]?ref[_\s-]?approv)/i.test(
      input.prompt,
    );

  if (wantsCalendarRefApprove) {
    const { refApproveOsCalendar, parseCalendarIdFromPrompt } =
      await import("../tasks/os-calendar-ref-approve");
    const calendarId =
      parseCalendarIdFromPrompt(input.prompt) ?? loopSeed.calendarId ?? null;
    const employeeId =
      input.scope.employeeId ?? "c0000000-0000-4000-8000-000000000001";
    if (!calendarId) {
      results.push({
        tool: "calendar.os_ref_approve",
        ok: false,
        error: "calendarId_required",
      });
    } else {
      try {
        const out = await refApproveOsCalendar({
          calendarId,
          actorEmployeeId: employeeId,
        });
        results.push({
          tool: "calendar.os_ref_approve",
          ok: out.ok,
          error: out.ok ? undefined : out.reason,
          data: out.calendar
            ? {
                calendarId: out.calendar.calendarId,
                clientId: out.calendar.clientId,
                state: out.calendar.state,
                refApprovalState: out.calendar.refApprovalState,
                next: {
                  account: `/account?clientId=${encodeURIComponent(out.calendar.clientId)}`,
                },
              }
            : { calendarId },
        });
      } catch (err) {
        results.push({
          tool: "calendar.os_ref_approve",
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "calendar_os_ref_approve_failed",
        });
      }
    }
  }

  /**
   * Org-wide closed loop already ran above (before settle tools) when gated.
   * crm.prospect is the lighter org import path when closed_loop did not fire.
   */
  if (
    !wantsClosedLoop &&
    !input.scope.clientId &&
    (want("crm.prospect") ||
      want("apollo.import") ||
      want("prospect.apollo") ||
      want("crm.apollo"))
  ) {
    try {
      const {
        resolveApolloRuntimeConfig,
        resolveEmailVerificationRuntimeConfig,
      } = await import("../integrations/runtime-adapters");
      const { createApolloAdapter, createEmailVerificationAdapter } =
        await import("@hrmny/integrations");
      const { importApolloCompaniesToCrm } =
        await import("../crm/apollo-import");
      const query = input.prompt.trim().slice(0, 200) || "UAE retail brands";
      const apollo = await resolveApolloRuntimeConfig(input.scope.employeeId);
      const verifier = await resolveEmailVerificationRuntimeConfig(
        input.scope.employeeId,
      );
      const apolloClient = createApolloAdapter(apollo.config);
      const mode = apollo.mode;
      const hits = await apolloClient.searchCompanies(query);
      const imported = await importApolloCompaniesToCrm({
        query,
        companies: hits as Record<string, unknown>[],
        mode,
        ownerEmployeeId: input.scope.employeeId,
        limit: 3,
        verifier: createEmailVerificationAdapter(verifier.config),
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
          next: imported.deals[0]
            ? {
                deal: `/crm/deals/${encodeURIComponent(imported.deals[0].dealId)}`,
                hunt: "/crm/hunt",
              }
            : { hunt: "/crm/hunt" },
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

  if (
    input.scope.clientId &&
    (want("portal.invite") ||
      want("portal.magic_link") ||
      want("onboarding.invite"))
  ) {
    try {
      const { sendPortalInviteMagicLink } =
        await import("../auth/portal-magic-link");
      const { createResendMock } = await import("@hrmny/integrations");
      const emailMatch = input.prompt.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      );
      const email =
        emailMatch?.[0]?.toLowerCase() ??
        `portal+${input.scope.clientId.slice(0, 8)}@example.com`;
      const placeholderInbox = email.endsWith("@example.com");
      const emailer = placeholderInbox ? createResendMock() : undefined;
      const sent = await sendPortalInviteMagicLink({
        clientId: input.scope.clientId,
        email,
        displayName: "Agent portal invite",
        next: "/portal/approvals",
        emailer,
      });
      const sentOnboarding = await sendPortalInviteMagicLink({
        clientId: input.scope.clientId,
        email,
        displayName: "Agent portal invite",
        next: "/portal/onboarding",
        emailer,
      });
      results.push({
        tool: "portal.invite",
        ok: true,
        data: {
          email: sent.email,
          clientId: sent.clientId,
          portalPath: sent.portalPath,
          onboardingPath: sentOnboarding.portalPath,
          deliveryMode: sent.delivery.mode,
          deliveryId: sent.delivery.id,
          portalInvite: {
            portalPath: sent.portalPath,
            onboardingPath: sentOnboarding.portalPath,
          },
          next: {
            portal: sent.portalPath,
            onboarding: sentOnboarding.portalPath,
            client: `/clients/${encodeURIComponent(sent.clientId)}`,
          },
        },
      });
    } catch (err) {
      results.push({
        tool: "portal.invite",
        ok: false,
        error: err instanceof Error ? err.message : "portal_invite_failed",
      });
    }
  }

  if (
    input.scope.clientId &&
    (want("creative.sendToPortal") ||
      want("creative.portal") ||
      want("portal.deliverable"))
  ) {
    try {
      const title =
        `[agent] ${input.prompt.trim().slice(0, 100) || "Creative deliverable"}`.slice(
          0,
          180,
        );
      const db = getDb();
      if (!db) {
        const store = getDemoStore();
        let taskId = input.scope.taskId ?? null;
        const existing = [...store.tasks.values()].find(
          (t) =>
            t.clientId === input.scope.clientId &&
            t.taskType === "social_cutdowns",
        );
        if (existing) {
          existing.status = "client_review";
          existing.qcPassed = true;
          existing.qcNotes =
            existing.qcNotes ?? "Auto-QC for agent creative sent to portal";
          taskId = existing.taskId;
        } else {
          taskId = crypto.randomUUID();
          store.tasks.set(taskId, {
            taskId,
            clientId: input.scope.clientId,
            calendarId: null,
            month: null,
            taskType: "social_cutdowns",
            title: `Portal creative — ${title.slice(0, 80)}`,
            status: "client_review",
            situationalState: null,
            ownerEmployeeId: input.scope.employeeId ?? null,
            deadline: null,
            priority: "high",
            qcPassed: true,
            qcNotes: "Auto-QC for agent creative sent to portal",
            clientRevisionCount: 0,
            revisionBoundaryAck: false,
            briefId: null,
          });
        }
        const asset = store.createAsset(title, input.scope.clientId, taskId);
        asset.status = "client_review";
        const storagePath = `dam/${asset.assetId}/v1-agent.txt`;
        asset.versions.push({
          assetVersionId: crypto.randomUUID(),
          assetId: asset.assetId,
          storagePath,
          versionNumber: 1,
          isClientRevision: false,
          uploadedByEmployeeId: input.scope.employeeId ?? null,
          createdAt: new Date().toISOString(),
        });
        const approvalId = taskId ?? asset.assetId;
        store.portalApprovals.set(approvalId, {
          approvalId,
          clientId: input.scope.clientId,
          title,
          kind: "asset",
          status: "pending",
          entityId: asset.assetId,
          slaHours: 48,
          createdAt: new Date().toISOString(),
        });
        results.push({
          tool: "creative.sendToPortal",
          ok: true,
          data: await (async () => {
            const clientId = input.scope.clientId!;
            const portalHref = await (
              await import("../auth/portal-review-href")
            ).portalReviewHref(clientId);
            return {
              assetId: asset.assetId,
              taskId,
              clientId,
              portalHref,
              mode: "memory" as const,
              next: {
                creative: taskId
                  ? `/creative?clientId=${encodeURIComponent(clientId)}&taskId=${encodeURIComponent(taskId)}`
                  : `/creative?clientId=${encodeURIComponent(clientId)}`,
                delivery: taskId
                  ? `/delivery?clientId=${encodeURIComponent(clientId)}&taskId=${encodeURIComponent(taskId)}`
                  : `/delivery?clientId=${encodeURIComponent(clientId)}`,
                portal: portalHref,
              },
            };
          })(),
        });
      } else {
        const { seedClientCreativeTask, updateDeliveryTaskStatus } =
          await import("../tasks/delivery-tasks");
        let taskId = input.scope.taskId ?? null;
        const seeded = await seedClientCreativeTask({
          clientId: input.scope.clientId,
          title: `Portal creative — ${title.slice(0, 80)}`,
          status: "qc",
        });
        if (seeded) {
          await updateDeliveryTaskStatus({
            taskId: seeded.taskId,
            status: "client_review",
            qcPassed: true,
            qcNotes: "Auto-QC for agent creative sent to portal",
          });
          taskId = seeded.taskId;
        }
        const assets = await db.execute<{ assetId: string }>(sql`
          insert into public.asset (title, client_id, status, task_id)
          values (
            ${title},
            ${input.scope.clientId}::uuid,
            'client_review',
            ${taskId}::uuid
          )
          returning asset_id as "assetId"
        `);
        const assetId = assets[0]!.assetId;
        const storagePath = `dam/${assetId}/v1-agent.txt`;
        const body = new TextEncoder().encode(
          input.prompt.trim().slice(0, 4000) || title,
        );
        const { getObjectStore } = await import("../storage/object-store");
        await getObjectStore().put({
          path: storagePath,
          body,
          contentType: "text/plain; charset=utf-8",
        });
        await db.execute(sql`
          insert into public.asset_version (
            asset_id, storage_path, version_number, is_client_revision,
            uploaded_by_employee_id
          ) values (
            ${assetId}::uuid,
            ${storagePath},
            1,
            false,
            ${input.scope.employeeId ?? null}::uuid
          )
        `);
        results.push({
          tool: "creative.sendToPortal",
          ok: true,
          data: await (async () => {
            const clientId = input.scope.clientId!;
            const portalHref = await (
              await import("../auth/portal-review-href")
            ).portalReviewHref(clientId);
            return {
              assetId,
              taskId,
              clientId,
              portalHref,
              mode: "durable" as const,
              next: {
                creative: taskId
                  ? `/creative?clientId=${encodeURIComponent(clientId)}&taskId=${encodeURIComponent(taskId)}`
                  : `/creative?clientId=${encodeURIComponent(clientId)}`,
                delivery: taskId
                  ? `/delivery?clientId=${encodeURIComponent(clientId)}&taskId=${encodeURIComponent(taskId)}`
                  : `/delivery?clientId=${encodeURIComponent(clientId)}`,
                portal: portalHref,
              },
            };
          })(),
        });
      }
    } catch (err) {
      results.push({
        tool: "creative.sendToPortal",
        ok: false,
        error:
          err instanceof Error ? err.message : "creative_send_to_portal_failed",
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
