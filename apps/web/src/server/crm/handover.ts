import { sql } from "@hrmny/db";
import { ensureClientOnboarding } from "../clients/onboarding";
import { getDb } from "../db";
import { persistMemoryChunk } from "../ai/memory-db";
import { seedClientCreativeTask } from "../tasks/delivery-tasks";
import { resolveTaxRegistration } from "../finance/tax-registration";
import { buildHandoverNextLinks } from "./handover-next";
import {
  getDeal,
  getContact,
  listCrmTasks,
  listNotes,
  listActivities,
  listQuotesByDeal,
  updateDeal,
  moveDealStage,
} from "./repository";
import type { CrmQuoteRow, DealRow, QuoteLineItem } from "./types";

export type CloseOutcome = "won" | "lost" | "postponed_on_hold";

type HandoverFailure = {
  ok: false;
  reason: string;
  code?: string;
  /** Required records already present when the handover stopped. */
  completed?: string[];
  /** Required effects that still need a successful retry. */
  requiredFailures?: string[];
};

type ScopeLine = {
  label: string;
  quantity: number;
  unitPrice: number;
  internalCost: number;
  isVendor: boolean;
};

type AcceptedScope = {
  scopeId: string;
  sourceQuoteId: string;
  deliverableCount: number;
};

const BRAND_PREFIX = "HANDOVER:BRAND_ASSETS —";
const BILLING_PREFIX = "HANDOVER:BILLING_DETAILS —";

function sameMoney(
  left: string | number | null,
  right: string | number | null,
) {
  return Math.abs(Number(left ?? 0) - Number(right ?? 0)) < 0.005;
}

async function handoverReadiness(
  deal: DealRow,
  quote: CrmQuoteRow | null,
): Promise<{ completed: string[]; requiredFailures: string[] }> {
  const [contact, tasks, notes] = await Promise.all([
    deal.primaryContactId ? getContact(deal.primaryContactId) : null,
    listCrmTasks({ dealId: deal.dealId }),
    listNotes({ dealId: deal.dealId }),
  ]);
  const checks = [
    ["scope.accepted_quote", Boolean(quote)],
    ["scope.agreed_price", Number(quote?.quoteValue ?? 0) > 0],
    ["contact.primary", Boolean(contact)],
    [
      "task.key_date",
      tasks.some(
        (task) =>
          task.status !== "done" &&
          task.status !== "cancelled" &&
          Boolean(task.dueDate),
      ),
    ],
    [
      "evidence.brand_assets",
      notes.some(
        (note) =>
          note.body.startsWith(BRAND_PREFIX) &&
          note.body.slice(BRAND_PREFIX.length).trim().length > 0,
      ),
    ],
    [
      "evidence.billing_details",
      notes.some(
        (note) =>
          note.body.startsWith(BILLING_PREFIX) &&
          note.body.slice(BILLING_PREFIX.length).trim().length > 0,
      ),
    ],
  ] as const;
  return {
    completed: checks.filter(([, ready]) => ready).map(([key]) => key),
    requiredFailures: checks.filter(([, ready]) => !ready).map(([key]) => key),
  };
}

function acceptedQuoteForHandover(quotes: CrmQuoteRow[]): CrmQuoteRow | null {
  const latest = quotes[0];
  return latest?.status === "accepted" && latest.lineItems.length > 0
    ? latest
    : null;
}

function scopeLines(lineItems: QuoteLineItem[]): ScopeLine[] {
  return lineItems.map((line) => ({
    label: line.label.trim(),
    quantity: line.qty ?? 1,
    unitPrice: line.unitSell,
    internalCost: line.unitCost,
    isVendor: Boolean(line.isVendor),
  }));
}

function lineSignature(line: {
  label: string;
  quantity: number | string;
  unitPrice: number | string;
  internalCost: number | string;
}) {
  return [
    line.label.trim(),
    Number(line.quantity).toFixed(2),
    Number(line.unitPrice).toFixed(2),
    Number(line.internalCost).toFixed(2),
  ].join("\u0000");
}

function sameScopeLines(
  expected: ScopeLine[],
  actual: Array<{
    label: string;
    quantity: number | string;
    unitPrice: number | string;
    internalCost: number | string;
  }>,
) {
  const expectedSignatures = expected.map(lineSignature).sort();
  const actualSignatures = actual.map(lineSignature).sort();
  return (
    expectedSignatures.length === actualSignatures.length &&
    expectedSignatures.every(
      (signature, index) => signature === actualSignatures[index],
    )
  );
}

function handoverIncomplete(
  completed: string[],
  requiredFailures: string[],
  reason = "Handover required records are incomplete",
): HandoverFailure {
  return {
    ok: false,
    reason,
    code: "HANDOVER_INCOMPLETE",
    completed: [...completed],
    requiredFailures,
  };
}

/**
 * Promote one accepted quote version into the existing scope tables. The
 * accepted quote id is the replay key; an advisory lock prevents two handover
 * requests from creating the same scope concurrently.
 */
async function ensureDurableAcceptedScope(input: {
  db: NonNullable<ReturnType<typeof getDb>>;
  clientId: string;
  dealId: string;
  quote: CrmQuoteRow;
}): Promise<AcceptedScope> {
  const lines = scopeLines(input.quote.lineItems);
  const receipt = `CRM quote receipt ${input.quote.quoteId}`;
  return input.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`crm-handover-scope:${input.quote.quoteId}`}, 0))`,
    );
    const existing = await tx.execute<{ scopeId: string }>(sql`
      select scope_id as "scopeId"
      from public.scope
      where deal_id = ${input.dealId}::uuid
        and terms = ${receipt}
      limit 1
    `);
    let scopeId = existing[0]?.scopeId ?? null;
    if (!scopeId) {
      const inserted = await tx.execute<{ scopeId: string }>(sql`
        insert into public.scope (
          client_id, deal_id, title, value, terms, period_start, status,
          margin_at_sale_pct
        ) values (
          ${input.clientId}::uuid,
          ${input.dealId}::uuid,
          ${`Accepted scope v${input.quote.version}`},
          ${input.quote.quoteValue},
          ${receipt},
          current_date,
          'active'::scope_status_enum,
          ${input.quote.marginPct}
        )
        returning scope_id as "scopeId"
      `);
      scopeId = inserted[0]?.scopeId ?? null;
      if (!scopeId) throw new Error("Accepted scope insert returned no id");
      for (const line of lines) {
        await tx.execute(sql`
          insert into public.scope_deliverable_line (
            scope_id, label, quantity, unit_price, internal_cost
          ) values (
            ${scopeId}::uuid,
            ${line.label},
            ${line.quantity},
            ${line.unitPrice},
            ${line.internalCost}
          )
        `);
      }
    }
    const stored = await tx.execute<{
      label: string;
      quantity: string;
      unitPrice: string;
      internalCost: string;
    }>(sql`
      select
        label,
        quantity::text as quantity,
        unit_price::text as "unitPrice",
        internal_cost::text as "internalCost"
      from public.scope_deliverable_line
      where scope_id = ${scopeId}::uuid
      order by created_at, scope_deliverable_line_id
    `);
    if (!sameScopeLines(lines, stored)) {
      throw new Error(
        "Stored scope deliverables do not match the accepted quote receipt",
      );
    }
    return {
      scopeId,
      sourceQuoteId: input.quote.quoteId,
      deliverableCount: stored.length,
    };
  });
}

/**
 * Mark a durable CRM deal closed with an outcome. For won, stage becomes `close`
 * (from price_cost or already close). Lost/on-hold stay at close without handover.
 */
export async function closeDurableDeal(input: {
  dealId: string;
  outcome: CloseOutcome;
  lostReason?: string | null;
  actorEmployeeId?: string | null;
}): Promise<
  { ok: true; deal: DealRow } | { ok: false; reason: string; code?: string }
> {
  const existing = await getDeal(input.dealId);
  if (!existing) return { ok: false, reason: "Deal not found" };

  if (input.outcome === "lost" && !input.lostReason?.trim()) {
    return {
      ok: false,
      reason: "lostReason required when lost",
      code: "GATE_BLOCKED",
    };
  }

  const stage = existing.stage;
  if (input.outcome === "won") {
    if (stage !== "close") {
      return {
        ok: false,
        reason:
          "Advance the deal through the commercial gates before marking it won",
        code: "GATE_BLOCKED",
      };
    }
    const [latestQuote] = await listQuotesByDeal(input.dealId);
    if (!latestQuote || latestQuote.status !== "accepted") {
      return {
        ok: false,
        reason:
          "Record the signed agreement against the latest quote before marking the deal won",
        code: "GATE_BLOCKED",
      };
    }
    const signedAgreementRecorded = (
      await listActivities({ dealId: input.dealId, limit: 200 })
    ).some(
      (activity) =>
        activity.metadata.quoteId === latestQuote.quoteId &&
        typeof activity.metadata.evidenceUrl === "string" &&
        activity.metadata.evidenceUrl.startsWith("https://"),
    );
    if (!signedAgreementRecorded) {
      return {
        ok: false,
        reason:
          "The accepted quote is missing its signed-agreement evidence receipt",
        code: "GATE_BLOCKED",
      };
    }
  }
  if (stage === "price_cost") {
    const moved = await moveDealStage({
      dealId: input.dealId,
      to: "close",
      actorEmployeeId: input.actorEmployeeId,
    });
    if (!moved.ok) return { ok: false, reason: moved.reason };
  } else if (stage !== "close" && stage !== "handover_pack") {
    return {
      ok: false,
      reason: `Deal must be in price_cost or close (now ${stage})`,
      code: "GATE_BLOCKED",
    };
  }

  const deal = await updateDeal(input.dealId, {
    closeOutcome: input.outcome,
    lostReason: input.lostReason ?? null,
  });
  if (!deal) return { ok: false, reason: "Update failed" };

  try {
    const { insertWinLossNote } = await import("../leadgen/store");
    await insertWinLossNote({
      dealId: input.dealId,
      outcome: input.outcome,
      note:
        input.outcome === "lost"
          ? input.lostReason?.trim() || "Lost"
          : input.outcome === "won"
            ? `Won ${deal.companyName} — handover ready`
            : `Postponed / on hold: ${deal.companyName}`,
    });
    await persistMemoryChunk({
      sourceType: "feedback",
      sourceId: input.dealId,
      content: `Deal closed (${input.outcome}): ${deal.companyName}.${
        input.lostReason ? ` Reason: ${input.lostReason}` : ""
      }`,
      metadata: {
        dealId: input.dealId,
        companyId: deal.companyId,
        kind: "crm.deal_closed",
        outcome: input.outcome,
      },
    });
  } catch {
    /* win/loss + memory best-effort */
  }

  return { ok: true, deal };
}

export type HandoverPackResult = {
  ok: true;
  pack: {
    packId: string;
    dealId: string;
    clientId: string;
    scopeId: string;
    sourceQuoteId: string;
    scopeDeliverableCount: number;
    invoice: { invoiceId: string; status: "proposed" };
    fired: string[];
    createdAt: string;
  };
  client: {
    clientId: string;
    dealId: string;
    name: string;
    market: string;
    engagementType: string;
    contractValue: string;
    lifecycleStatus: string;
  };
  /** Accepted quote promoted into the durable delivery scope tables. */
  scopeId: string;
  sourceQuoteId: string;
  scopeDeliverableCount: number;
  task: Awaited<ReturnType<typeof seedClientCreativeTask>> | null;
  /** First internal OS invoice proposal. This does not mean posted to Xero. */
  invoiceId: string | null;
  invoiceStatus: "proposed" | null;
  onboardingPhases: number;
  /** Content calendar seeded for Account / Creative continuity. */
  calendarId: string | null;
  /** Synthetic invite receipt; production invites are a separate approval. */
  portalInvite: {
    portalUserId: string;
    email: string;
    /** Approvals destination (own single-use token). */
    portalPath?: string;
    /** Onboarding destination (own single-use token). */
    onboardingPath?: string;
    delivery?: { mode: "mock" | "live"; id: string };
  } | null;
  /** HITL outreach draft for the won deal (reuses existing if any). */
  outreachId: string | null;
  /** LinkedIn (or channel) campaign draft seeded for Approvals / publish. */
  campaignItemId: string | null;
  /** Deep links for staff after won → OS. */
  next: {
    client: string;
    account: string;
    creative: string;
    finance: string;
    approvals: string;
    portal: string;
    onboarding: string;
    outreach: string;
    campaigns: string;
  };
};

/**
 * Memory-mode won → OS: demo-store client + onboarding + creative QC task +
 * staff notify. Portal invitations remain a separate approved action.
 */
async function memoryHandoverPack(input: {
  dealId: string;
  actorEmployeeId?: string | null;
}): Promise<HandoverPackResult | HandoverFailure> {
  const deal = await getDeal(input.dealId);
  if (!deal) return { ok: false, reason: "Deal not found" };
  if (deal.closeOutcome !== "won") {
    return {
      ok: false,
      reason: "Deal must be close/won before Handover Pack",
      code: "GATE_BLOCKED",
    };
  }

  const needsStageAdvance = deal.stage === "close";
  if (!needsStageAdvance && deal.stage !== "handover_pack") {
    return {
      ok: false,
      reason: `Unexpected stage ${deal.stage}`,
      code: "GATE_BLOCKED",
    };
  }

  const acceptedQuote = acceptedQuoteForHandover(
    await listQuotesByDeal(input.dealId),
  );
  const readiness = await handoverReadiness(deal, acceptedQuote);
  if (!acceptedQuote || readiness.requiredFailures.length > 0) {
    return handoverIncomplete(
      readiness.completed,
      readiness.requiredFailures,
      "Complete all six handover facts before creating Delivery records",
    );
  }

  const fired: string[] = [];
  const { getDemoStore, DEMO_STAFF_LEAD_ID } = await import("../demo-store");
  const store = getDemoStore();
  const existing = [...store.clients.values()].find(
    (c) => c.dealId === input.dealId,
  );

  let contactEmail: string | null = null;
  if (deal.primaryContactId) {
    const contact = await getContact(deal.primaryContactId);
    contactEmail = contact?.email?.trim().toLowerCase() ?? null;
  }

  const demoClient =
    existing ??
    store.createClientFromWonDeal({
      dealId: deal.dealId,
      companyName: deal.companyName,
      sector: deal.sector,
      stage: "handover_pack",
      closeOutcome: "won",
      lostReason: null,
      leadSourceLane: deal.leadSourceLane ?? "relationship_led",
      buafBudget: Boolean(deal.buafBudget),
      buafUrgency: Boolean(deal.buafUrgency),
      buafAccess: Boolean(deal.buafAccess),
      buafFit: Boolean(deal.buafFit),
      buafTemperature: deal.buafTemperature,
      noGoFlags: [],
      emailVerified: deal.emailVerified,
      contactEmail,
      voiceCheckPassed: false,
      quoteValue: acceptedQuote.quoteValue,
      internalCost: acceptedQuote.internalCost,
      marginPct: acceptedQuote.marginPct,
      discountPct: deal.discountPct ?? "0",
      discountApprovalTier: null,
      vendorHandlingFeePct: deal.vendorHandlingFeePct ?? "0",
      quoteLines: [],
      ownerEmployeeId: deal.ownerEmployeeId,
      enrichment: null,
      commercialMode: "project",
    });
  fired.push(existing ? "client.exists" : "client.create");
  if (!sameMoney(demoClient.contractValue, acceptedQuote.quoteValue)) {
    return handoverIncomplete(
      fired,
      ["client.contract_value"],
      "Existing client contract value does not match the accepted quote",
    );
  }

  const receipt = `CRM quote receipt ${acceptedQuote.quoteId}`;
  const acceptedLines = scopeLines(acceptedQuote.lineItems);
  let memoryScope = [...store.scopes.values()].find(
    (scope) => scope.dealId === input.dealId && scope.terms === receipt,
  );
  if (!memoryScope) {
    memoryScope = {
      scopeId: crypto.randomUUID(),
      clientId: demoClient.clientId,
      dealId: input.dealId,
      title: `Accepted scope v${acceptedQuote.version}`,
      value: acceptedQuote.quoteValue,
      terms: receipt,
      periodStart: new Date().toISOString().slice(0, 10),
      periodEnd: null,
      status: "active",
      marginAtSalePct: acceptedQuote.marginPct,
      lines: acceptedLines.map((line) => ({
        label: line.label,
        qty: line.quantity,
        unitSell: line.unitPrice,
        unitCost: line.internalCost,
        isVendor: line.isVendor,
      })),
    };
    store.scopes.set(memoryScope.scopeId, memoryScope);
    fired.push("scope.create");
  } else {
    fired.push("scope.exists");
  }
  if (
    memoryScope.clientId !== demoClient.clientId ||
    !sameScopeLines(
      acceptedLines,
      memoryScope.lines.map((line) => ({
        label: line.label,
        quantity: line.qty,
        unitPrice: line.unitSell,
        internalCost: line.unitCost,
      })),
    )
  ) {
    return handoverIncomplete(
      fired,
      ["scope.deliverables"],
      "Stored scope deliverables do not match the accepted quote receipt",
    );
  }
  fired.push("scope.deliverables_ready");
  fired.push("onboarding.seed");

  const phases = store.onboarding.get(demoClient.clientId) ?? [];
  const creative = store.seedWonCreativeTask({
    clientId: demoClient.clientId,
    title: `${demoClient.name} — ${acceptedLines[0]!.label}`,
    ownerEmployeeId: input.actorEmployeeId ?? null,
  });
  if (creative) fired.push("creative.task_seed");
  if (phases.length === 0 || !creative) {
    return handoverIncomplete(fired, [
      ...(phases.length === 0 ? ["onboarding.phases"] : []),
      ...(!creative ? ["delivery.initial_task"] : []),
    ]);
  }

  let calendarId: string | null;
  try {
    const month = new Date().toISOString().slice(0, 7);
    const existingCalendar = [...store.calendars.values()].find(
      (calendar) =>
        calendar.clientId === demoClient.clientId && calendar.month === month,
    );
    calendarId = existingCalendar?.calendarId ?? crypto.randomUUID();
    if (!existingCalendar) {
      const shoot = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
      store.calendars.set(calendarId, {
        calendarId,
        clientId: demoClient.clientId,
        month,
        focusPoints: ["Launch reel", "Product stills"],
        refApprovalState: "pending",
        finalApprovalState: null,
        shootDate: shoot,
        state: "ref_pending",
        slots: [
          {
            calendarSlotId: crypto.randomUUID(),
            calendarId,
            slotDate: shoot,
            slotLabel: "Studio shoot",
            taskId: creative.taskId,
            position: 1,
          },
        ],
      });
    }
    creative.calendarId = calendarId;
    store.tasks.set(creative.taskId, creative);
    fired.push(existingCalendar ? "calendar.exists" : "calendar.seed");
  } catch {
    calendarId = null;
    fired.push("calendar.failed");
  }

  let campaignItemId: string | null;
  try {
    const { createCampaignDraft, listCampaigns } =
      await import("../campaigns/repository");
    const existingCampaign = (
      await listCampaigns({
        clientId: demoClient.clientId,
      })
    ).find((campaign) => campaign.body.kind === "won_handover_seed");
    const draft =
      existingCampaign ??
      (await createCampaignDraft({
        title: `${demoClient.name} — launch LinkedIn teaser`,
        channel: "linkedin",
        scheduledFor: new Date().toISOString().slice(0, 10),
        clientId: demoClient.clientId,
        body: {
          copy: `Excited to partner with ${demoClient.name} on creative that converts across the UAE.`,
          kind: "won_handover_seed",
          mode: "memory",
        },
      }));
    campaignItemId = draft.campaignItemId;
    fired.push(
      existingCampaign ? "campaign.draft_exists" : "campaign.draft_seed",
    );
  } catch {
    campaignItemId = null;
    fired.push("campaign.draft_failed");
  }

  let invoiceId: string | null;
  try {
    const { vatOnAmount } = await import("../demo-store");
    const period = new Date().toISOString().slice(0, 7);
    const existing = [...store.invoices.values()].find(
      (inv) =>
        inv.clientId === demoClient.clientId &&
        inv.billingKind === "first" &&
        inv.period === period,
    );
    if (existing) {
      if (!sameMoney(existing.amount, acceptedQuote.quoteValue)) {
        return handoverIncomplete(
          fired,
          ["invoice.amount"],
          "Existing first invoice does not match the accepted quote",
        );
      }
      invoiceId = existing.invoiceId;
      fired.push("invoice.exists");
    } else {
      const amountNum = Number(acceptedQuote.quoteValue);
      const amount = Number.isFinite(amountNum) ? amountNum : 0;
      invoiceId = crypto.randomUUID();
      store.invoices.set(invoiceId, {
        invoiceId,
        status: "proposed",
        contactName: demoClient.name,
        amount: amount.toFixed(2),
        vatAmount: vatOnAmount(amount),
        currency: "AED",
        invoiceType: "first",
        billingKind: "first",
        clientId: demoClient.clientId,
        period,
        ...resolveTaxRegistration(),
        ruleCited: "Won deal → first invoice (UAE VAT 5%)",
        sourceAttached: {
          kind: "won_handover",
          dealId: input.dealId,
          companyName: deal.companyName,
          mode: "memory",
        },
        xeroInvoiceId: null,
        proposedByEmployeeId: input.actorEmployeeId ?? null,
        approvedByEmployeeId: null,
        createdAt: new Date().toISOString(),
      });
      fired.push("invoice.first_seed");
    }
  } catch {
    invoiceId = null;
    fired.push("invoice.failed");
  }
  if (!invoiceId) {
    return handoverIncomplete(fired, ["invoice.proposal"]);
  }

  if (needsStageAdvance) {
    const moved = await moveDealStage({
      dealId: input.dealId,
      to: "handover_pack",
      actorEmployeeId: input.actorEmployeeId,
    });
    if (!moved.ok) {
      return handoverIncomplete(fired, ["deal.handover_stage"], moved.reason);
    }
    fired.push("deal.handover_stage");
  }

  let outreachId: string | null;
  try {
    const { listOutreach } = await import("../leadgen/store");
    const existingOutreach = await listOutreach({ dealId: input.dealId });
    const reuse = existingOutreach[0];
    if (reuse) {
      outreachId = reuse.id;
      fired.push("outreach.exists");
    } else {
      const { draftOutreach } = await import("../trpc/leadgen-router");
      const outreach = await draftOutreach({
        dealId: input.dealId,
        channel: "gmail",
        subject: `Creative Harmony × ${deal.companyName}`,
        body: `Hi — following up on ${deal.companyName}. We'd love to share a short creative retainer concept for the UAE market. Shall we book 20 minutes?`,
      });
      outreachId = outreach.id;
      fired.push("outreach.draft");
    }
  } catch {
    fired.push("outreach.failed");
    outreachId = null;
  }

  if (needsStageAdvance) {
    try {
      await persistMemoryChunk({
        sourceType: "note",
        sourceId: demoClient.clientId,
        content: `Handover from won deal ${deal.companyName}: contract ${demoClient.contractValue} AED. Client entering onboarding (memory mode).${
          invoiceId ? ` First invoice ${invoiceId} proposed.` : ""
        }${outreachId ? ` Outreach draft ${outreachId}.` : ""}`,
        metadata: {
          clientId: demoClient.clientId,
          dealId: input.dealId,
          invoiceId,
          outreachId,
          kind: "deal.won_handover",
          mode: "memory",
        },
      });
      fired.push("memory.handover");
    } catch {
      fired.push("memory.handover_failed");
    }
  } else {
    fired.push("memory.handover_exists");
  }

  const portalInvite: HandoverPackResult["portalInvite"] = null;
  fired.push("portal.invite_pending_approval");

  if (needsStageAdvance) {
    try {
      const { notifyEmployee } = await import("../notifications/store");
      await notifyEmployee({
        employeeId: input.actorEmployeeId ?? DEMO_STAFF_LEAD_ID,
        title: `Handover ready: ${demoClient.name}`,
        body: `Won deal closed — client onboarding seeded (${phases.length} phases).`,
        kind: "onboarding",
        href: `/clients/${demoClient.clientId}`,
        entityType: "client",
        entityId: demoClient.clientId,
      });
      fired.push("staff.notify");
    } catch {
      fired.push("staff.notify_failed");
    }
  } else {
    fired.push("staff.notify_exists");
  }

  const client = {
    clientId: demoClient.clientId,
    dealId: demoClient.dealId,
    name: demoClient.name,
    market: demoClient.market,
    engagementType: demoClient.engagementType,
    contractValue: demoClient.contractValue,
    lifecycleStatus: demoClient.lifecycleStatus,
  };

  const task = {
    taskId: creative.taskId,
    clientId: creative.clientId,
    calendarId: creative.calendarId,
    month: creative.month,
    taskType: creative.taskType,
    title: creative.title,
    status: creative.status,
    situationalState: creative.situationalState,
    ownerEmployeeId: creative.ownerEmployeeId,
    deadline: creative.deadline,
    priority: creative.priority,
    qcPassed: creative.qcPassed,
    qcNotes: creative.qcNotes,
    clientRevisionCount: creative.clientRevisionCount,
    revisionBoundaryAck: creative.revisionBoundaryAck,
    briefId: creative.briefId,
  };

  const next = buildHandoverNextLinks({
    clientId: client.clientId,
    taskId: task.taskId,
    calendarId,
    invoiceId,
    outreachId,
    campaignItemId,
  });

  return {
    ok: true,
    pack: {
      packId: crypto.randomUUID(),
      dealId: input.dealId,
      clientId: client.clientId,
      scopeId: memoryScope.scopeId,
      sourceQuoteId: acceptedQuote.quoteId,
      scopeDeliverableCount: memoryScope.lines.length,
      invoice: { invoiceId, status: "proposed" },
      fired,
      createdAt: new Date().toISOString(),
    },
    client,
    scopeId: memoryScope.scopeId,
    sourceQuoteId: acceptedQuote.quoteId,
    scopeDeliverableCount: memoryScope.lines.length,
    task,
    invoiceId,
    invoiceStatus: "proposed",
    onboardingPhases: phases.length,
    calendarId,
    portalInvite,
    outreachId,
    campaignItemId,
    next,
  };
}

/**
 * close/won → client + 7-phase onboarding + first creative task (qc) + memory note.
 * Production portal delivery remains a separate Partner/Director action.
 * Uses Postgres when available; otherwise seeds the in-memory demo store so Hunt
 * closed-loop works in CI / local without DATABASE_URL.
 */

export async function durableHandoverPack(input: {
  dealId: string;
  actorEmployeeId?: string | null;
}): Promise<HandoverPackResult | HandoverFailure> {
  const db = getDb();
  if (!db) {
    return memoryHandoverPack(input);
  }

  const deal = await getDeal(input.dealId);
  if (!deal) return { ok: false, reason: "Deal not found" };
  if (deal.closeOutcome !== "won") {
    return {
      ok: false,
      reason: "Deal must be close/won before Handover Pack",
      code: "GATE_BLOCKED",
    };
  }

  const needsStageAdvance = deal.stage === "close";
  if (!needsStageAdvance && deal.stage !== "handover_pack") {
    return {
      ok: false,
      reason: `Unexpected stage ${deal.stage}`,
      code: "GATE_BLOCKED",
    };
  }

  const acceptedQuote = acceptedQuoteForHandover(
    await listQuotesByDeal(input.dealId),
  );
  const readiness = await handoverReadiness(deal, acceptedQuote);
  if (!acceptedQuote || readiness.requiredFailures.length > 0) {
    return handoverIncomplete(
      readiness.completed,
      readiness.requiredFailures,
      "Complete all six handover facts before creating Delivery records",
    );
  }

  const existing = await db.execute<{
    clientId: string;
    dealId: string;
    name: string;
    market: string;
    engagementType: string;
    contractValue: string;
    lifecycleStatus: string;
  }>(sql`
    select
      client_id as "clientId", deal_id as "dealId", name, market,
      engagement_type as "engagementType",
      contract_value::text as "contractValue",
      lifecycle_status as "lifecycleStatus"
    from public.client
    where deal_id = ${input.dealId}::uuid
    limit 1
  `);

  let client = existing[0];
  const fired: string[] = [];

  if (!client) {
    const contractValue = acceptedQuote.quoteValue;
    const rows = await db.execute<{
      clientId: string;
      dealId: string;
      name: string;
      market: string;
      engagementType: string;
      contractValue: string;
      lifecycleStatus: string;
    }>(sql`
      insert into public.client (
        deal_id, name, market, engagement_type, contract_value,
        currency, lifecycle_status, start_date
      ) values (
        ${input.dealId}::uuid,
        ${deal.companyName},
        'UAE'::market_enum,
        'project'::engagement_type_enum,
        ${contractValue},
        'AED',
        'onboarding',
        current_date
      )
      returning
        client_id as "clientId", deal_id as "dealId", name, market,
        engagement_type as "engagementType",
        contract_value::text as "contractValue",
        lifecycle_status as "lifecycleStatus"
    `);
    client = rows[0]!;
    fired.push("client.create");
  } else {
    fired.push("client.exists");
  }
  if (!sameMoney(client.contractValue, acceptedQuote.quoteValue)) {
    return handoverIncomplete(
      fired,
      ["client.contract_value"],
      "Existing client contract value does not match the accepted quote",
    );
  }

  let acceptedScope: AcceptedScope;
  try {
    acceptedScope = await ensureDurableAcceptedScope({
      db,
      clientId: client.clientId,
      dealId: input.dealId,
      quote: acceptedQuote,
    });
    fired.push("scope.ready", "scope.deliverables_ready");
  } catch (error) {
    return handoverIncomplete(
      fired,
      ["scope.deliverables"],
      error instanceof Error
        ? error.message
        : "Accepted quote could not be promoted to delivery scope",
    );
  }

  const phases = await ensureClientOnboarding(client.clientId);
  fired.push("onboarding.seed");

  const task = await seedClientCreativeTask({
    clientId: client.clientId,
    title: `${client.name} — ${acceptedQuote.lineItems[0]!.label.trim()}`,
    taskType: "social_cutdowns",
    status: "qc",
    ownerEmployeeId: input.actorEmployeeId ?? null,
  });
  if (task) fired.push("creative.task_seed");
  if (phases.length === 0 || !task) {
    return handoverIncomplete(fired, [
      ...(phases.length === 0 ? ["onboarding.phases"] : []),
      ...(!task ? ["delivery.initial_task"] : []),
    ]);
  }

  let campaignItemId: string | null = null;
  try {
    const { createCampaignDraft, listCampaigns } =
      await import("../campaigns/repository");
    const existingCampaign = (
      await listCampaigns({
        clientId: client.clientId,
      })
    ).find((campaign) => campaign.body.kind === "won_handover_seed");
    const draft =
      existingCampaign ??
      (await createCampaignDraft({
        title: `${client.name} — launch LinkedIn teaser`,
        channel: "linkedin",
        scheduledFor: new Date().toISOString().slice(0, 10),
        clientId: client.clientId,
        body: {
          copy: `Excited to partner with ${client.name} on creative that converts across the UAE.`,
          kind: "won_handover_seed",
        },
      }));
    campaignItemId = draft.campaignItemId;
    fired.push(
      existingCampaign ? "campaign.draft_exists" : "campaign.draft_seed",
    );
  } catch {
    fired.push("campaign.draft_failed");
  }

  let invoiceId: string | null = null;
  try {
    const { insertOsInvoice, listOsInvoicesForClientPeriod } =
      await import("../finance/os-invoices");
    const { vatOnAmount } = await import("../demo-store");
    const period = new Date().toISOString().slice(0, 7);
    const existingFirst = await listOsInvoicesForClientPeriod({
      clientId: client.clientId,
      period,
      billingKind: "first",
    });
    if (existingFirst[0]) {
      if (!sameMoney(existingFirst[0].amount, acceptedQuote.quoteValue)) {
        return handoverIncomplete(
          fired,
          ["invoice.amount"],
          "Existing first invoice does not match the accepted quote",
        );
      }
      invoiceId = existingFirst[0].invoiceId;
      fired.push("invoice.exists");
    } else {
      const amountNum = Number(acceptedQuote.quoteValue);
      const amount = Number.isFinite(amountNum) ? amountNum : 0;
      const seeded = await insertOsInvoice({
        clientId: client.clientId,
        invoiceType: "first",
        billingKind: "first",
        status: "proposed",
        amount: amount.toFixed(2),
        vatAmount: vatOnAmount(amount),
        currency: "AED",
        period,
        contactName: client.name,
        ...resolveTaxRegistration(),
        ruleCited: "Won deal → first invoice (UAE VAT 5%)",
        sourceAttached: {
          kind: "won_handover",
          dealId: input.dealId,
          companyName: deal.companyName,
        },
        proposedByEmployeeId: input.actorEmployeeId ?? null,
      });
      invoiceId = seeded?.invoiceId ?? null;
      fired.push(invoiceId ? "invoice.first_seed" : "invoice.failed");
    }
  } catch {
    fired.push("invoice.failed");
  }
  if (!invoiceId) {
    return handoverIncomplete(fired, ["invoice.proposal"]);
  }

  if (needsStageAdvance) {
    const moved = await moveDealStage({
      dealId: input.dealId,
      to: "handover_pack",
      actorEmployeeId: input.actorEmployeeId,
    });
    if (!moved.ok) {
      return handoverIncomplete(fired, ["deal.handover_stage"], moved.reason);
    }
    fired.push("deal.handover_stage");
  }

  if (needsStageAdvance) {
    try {
      await persistMemoryChunk({
        sourceType: "note",
        sourceId: client.clientId,
        content: `Handover from won deal ${deal.companyName}: contract ${client.contractValue} AED. Client entering onboarding.${
          invoiceId ? ` First invoice ${invoiceId} proposed.` : ""
        }`,
        metadata: {
          clientId: client.clientId,
          dealId: input.dealId,
          invoiceId,
          kind: "deal.won_handover",
        },
      });
      fired.push("memory.handover");
    } catch {
      fired.push("memory.handover_failed");
    }
  } else {
    fired.push("memory.handover_exists");
  }

  let calendarId: string | null = null;
  try {
    const {
      createDeliveryCalendar,
      addDeliveryCalendarSlot,
      listDeliveryCalendars,
    } = await import("../tasks/delivery-calendars");
    const month = new Date().toISOString().slice(0, 7);
    const [existingCalendar] = await listDeliveryCalendars({
      clientId: client.clientId,
      month,
    });
    const calendar =
      existingCalendar ??
      (await createDeliveryCalendar({
        clientId: client.clientId,
        month,
        focusPoints: ["Launch reel", "Product stills"],
      }));
    calendarId = calendar?.calendarId ?? null;
    if (calendar) {
      fired.push(existingCalendar ? "calendar.exists" : "calendar.seed");
      if (
        task?.taskId &&
        !calendar.slots.some((slot) => slot.taskId === task.taskId)
      ) {
        await addDeliveryCalendarSlot({
          calendarId: calendar.calendarId,
          slotDate: `${month}-15`,
          slotLabel: "Studio shoot",
          taskId: task.taskId,
          position: 1,
        });
        fired.push("calendar.slot");
      }
    } else {
      fired.push("calendar.failed");
    }
  } catch {
    fired.push("calendar.failed");
  }

  const portalInvite: HandoverPackResult["portalInvite"] = null;
  fired.push("portal.invite_pending_approval");

  let outreachId: string | null = null;
  try {
    const { listOutreach } = await import("../leadgen/store");
    const existingOutreach = await listOutreach({ dealId: input.dealId });
    const reuse = existingOutreach[0];
    if (reuse) {
      outreachId = reuse.id;
      fired.push("outreach.exists");
    } else {
      const { draftOutreach } = await import("../trpc/leadgen-router");
      const outreach = await draftOutreach({
        dealId: input.dealId,
        channel: "gmail",
        subject: `Creative Harmony × ${deal.companyName}`,
        body: `Hi — following up on ${deal.companyName}. We'd love to share a short creative retainer concept for the UAE market. Shall we book 20 minutes?`,
      });
      outreachId = outreach.id;
      fired.push("outreach.draft");
    }
  } catch {
    fired.push("outreach.failed");
  }

  if (needsStageAdvance) {
    try {
      const { notifyEmployee } = await import("../notifications/store");
      const { DEMO_STAFF_LEAD_ID } = await import("../demo-store");
      await notifyEmployee({
        employeeId: input.actorEmployeeId ?? DEMO_STAFF_LEAD_ID,
        title: `Handover ready: ${client.name}`,
        body: `Won deal closed — client onboarding seeded (${phases.length} phases).`,
        kind: "onboarding",
        href: `/clients/${client.clientId}`,
        entityType: "client",
        entityId: client.clientId,
      });
      fired.push("staff.notify");
    } catch {
      fired.push("staff.notify_failed");
    }
  } else {
    fired.push("staff.notify_exists");
  }

  const packId = crypto.randomUUID();
  const next = buildHandoverNextLinks({
    clientId: client.clientId,
    taskId: task?.taskId ?? null,
    calendarId,
    invoiceId,
    outreachId,
    campaignItemId,
  });
  return {
    ok: true,
    pack: {
      packId,
      dealId: input.dealId,
      clientId: client.clientId,
      scopeId: acceptedScope.scopeId,
      sourceQuoteId: acceptedScope.sourceQuoteId,
      scopeDeliverableCount: acceptedScope.deliverableCount,
      invoice: { invoiceId, status: "proposed" },
      fired,
      createdAt: new Date().toISOString(),
    },
    client,
    scopeId: acceptedScope.scopeId,
    sourceQuoteId: acceptedScope.sourceQuoteId,
    scopeDeliverableCount: acceptedScope.deliverableCount,
    task,
    invoiceId,
    invoiceStatus: "proposed",
    onboardingPhases: phases.length,
    calendarId,
    portalInvite,
    outreachId,
    campaignItemId,
    next,
  };
}
