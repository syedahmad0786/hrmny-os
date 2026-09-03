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
  listActivities,
  listQuotesByDeal,
  updateDeal,
  moveDealStage,
} from "./repository";
import type { DealRow } from "./types";

export type CloseOutcome = "won" | "lost" | "postponed_on_hold";

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
  task: Awaited<ReturnType<typeof seedClientCreativeTask>> | null;
  /** First OS invoice seeded from the won deal quote (sales → billing continuity). */
  invoiceId: string | null;
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
}): Promise<HandoverPackResult | { ok: false; reason: string; code?: string }> {
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
      quoteValue: deal.quoteValue ?? "0",
      internalCost: deal.internalCost ?? "0",
      marginPct: deal.marginPct ?? "0",
      discountPct: deal.discountPct ?? "0",
      discountApprovalTier: null,
      vendorHandlingFeePct: deal.vendorHandlingFeePct ?? "0",
      quoteLines: [],
      ownerEmployeeId: deal.ownerEmployeeId,
      enrichment: null,
      commercialMode: "project",
    });
  fired.push(existing ? "client.exists" : "client.create");
  fired.push("onboarding.seed");

  const phases = store.onboarding.get(demoClient.clientId) ?? [];
  const creative = store.seedWonCreativeTask({
    clientId: demoClient.clientId,
    title: `${demoClient.name} — first creative cutdown`,
    ownerEmployeeId: input.actorEmployeeId ?? null,
  });
  fired.push("creative.task_seed");
  if (phases.length === 0 || !creative) {
    return {
      ok: false,
      reason: "Handover core records are incomplete",
      code: "HANDOVER_INCOMPLETE",
    };
  }
  if (needsStageAdvance) {
    const moved = await moveDealStage({
      dealId: input.dealId,
      to: "handover_pack",
      actorEmployeeId: input.actorEmployeeId,
    });
    if (!moved.ok) return { ok: false, reason: moved.reason };
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
      invoiceId = existing.invoiceId;
      fired.push("invoice.exists");
    } else {
      const amountNum = Number(
        demoClient.contractValue || deal.quoteValue || 0,
      );
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
      fired,
      createdAt: new Date().toISOString(),
    },
    client,
    task,
    invoiceId,
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
}): Promise<HandoverPackResult | { ok: false; reason: string; code?: string }> {
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
    const contractValue = deal.quoteValue ?? "0";
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

  const phases = await ensureClientOnboarding(client.clientId);
  fired.push("onboarding.seed");

  const task = await seedClientCreativeTask({
    clientId: client.clientId,
    title: `${client.name} — first creative cutdown`,
    taskType: "social_cutdowns",
    status: "qc",
    ownerEmployeeId: input.actorEmployeeId ?? null,
  });
  if (task) fired.push("creative.task_seed");
  if (phases.length === 0 || !task) {
    return {
      ok: false,
      reason: "Handover core records are incomplete",
      code: "HANDOVER_INCOMPLETE",
    };
  }
  if (needsStageAdvance) {
    const moved = await moveDealStage({
      dealId: input.dealId,
      to: "handover_pack",
      actorEmployeeId: input.actorEmployeeId,
    });
    if (!moved.ok) return { ok: false, reason: moved.reason };
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
      invoiceId = existingFirst[0].invoiceId;
      fired.push("invoice.exists");
    } else {
      const amountNum = Number(client.contractValue || deal.quoteValue || 0);
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
      fired,
      createdAt: new Date().toISOString(),
    },
    client,
    task,
    invoiceId,
    onboardingPhases: phases.length,
    calendarId,
    portalInvite,
    outreachId,
    campaignItemId,
    next,
  };
}
