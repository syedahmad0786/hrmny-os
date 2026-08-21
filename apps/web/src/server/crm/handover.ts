import { sql } from "@hrmny/db";
import { ensureClientOnboarding } from "../clients/onboarding";
import { getDb } from "../db";
import { persistMemoryChunk } from "../ai/memory-db";
import { seedClientCreativeTask } from "../tasks/delivery-tasks";
import { getDeal, updateDeal, moveDealStage } from "./repository";
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
    portalPath?: string;
    delivery?: { mode: "mock" | "live"; id: string };
  } | null;
  /** Deep links for staff after won → OS. */
  next: {
    client: string;
    account: string;
    creative: string;
    finance: string;
    approvals: string;
    portal: string;
    onboarding: string;
  };
};

/**
 * close/won → client + 7-phase onboarding + first creative task (qc) + memory note.
 */
export async function durableHandoverPack(input: {
  dealId: string;
  actorEmployeeId?: string | null;
}): Promise<HandoverPackResult | { ok: false; reason: string; code?: string }> {
  const db = getDb();
  if (!db) {
    return { ok: false, reason: "DATABASE_URL required for durable handover" };
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
  });
  if (task) fired.push("creative.task_seed");

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
      const sent = await sendPortalInviteMagicLink({
        email: inviteEmail,
        clientId: client.clientId,
        displayName,
        emailer: placeholderInbox ? createResendMock() : undefined,
      });
      portalInvite = {
        ...invited,
        portalPath: sent.portalPath,
        delivery: { mode: sent.delivery.mode, id: sent.delivery.id },
      };
      fired.push(
        sent.delivery.mode === "live"
          ? "portal.invite_live"
          : "portal.invite_mock",
      );
    }
  } catch {
    /* invite optional when unique constraints differ */
  }

  const packId = crypto.randomUUID();
  const next = {
    client: `/clients/${client.clientId}`,
    account: `/account?clientId=${encodeURIComponent(client.clientId)}`,
    creative: `/creative?clientId=${encodeURIComponent(client.clientId)}`,
    finance: invoiceId
      ? `/finance?invoiceId=${encodeURIComponent(invoiceId)}`
      : "/finance",
    approvals: "/approvals",
    portal: "/portal/approvals",
    onboarding: "/portal/onboarding",
  };
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
    next,
  };
}
