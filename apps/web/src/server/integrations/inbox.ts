import { createHash } from "node:crypto";
import { eq, integrationInbox, sql } from "@hrmny/db";
import { getDb } from "../db";

export type IntegrationReceiptInput = {
  provider: string;
  externalEventId: string;
  operation: string;
  rawBody: string;
  payload?: Record<string, unknown>;
  completed?: boolean;
  status?: "received" | "processing" | "completed";
  result?: Record<string, unknown>;
};

export type IntegrationReceipt = {
  receiptId: string;
  duplicate: boolean;
  status: string;
  result?: Record<string, unknown> | null;
};

const memoryReceipts = new Map<
  string,
  IntegrationReceipt & {
    provider: string;
    externalEventId: string;
    payloadHash: string;
    lastError?: string | null;
  }
>();

export function hashIntegrationPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

/**
 * Record a minimal callback receipt before acknowledging a provider. The
 * provider/event pair is unique, so retries are observable and side-effect
 * free. Payloads should contain only reconciliation metadata, never secrets.
 */
export async function recordIntegrationReceipt(
  input: IntegrationReceiptInput,
): Promise<IntegrationReceipt> {
  const provider = input.provider.trim().toLowerCase();
  const externalEventId = input.externalEventId.trim();
  if (!provider || !externalEventId) {
    throw new Error("INTEGRATION_RECEIPT_ID_REQUIRED");
  }
  const status = input.status ?? (input.completed ? "completed" : "received");
  const payloadHash = hashIntegrationPayload(input.rawBody);
  const db = getDb();
  if (!db) {
    const key = `${provider}:${externalEventId}`;
    const existing = memoryReceipts.get(key);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new Error("INTEGRATION_RECEIPT_PAYLOAD_MISMATCH");
      }
      return {
        receiptId: existing.receiptId,
        duplicate: true,
        status: existing.status,
        result: existing.result ?? null,
      };
    }
    const receipt = {
      receiptId: crypto.randomUUID(),
      duplicate: false,
      status,
      result: input.result ?? null,
      provider,
      externalEventId,
      payloadHash,
    };
    memoryReceipts.set(key, receipt);
    return {
      receiptId: receipt.receiptId,
      duplicate: false,
      status,
      result: receipt.result,
    };
  }

  const inserted = await db
    .insert(integrationInbox)
    .values({
      provider,
      externalEventId,
      operation: input.operation,
      payloadHash,
      payload: input.payload ?? {},
      status,
      attempts: status === "received" ? 0 : 1,
      result: input.result ?? null,
      processedAt: input.completed ? new Date() : null,
    })
    .onConflictDoNothing({
      target: [integrationInbox.provider, integrationInbox.externalEventId],
    })
    .returning({ id: integrationInbox.integrationInboxId });
  if (inserted[0]) {
    return {
      receiptId: inserted[0].id,
      duplicate: false,
      status,
    };
  }

  const rows = await db.execute<{
    integration_inbox_id: string;
    payload_hash: string;
    status: string;
    result: Record<string, unknown> | null;
  }>(sql`
    select integration_inbox_id, payload_hash, status, result
    from public.integration_inbox
    where provider = ${provider}
      and external_event_id = ${externalEventId}
    limit 1
  `);
  const existing = rows[0];
  if (!existing) throw new Error("INTEGRATION_RECEIPT_CONFLICT");
  if (existing.payload_hash !== payloadHash) {
    throw new Error("INTEGRATION_RECEIPT_PAYLOAD_MISMATCH");
  }
  return {
    receiptId: existing.integration_inbox_id,
    duplicate: true,
    status: existing.status,
    result: existing.result,
  };
}

export async function getIntegrationReceipt(
  providerInput: string,
  externalEventIdInput: string,
): Promise<IntegrationReceipt | null> {
  const provider = providerInput.trim().toLowerCase();
  const externalEventId = externalEventIdInput.trim();
  const db = getDb();
  if (!db) {
    const row = memoryReceipts.get(`${provider}:${externalEventId}`);
    return row
      ? {
          receiptId: row.receiptId,
          duplicate: false,
          status: row.status,
          result: row.result ?? null,
        }
      : null;
  }
  const [row] = await db
    .select({
      receiptId: integrationInbox.integrationInboxId,
      status: integrationInbox.status,
      result: integrationInbox.result,
    })
    .from(integrationInbox)
    .where(
      sql`${integrationInbox.provider} = ${provider}
        and ${integrationInbox.externalEventId} = ${externalEventId}`,
    )
    .limit(1);
  return row
    ? {
        receiptId: row.receiptId,
        duplicate: false,
        status: row.status,
        result: row.result,
      }
    : null;
}

export async function completeIntegrationReceipt(
  receiptId: string,
  result: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  if (!db) {
    for (const row of memoryReceipts.values()) {
      if (row.receiptId !== receiptId) continue;
      row.status = "completed";
      row.result = result;
      row.lastError = null;
      return;
    }
    throw new Error("INTEGRATION_RECEIPT_NOT_FOUND");
  }
  const updated = await db
    .update(integrationInbox)
    .set({
      status: "completed",
      result,
      lastError: null,
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(integrationInbox.integrationInboxId, receiptId))
    .returning({ id: integrationInbox.integrationInboxId });
  if (!updated[0]) throw new Error("INTEGRATION_RECEIPT_NOT_FOUND");
}

export async function failIntegrationReceipt(
  receiptId: string,
  lastError: string,
): Promise<void> {
  const safeError = lastError.slice(0, 500);
  const db = getDb();
  if (!db) {
    for (const row of memoryReceipts.values()) {
      if (row.receiptId !== receiptId) continue;
      row.status = "failed";
      row.lastError = safeError;
      return;
    }
    throw new Error("INTEGRATION_RECEIPT_NOT_FOUND");
  }
  const updated = await db
    .update(integrationInbox)
    .set({ status: "failed", lastError: safeError, updatedAt: new Date() })
    .where(eq(integrationInbox.integrationInboxId, receiptId))
    .returning({ id: integrationInbox.integrationInboxId });
  if (!updated[0]) throw new Error("INTEGRATION_RECEIPT_NOT_FOUND");
}

export function resetIntegrationReceiptMemory(): void {
  memoryReceipts.clear();
}
