import { TRPCError } from "@trpc/server";
import type { AgentRunOutput } from "@hrmny/ai";
import {
  createActivity,
  createNote,
  getCompany,
  getContact,
  getDeal,
  listActivities,
  listContacts,
  listDeals,
  listNotes,
  updateDeal,
} from "../crm/repository";
import type { ActivityRow, DealRow } from "../crm/types";
import { writeAudit } from "../m1-persistence";
import { defaultRunAgent, type RunAgent } from "../leadgen/agent-run";
import { draftOutreach } from "../trpc/leadgen-router";
import type { OutreachItem } from "../leadgen/store";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  recordIntegrationReceipt,
} from "../integrations/inbox";
import { normalizeResearchEvidence } from "../sales-os/research-evidence";

/**
 * W9 CRM AI helpers. Pure aggregation over the existing CRM repository reads +
 * the M7 agent-runner seam (mock-first, kill-switch + cap respected inside
 * runAgent). Every function takes an optional `runAgent` so tests inject the
 * deterministic mock; production uses `defaultRunAgent`. Nothing here sends —
 * draftOutreach delegates to the leadgen HITL queue, everything else is a
 * read + advisory draft (rescoreBuaf writes only the BUAF fields back, audited).
 */

export type AgentRunMeta = { model: string; tokens: number; costAed: number };

export type CrmAiResult<T = AgentRunOutput["output"]> = {
  output: T;
  agentRun: AgentRunMeta;
};

export type CompanyKnowledgeBriefResult = {
  brief: string;
  noteId: string;
  sources: Array<{ url: string; title?: string }>;
  agentRun: AgentRunMeta;
  providerRequestId: string | null;
  webSearchRequests: number;
  duplicate: boolean;
};

function meta(run: AgentRunOutput): AgentRunMeta {
  return {
    model: run.model,
    tokens: run.inputTokens + run.outputTokens,
    costAed: run.costAed,
  };
}

/** Standard disabled error: runAgent returns a typed refusal (kill switch /
 * policy) instead of throwing — surface it as one PRECONDITION_FAILED shape. */
function assertNotRefused(run: AgentRunOutput): void {
  const o = run.output;
  if (
    typeof o === "object" &&
    o !== null &&
    (o as { refused?: boolean }).refused === true
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: (o as { message?: string }).message ?? "Agent run refused",
    });
  }
}

/** Compact deal context for the LLM — margin/cost fields deliberately excluded. */
function dealContext(d: DealRow) {
  return {
    dealId: d.dealId,
    companyName: d.companyName,
    sector: d.sector,
    stage: d.stage,
    closeOutcome: d.closeOutcome,
    lostReason: d.lostReason,
    leadSourceLane: d.leadSourceLane,
    buaf: {
      budget: d.buafBudget,
      urgency: d.buafUrgency,
      access: d.buafAccess,
      fit: d.buafFit,
      temperature: d.buafTemperature,
    },
    emailVerified: d.emailVerified,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function activityContext(rows: ActivityRow[]) {
  return rows.map((a) => ({
    type: a.type,
    subject: a.subject,
    occurredAt: a.occurredAt,
  }));
}

async function requireDeal(dealId: string): Promise<DealRow> {
  const deal = await getDeal(dealId);
  if (!deal)
    throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
  return deal;
}

function readableAgentOutput(output: AgentRunOutput["output"]): string {
  if (typeof output === "string") return output.trim();
  for (const key of ["brief", "summary", "text", "message"]) {
    if (typeof output[key] === "string") return output[key].trim();
  }
  return JSON.stringify(output, null, 2);
}

function verifiedSourceCitations(
  citations: AgentRunOutput["sourceCitations"],
): Array<{ url: string; title?: string }> {
  const seen = new Set<string>();
  return (citations ?? []).flatMap((citation) => {
    try {
      const url = normalizeResearchEvidence(citation.url);
      if (seen.has(url)) return [];
      seen.add(url);
      return [{ url, ...(citation.title ? { title: citation.title } : {}) }];
    } catch {
      return [];
    }
  });
}

/**
 * Run one bounded, user-confirmed web research pass and retain the brief in
 * the canonical CRM notes. The receipt prevents an automatic retry from
 * repeating a charge or duplicating the note.
 */
export async function companyKnowledgeBrief(input: {
  dealId: string;
  requestId: string;
  confirmWebResearch: true;
  actorEmployeeId: string;
  roles: string[];
  runAgent?: RunAgent;
}): Promise<CompanyKnowledgeBriefResult> {
  if (input.confirmWebResearch !== true) {
    throw new Error("OPENROUTER_WEB_RESEARCH_CONFIRMATION_REQUIRED");
  }
  const deal = await requireDeal(input.dealId);
  if (!deal.companyId) throw new Error("Company missing for deal");
  const [company, contact, activities, notes] = await Promise.all([
    getCompany(deal.companyId),
    deal.primaryContactId ? getContact(deal.primaryContactId) : null,
    listActivities({ dealId: deal.dealId, limit: 15 }),
    listNotes({ dealId: deal.dealId }),
  ]);
  if (!company) throw new Error("Company missing for deal");

  const receiptPayload = {
    dealId: deal.dealId,
    companyId: company.companyId,
    actorEmployeeId: input.actorEmployeeId,
    confirmation: "bounded-openrouter-web-research",
  };
  const receipt = await recordIntegrationReceipt({
    provider: "openrouter",
    externalEventId: `company-brief:${input.actorEmployeeId}:${input.requestId}`,
    operation: "company.research.brief",
    rawBody: JSON.stringify(receiptPayload),
    payload: receiptPayload,
    status: "processing",
    ownerEmployeeId: input.actorEmployeeId,
  });
  if (receipt.duplicate) {
    if (receipt.status === "completed" && receipt.result) {
      return {
        ...(receipt.result as unknown as Omit<
          CompanyKnowledgeBriefResult,
          "duplicate"
        >),
        duplicate: true,
      };
    }
    throw new Error("This research request is already being reconciled");
  }

  try {
    const run = await (input.runAgent ?? defaultRunAgent)({
      agent: "research",
      roles: input.roles,
      webSearch: true,
      input: [
        `Build a concise sales knowledge brief for ${company.name}.`,
        "Use live web sources and do not invent facts.",
        "Separate verified facts from reasonable hypotheses.",
        "Cover: company snapshot, why now, relevant current signals, likely business or marketing pain points, decision-maker context, BUAF (budget/urgency/access/fit), the best hrmny service match, outreach angle, landmines, and one next action.",
        "hrmny service lines are SMM, PR, campaigns, branding, activations, and content production.",
        "Keep it skimmable and under 900 words. Do not include private or sensitive personal information.",
      ].join("\n"),
      context: {
        company: {
          name: company.name,
          website: company.website,
          sector: company.sector,
          market: company.market,
        },
        contact: contact
          ? {
              name: [contact.firstName, contact.lastName]
                .filter(Boolean)
                .join(" "),
              title: contact.title,
              linkedinUrl: contact.linkedinUrl,
            }
          : null,
        deal: dealContext(deal),
        recentActivity: activityContext(activities),
        existingNotes: notes.slice(0, 5).map((note) => note.body.slice(0, 500)),
      },
    });
    assertNotRefused(run);
    const brief = readableAgentOutput(run.output).slice(0, 12_000);
    const sources = verifiedSourceCitations(run.sourceCitations).slice(0, 8);
    if (!brief || sources.length === 0) {
      throw new Error(
        "OpenRouter returned no source-backed brief. Nothing was saved.",
      );
    }
    const sourceList = sources
      .map(
        (source, index) =>
          `[${index + 1}] ${source.title?.trim() || new URL(source.url).hostname} — ${source.url}`,
      )
      .join("\n");
    const note = await createNote({
      dealId: deal.dealId,
      companyId: company.companyId,
      contactId: contact?.contactId,
      authorEmployeeId: input.actorEmployeeId,
      body: [
        `SALES KNOWLEDGE BRIEF — ${company.name}`,
        `Research request: ${input.requestId}`,
        "",
        brief,
        "",
        "VERIFIED WEB SOURCES",
        sourceList,
      ].join("\n"),
    });
    const result: Omit<CompanyKnowledgeBriefResult, "duplicate"> = {
      brief,
      noteId: note.crmNoteId,
      sources,
      agentRun: meta(run),
      providerRequestId: run.providerRequestId ?? null,
      webSearchRequests: run.webSearchRequests ?? 0,
    };
    await completeIntegrationReceipt(
      receipt.receiptId,
      result as unknown as Record<string, unknown>,
    );
    return { ...result, duplicate: false };
  } catch (error) {
    await failIntegrationReceipt(
      receipt.receiptId,
      error instanceof Error ? error.message : "Research brief failed",
    ).catch(() => undefined);
    throw error;
  }
}

// ── dealSummary ────────────────────────────────────────────

export async function dealSummary(input: {
  dealId: string;
  runAgent?: RunAgent;
}): Promise<CrmAiResult> {
  const deal = await requireDeal(input.dealId);
  const [contact, activities, notes] = await Promise.all([
    deal.primaryContactId ? getContact(deal.primaryContactId) : null,
    listActivities({ dealId: input.dealId, limit: 30 }),
    listNotes({ dealId: input.dealId }),
  ]);
  const run = await (input.runAgent ?? defaultRunAgent)({
    agent: "crm-summary",
    input: `Summarize the timeline for deal "${deal.companyName}" (stage: ${deal.stage}).`,
    context: {
      deal: dealContext(deal),
      contact: contact
        ? {
            name: [contact.firstName, contact.lastName]
              .filter(Boolean)
              .join(" "),
            email: contact.email,
            title: contact.title,
          }
        : null,
      activities: activityContext(activities),
      notes: notes.slice(0, 10).map((n) => n.body.slice(0, 300)),
    },
  });
  assertNotRefused(run);
  return { output: run.output, agentRun: meta(run) };
}

// ── accountSummary ─────────────────────────────────────────

export async function accountSummary(input: {
  companyId: string;
  runAgent?: RunAgent;
}): Promise<CrmAiResult> {
  const company = await getCompany(input.companyId);
  if (!company)
    throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
  const [contacts, deals, activities, notes] = await Promise.all([
    listContacts({ companyId: input.companyId }),
    listDeals({ companyId: input.companyId }),
    listActivities({ companyId: input.companyId, limit: 30 }),
    listNotes({ companyId: input.companyId }),
  ]);
  const run = await (input.runAgent ?? defaultRunAgent)({
    agent: "crm-summary",
    input: `Summarize the account timeline for "${company.name}".`,
    context: {
      company: {
        companyId: company.companyId,
        name: company.name,
        sector: company.sector,
        market: company.market,
        notes: company.notes,
      },
      contacts: contacts.map((c) => ({
        name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        title: c.title,
        isPrimary: c.isPrimary,
      })),
      deals: deals.map(dealContext),
      activities: activityContext(activities),
      notes: notes.slice(0, 10).map((n) => n.body.slice(0, 300)),
    },
  });
  assertNotRefused(run);
  return { output: run.output, agentRun: meta(run) };
}

// ── nextBestAction ─────────────────────────────────────────

export async function nextBestAction(input: {
  dealId: string;
  runAgent?: RunAgent;
}): Promise<CrmAiResult> {
  const deal = await requireDeal(input.dealId);
  const activities = await listActivities({ dealId: input.dealId, limit: 10 });
  const lastActivityAt = activities[0]?.occurredAt ?? deal.updatedAt;
  const daysSinceLastActivity = Math.max(
    0,
    Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000),
  );
  const run = await (input.runAgent ?? defaultRunAgent)({
    agent: "next-best-action",
    input: `Suggest the next best action for deal "${deal.companyName}" (stage: ${deal.stage}, ${daysSinceLastActivity} days since last activity).`,
    context: {
      deal: dealContext(deal),
      lastActivityAt,
      daysSinceLastActivity,
      recentActivities: activityContext(activities),
    },
  });
  assertNotRefused(run);
  return { output: run.output, agentRun: meta(run) };
}

// ── rescoreBuaf ────────────────────────────────────────────

const TEMPERATURES = ["hot", "warm", "cool", "cold"] as const;
type Temperature = (typeof TEMPERATURES)[number];

/** Same shape-tolerant extraction as leadgen/pipeline.ts extractScore. */
function extractScore(output: unknown): {
  buafScore: number;
  temperature: Temperature;
} {
  const o = (typeof output === "object" && output ? output : {}) as Record<
    string,
    unknown
  >;
  const buafScore =
    typeof o.buafScore === "number" && Number.isFinite(o.buafScore)
      ? o.buafScore
      : 0;
  const temperature = (TEMPERATURES as readonly string[]).includes(
    o.temperature as string,
  )
    ? (o.temperature as Temperature)
    : buafScore >= 75
      ? "hot"
      : buafScore >= 50
        ? "warm"
        : buafScore >= 25
          ? "cool"
          : "cold";
  return { buafScore, temperature };
}

export async function rescoreBuaf(input: {
  dealId: string;
  actorEmployeeId?: string | null;
  runAgent?: RunAgent;
}): Promise<
  CrmAiResult<{ buafScore: number; temperature: Temperature; deal: DealRow }>
> {
  const deal = await requireDeal(input.dealId);
  // Same research-agent BUAF path the daily leadgen pipeline uses, on one deal.
  const run = await (input.runAgent ?? defaultRunAgent)({
    agent: "research",
    input: {
      lead: {
        companyName: deal.companyName,
        sector: deal.sector,
        stage: deal.stage,
        leadSourceLane: deal.leadSourceLane,
      },
    },
  });
  assertNotRefused(run);
  const { buafScore, temperature } = extractScore(run.output);

  const updated = await updateDeal(input.dealId, {
    buafTemperature: temperature,
  });
  if (!updated)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Deal missing after rescore",
    });

  await writeAudit({
    actorEmployeeId: input.actorEmployeeId ?? null,
    action: "crm.ai.rescore_buaf",
    entityType: "deal",
    entityId: deal.dealId,
    before: { buafTemperature: deal.buafTemperature },
    after: { buafTemperature: temperature, buafScore },
    reason: "AI BUAF rescore via research agent",
  });
  await createActivity({
    type: "system",
    subject: `BUAF rescored: ${buafScore} (${temperature})`,
    dealId: deal.dealId,
    companyId: deal.companyId,
    actorEmployeeId: input.actorEmployeeId ?? null,
    metadata: { buafScore, temperature },
  });

  return {
    output: { buafScore, temperature, deal: updated },
    agentRun: meta(run),
  };
}

// ── draftOutreach (delegates to the gated leadgen HITL path) ──

export async function draftOutreachForDeal(input: {
  dealId: string;
  runAgent?: RunAgent;
}): Promise<CrmAiResult<OutreachItem>> {
  const base = input.runAgent ?? defaultRunAgent;
  let captured: AgentRunOutput | undefined;
  // Wrap the runner so a kill-switch refusal aborts BEFORE any draft is
  // inserted, and so we can report the run's cost alongside the draft.
  const capture: RunAgent = async (req) => {
    const run = await base(req);
    assertNotRefused(run);
    captured = run;
    return run;
  };
  const item = await draftOutreach({ dealId: input.dealId, runAgent: capture });
  return {
    output: item,
    agentRun: captured
      ? meta(captured)
      : { model: "none", tokens: 0, costAed: 0 },
  };
}
