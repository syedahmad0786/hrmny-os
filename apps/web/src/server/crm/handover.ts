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

  const packId = crypto.randomUUID();
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
  };
}
