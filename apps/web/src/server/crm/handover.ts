import { sql } from "@hrmny/db";
import { ensureClientOnboarding } from "../clients/onboarding";
import { getDb } from "../db";
import { persistMemoryChunk } from "../ai/memory-db";
import { seedClientCreativeTask } from "../tasks/delivery-tasks";
import { buildHandoverNextLinks } from "./handover-next";
import { getDeal, getContact, updateDeal, moveDealStage } from "./repository";
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
  | { ok: true; deal: DealRow }
  | { ok: false; reason: string; code?: string }
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

  let stage = existing.stage;
  if (stage === "price_cost") {
    const moved = await moveDealStage({
      dealId: input.dealId,
      to: "close",
      actorEmployeeId: input.actorEmployeeId,
    });
    if (!moved.ok) return { ok: false, reason: moved.reason };
    stage = "close";
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
  /** Portal user + magic-link invite (mock for @example.com). */
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
  };
};

/**
 * Memory-mode won → OS: demo-store client + onboarding + creative QC task +
 * portal magic links + staff notify. Keeps Hunt closed-loop green without Postgres.
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

  if (deal.stage === "close") {
    const moved = await moveDealStage({
      dealId: input.dealId,
      to: "handover_pack",
      actorEmployeeId: input.actorEmployeeId,
    });
    if (!moved.ok) return { ok: false, reason: moved.reason };
  } else if (deal.stage !== "handover_pack") {
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

  let invoiceId: string | null = null;
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
        trn: "100000000000003",
        trnStatus: "known",
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
  }

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
    outreachId = null;
  }

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
  }).catch(() => undefined);
  fired.push("memory.handover");

  let portalInvite: HandoverPackResult["portalInvite"] = null;
  try {
    const inviteEmail =
      contactEmail || `portal+${demoClient.clientId.slice(0, 8)}@example.com`;
    const displayName = `${demoClient.name} Portal`;
    const { sendPortalInviteMagicLink } = await import(
      "../auth/portal-magic-link"
    );
    const { createResendMock } = await import("@hrmny/integrations");
    const emailer = createResendMock();
    const sentPortal = await sendPortalInviteMagicLink({
      email: inviteEmail,
      clientId: demoClient.clientId,
      displayName,
      next: "/portal/approvals",
      emailer,
    });
    const sentOnboarding = await sendPortalInviteMagicLink({
      email: inviteEmail,
      clientId: demoClient.clientId,
      displayName,
      next: "/portal/onboarding",
      emailer,
    });
    portalInvite = {
      portalUserId: crypto.randomUUID(),
      email: inviteEmail,
      portalPath: sentPortal.portalPath,
      onboardingPath: sentOnboarding.portalPath,
      delivery: {
        mode: sentPortal.delivery.mode,
        id: sentPortal.delivery.id,
      },
    };
    fired.push("portal.invite_mock");
    fired.push("portal.invite_onboarding");
  } catch {
    fired.push("portal.invite_failed");
  }

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
    invoiceId,
    outreachId,
    portalPath: portalInvite?.portalPath,
    onboardingPath: portalInvite?.onboardingPath,
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
    calendarId: null,
    portalInvite,
    outreachId,
    next,
  };
}

/**
 * close/won → client + 7-phase onboarding + first creative task (qc) + memory note.
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

  if (deal.stage === "close") {
    const moved = await moveDealStage({
      dealId: input.dealId,
      to: "handover_pack",
      actorEmployeeId: input.actorEmployeeId,
    });
    if (!moved.ok) return { ok: false, reason: moved.reason };
  } else if (deal.stage !== "handover_pack") {
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

  try {
    const { createCampaignDraft } = await import("../campaigns/repository");
    await createCampaignDraft({
      title: `${client.name} — launch LinkedIn teaser`,
      channel: "linkedin",
      scheduledFor: new Date().toISOString().slice(0, 10),
      clientId: client.clientId,
      body: {
        copy: `Excited to partner with ${client.name} on creative that converts across the UAE.`,
        kind: "won_handover_seed",
      },
    });
    fired.push("campaign.draft_seed");
  } catch {
    /* campaign seed best-effort — portal campaign-approvals can draft manually */
  }

  let invoiceId: string | null = null;
  try {
    const { insertOsInvoice, listOsInvoicesForClientPeriod } = await import(
      "../finance/os-invoices"
    );
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
        trn: "100000000000003",
        trnStatus: "known",
        ruleCited: "Won deal → first invoice (UAE VAT 5%)",
        sourceAttached: {
          kind: "won_handover",
          dealId: input.dealId,
          companyName: deal.companyName,
        },
        proposedByEmployeeId: input.actorEmployeeId ?? null,
      });
      invoiceId = seeded?.invoiceId ?? null;
      if (invoiceId) fired.push("invoice.first_seed");
    }
  } catch {
    /* invoice seed best-effort — billing UI can draft manually */
  }

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

  let calendarId: string | null = null;
  try {
    const { createDeliveryCalendar, addDeliveryCalendarSlot } = await import(
      "../tasks/delivery-calendars"
    );
    const month = new Date().toISOString().slice(0, 7);
    const calendar = await createDeliveryCalendar({
      clientId: client.clientId,
      month,
      focusPoints: ["Launch reel", "Product stills"],
    });
    calendarId = calendar?.calendarId ?? null;
    if (calendar) {
      fired.push("calendar.seed");
      if (task?.taskId) {
        await addDeliveryCalendarSlot({
          calendarId: calendar.calendarId,
          slotDate: `${month}-15`,
          slotLabel: "Studio shoot",
          taskId: task.taskId,
          position: 1,
        });
        fired.push("calendar.slot");
      }
    }
  } catch {
    /* calendar optional if schema missing columns on older DBs */
  }

  let portalInvite: HandoverPackResult["portalInvite"] = null;
  try {
    const { getContact } = await import("./repository");
    const contact = deal.primaryContactId
      ? await getContact(deal.primaryContactId)
      : null;
    const inviteEmail =
      contact?.email?.trim().toLowerCase() ||
      `portal+${client.clientId.slice(0, 8)}@example.com`;
    const displayName =
      [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ||
      `${client.name} Portal`;
    const existingPortal = await db.execute<{
      portalUserId: string;
      email: string;
    }>(sql`
      select client_portal_user_id as "portalUserId", email
      from public.client_portal_user
      where client_id = ${client.clientId}::uuid
        and lower(email) = ${inviteEmail}
      limit 1
    `);
    let invited = existingPortal[0] ?? null;
    if (invited) {
      await db.execute(sql`
        update public.client_portal_user
        set is_active = true, display_name = ${displayName},
            updated_at = now()
        where client_portal_user_id = ${invited.portalUserId}::uuid
      `);
      fired.push("portal.user_exists");
    } else {
      const created = await db.execute<{
        portalUserId: string;
        email: string;
      }>(sql`
        insert into public.client_portal_user (
          client_id, email, display_name, is_active
        ) values (
          ${client.clientId}::uuid,
          ${inviteEmail},
          ${displayName},
          true
        )
        returning client_portal_user_id as "portalUserId", email
      `);
      invited = created[0] ?? null;
      if (invited) fired.push("portal.user_create");
    }
    if (invited) {
      const { sendPortalInviteMagicLink } = await import(
        "../auth/portal-magic-link"
      );
      const placeholderInbox = inviteEmail.endsWith("@example.com");
      const { createResendMock } = await import("@hrmny/integrations");
      // Two single-use tokens so Portal and Onboarding CTAs do not race.
      // Live email only for the approvals invite; onboarding stays mock-delivered.
      const emailer = placeholderInbox ? createResendMock() : undefined;
      const sentPortal = await sendPortalInviteMagicLink({
        email: inviteEmail,
        clientId: client.clientId,
        displayName,
        next: "/portal/approvals",
        emailer,
      });
      const sentOnboarding = await sendPortalInviteMagicLink({
        email: inviteEmail,
        clientId: client.clientId,
        displayName,
        next: "/portal/onboarding",
        emailer: createResendMock(),
      });
      portalInvite = {
        ...invited,
        portalPath: sentPortal.portalPath,
        onboardingPath: sentOnboarding.portalPath,
        delivery: {
          mode: sentPortal.delivery.mode,
          id: sentPortal.delivery.id,
        },
      };
      fired.push(
        sentPortal.delivery.mode === "live"
          ? "portal.invite_live"
          : "portal.invite_mock",
      );
      fired.push("portal.invite_onboarding");
    }
  } catch {
    fired.push("portal.invite_failed");
  }

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

  const packId = crypto.randomUUID();
  const next = buildHandoverNextLinks({
    clientId: client.clientId,
    invoiceId,
    outreachId,
    portalPath: portalInvite?.portalPath,
    onboardingPath: portalInvite?.onboardingPath,
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
    next,
  };
}
