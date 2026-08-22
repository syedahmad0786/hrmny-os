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
          a === "*" ||
          (a.endsWith(".*") && key.startsWith(a.slice(0, -1))),
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

  /**
   * OS finance approve/issue (propose → approve → issue). Prompt-gated;
   * never in DEFAULT_FUNNEL_AGENT_TOOLS. Org-only (no client sandbox).
   * Issue is OS-only when Xero write is disabled.
   */
  const wantsFinanceApprove =
    !input.scope.clientId &&
    (want("finance.os_approve") ||
      want("finance.approve") ||
      want("invoices.approve")) &&
    /(?:os[_\s-]?approve|approve\s+(?:the\s+)?(?:os\s+)?invoice|invoice[^\n]{0,40}approv)/i.test(
      input.prompt,
    );

  const wantsFinanceIssue =
    !input.scope.clientId &&
    (want("finance.os_issue") ||
      want("finance.issue") ||
      want("invoices.issue")) &&
    /(?:os[_\s-]?issue|issue\s+(?:the\s+)?(?:os\s+)?invoice|invoice[^\n]{0,40}issue|mark\s+issued)/i.test(
      input.prompt,
    );

  if (wantsFinanceApprove || wantsFinanceIssue) {
    const {
      approveOsInvoice,
      issueOsInvoice,
      parseInvoiceIdFromPrompt,
    } = await import("../finance/os-invoice-actions");
    const invoiceId = parseInvoiceIdFromPrompt(input.prompt);
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
    const { approveOsOutreach, parseOutreachIdFromPrompt } = await import(
      "../leadgen/os-outreach-actions"
    );
    const outreachId = parseOutreachIdFromPrompt(input.prompt);
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
   * Org-wide prospect → won → handover → onboarding. Prompt-gated so
   * crm.* / * allowlists alone cannot fire a full closed loop on every run.
   * Never added to DEFAULT_FUNNEL_AGENT_TOOLS.
   */
  const wantsClosedLoop =
    !input.scope.clientId &&
    (want("crm.closed_loop") ||
      want("crm.runDemoClosedLoop") ||
      want("funnel.closed_loop")) &&
    /closed\s*loop|runDemoClosedLoop|won\s*handover|prospect\s*(?:→|->|to)\s*won/i.test(
      input.prompt,
    );

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

  if (
    !wantsClosedLoop &&
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

  if (
    input.scope.clientId &&
    (want("portal.invite") ||
      want("portal.magic_link") ||
      want("onboarding.invite"))
  ) {
    try {
      const { sendPortalInviteMagicLink } = await import(
        "../auth/portal-magic-link"
      );
      const { createResendMock } = await import("@hrmny/integrations");
      const emailMatch = input.prompt.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      );
      const email =
        emailMatch?.[0]?.toLowerCase() ??
        `portal+${input.scope.clientId.slice(0, 8)}@example.com`;
      const placeholderInbox = email.endsWith("@example.com");
      const sent = await sendPortalInviteMagicLink({
        clientId: input.scope.clientId,
        email,
        displayName: "Agent portal invite",
        next: "/portal/approvals",
        emailer: placeholderInbox ? createResendMock() : undefined,
      });
      results.push({
        tool: "portal.invite",
        ok: true,
        data: {
          email: sent.email,
          clientId: sent.clientId,
          portalPath: sent.portalPath,
          deliveryMode: sent.delivery.mode,
          deliveryId: sent.delivery.id,
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
          data: {
            assetId: asset.assetId,
            taskId,
            clientId: input.scope.clientId,
            portalHref: await (
              await import("../auth/portal-review-href")
            ).portalReviewHref(input.scope.clientId),
            mode: "memory",
          },
        });
      } else {
        const {
          seedClientCreativeTask,
          updateDeliveryTaskStatus,
        } = await import("../tasks/delivery-tasks");
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
          data: {
            assetId,
            taskId,
            clientId: input.scope.clientId,
            portalHref: await (
              await import("../auth/portal-review-href")
            ).portalReviewHref(input.scope.clientId),
            mode: "durable",
          },
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
