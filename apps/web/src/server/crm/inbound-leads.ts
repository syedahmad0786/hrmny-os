import { createHash } from "node:crypto";
import {
  and,
  company,
  contact,
  crmNote,
  deal,
  eq,
  integrationInbox,
} from "@hrmny/db";
import { getDb } from "../db";
import {
  createCompany,
  createContact,
  createDeal,
  createNote,
} from "./repository";

export type InboundLeadInput = {
  provider: string;
  idempotencyKey: string;
  companyName: string;
  contactEmail: string;
  sector?: string;
  message?: string;
  rawBody?: string;
};

export type InboundLeadResult = {
  dealId: string;
  companyName: string;
  sector: string | null;
  stage: string;
  closeOutcome: string | null;
  lostReason: string | null;
  leadSourceLane: "inbound";
  buafBudget: boolean | null;
  buafUrgency: boolean | null;
  buafAccess: boolean | null;
  buafFit: boolean | null;
  buafTemperature: string | null;
  noGoFlags: string[];
  emailVerified: boolean;
  contactEmail: string;
  voiceCheckPassed: boolean;
  quoteValue: string | null;
  internalCost: string | null;
  marginPct: string | null;
  discountPct: string | null;
  discountApprovalTier: string | null;
  vendorHandlingFeePct: string;
  quoteLines: never[];
  ownerEmployeeId: string | null;
  enrichment: { inboundMessage: string } | null;
  commercialMode: "project";
  companyId: string;
  contactId: string;
  durable: boolean;
  duplicate: boolean;
};

const memoryResults = new Map<
  string,
  { payloadHash: string; result: InboundLeadResult }
>();

function payloadHash(input: InboundLeadInput): string {
  return createHash("sha256")
    .update(
      input.rawBody ??
        JSON.stringify({
          companyName: input.companyName,
          contactEmail: input.contactEmail,
          sector: input.sector ?? null,
          message: input.message ?? null,
        }),
    )
    .digest("hex");
}

function resultFromRows(input: InboundLeadInput, rows: {
  companyId: string;
  contactId: string;
  deal: typeof deal.$inferSelect;
  durable: boolean;
  duplicate: boolean;
}): InboundLeadResult {
  const row = rows.deal;
  return {
    dealId: row.dealId,
    companyName: row.companyName,
    sector: row.sector,
    stage: row.stage,
    closeOutcome: row.closeOutcome,
    lostReason: row.lostReason,
    leadSourceLane: "inbound",
    buafBudget: row.buafBudget,
    buafUrgency: row.buafUrgency,
    buafAccess: row.buafAccess,
    buafFit: row.buafFit,
    buafTemperature: row.buafTemperature,
    noGoFlags: [],
    emailVerified: row.emailVerified,
    contactEmail: input.contactEmail,
    voiceCheckPassed: false,
    quoteValue: row.quoteValue,
    internalCost: row.internalCost,
    marginPct: row.marginPct,
    discountPct: row.discountPct,
    discountApprovalTier: row.discountApprovalTier,
    vendorHandlingFeePct: row.vendorHandlingFeePct,
    quoteLines: [],
    ownerEmployeeId: row.ownerEmployeeId,
    enrichment: input.message ? { inboundMessage: input.message } : null,
    commercialMode: "project",
    companyId: rows.companyId,
    contactId: rows.contactId,
    durable: rows.durable,
    duplicate: rows.duplicate,
  };
}

/** One atomic, replay-safe CRM ingress operation. */
export async function createInboundLead(
  input: InboundLeadInput,
): Promise<InboundLeadResult> {
  const provider = input.provider.trim().toLowerCase();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!provider || !idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");

  const db = getDb();
  const inputPayloadHash = payloadHash(input);
  if (!db) {
    const memoryKey = `${provider}:${idempotencyKey}`;
    const existing = memoryResults.get(memoryKey);
    if (existing) {
      if (existing.payloadHash !== inputPayloadHash) {
        throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      return { ...existing.result, duplicate: true };
    }
    const companyRow = await createCompany({
      name: input.companyName,
      sector: input.sector ?? null,
      market: "UAE",
    });
    const contactRow = await createContact({
      companyId: companyRow.companyId,
      firstName: input.contactEmail.split("@")[0] ?? "Inbound",
      email: input.contactEmail,
      isPrimary: true,
    });
    const dealRow = await createDeal({
      companyName: companyRow.name,
      companyId: companyRow.companyId,
      primaryContactId: contactRow.contactId,
      sector: input.sector ?? null,
      leadSourceLane: "inbound",
    });
    if (input.message?.trim()) {
      await createNote({
        dealId: dealRow.dealId,
        companyId: companyRow.companyId,
        contactId: contactRow.contactId,
        body: input.message.trim(),
      });
    }
    const result = resultFromRows(input, {
      companyId: companyRow.companyId,
      contactId: contactRow.contactId,
      deal: dealRow as unknown as typeof deal.$inferSelect,
      durable: false,
      duplicate: false,
    });
    memoryResults.set(memoryKey, { payloadHash: inputPayloadHash, result });
    return result;
  }

  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(integrationInbox)
      .values({
        provider,
        externalEventId: idempotencyKey,
        operation: "crm.lead.inbound.create",
        payloadHash: inputPayloadHash,
        payload: {
          companyName: input.companyName,
          contactEmail: input.contactEmail,
          sector: input.sector ?? null,
        },
        status: "processing",
        attempts: 1,
      })
      .onConflictDoNothing({
        target: [
          integrationInbox.provider,
          integrationInbox.externalEventId,
        ],
      })
      .returning({ id: integrationInbox.integrationInboxId });

    if (!claimed[0]) {
      const existing = await tx
        .select({
          payloadHash: integrationInbox.payloadHash,
          status: integrationInbox.status,
          result: integrationInbox.result,
        })
        .from(integrationInbox)
        .where(
          and(
            eq(integrationInbox.provider, provider),
            eq(integrationInbox.externalEventId, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing[0]?.payloadHash !== inputPayloadHash) {
        throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      if (existing[0]?.status === "completed" && existing[0].result) {
        return {
          ...(existing[0].result as unknown as InboundLeadResult),
          duplicate: true,
        };
      }
      throw new Error("INBOUND_EVENT_ALREADY_PROCESSING");
    }

    const [companyRow] = await tx
      .insert(company)
      .values({
        name: input.companyName,
        sector: input.sector ?? null,
        market: "UAE",
      })
      .returning();
    const [contactRow] = await tx
      .insert(contact)
      .values({
        companyId: companyRow!.companyId,
        firstName: input.contactEmail.split("@")[0] ?? "Inbound",
        email: input.contactEmail,
        isPrimary: true,
      })
      .returning();
    const [dealRow] = await tx
      .insert(deal)
      .values({
        companyName: companyRow!.name,
        companyId: companyRow!.companyId,
        primaryContactId: contactRow!.contactId,
        sector: input.sector ?? null,
        leadSourceLane: "inbound",
      })
      .returning();
    if (input.message?.trim()) {
      await tx.insert(crmNote).values({
        dealId: dealRow!.dealId,
        companyId: companyRow!.companyId,
        contactId: contactRow!.contactId,
        body: input.message.trim(),
      });
    }

    const result = resultFromRows(input, {
      companyId: companyRow!.companyId,
      contactId: contactRow!.contactId,
      deal: dealRow!,
      durable: true,
      duplicate: false,
    });
    await tx
      .update(integrationInbox)
      .set({
        status: "completed",
        result: result as unknown as Record<string, unknown>,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(integrationInbox.integrationInboxId, claimed[0].id));
    return result;
  });
}

export function resetInboundLeadMemory(): void {
  memoryResults.clear();
}
