import { createHash } from "node:crypto";
import { integrationInbox, sql } from "@hrmny/db";
import { getDb } from "../db";

export type IntegrationReceiptInput = {
  provider: string;
  externalEventId: string;
  operation: string;
  rawBody: string;
  payload?: Record<string, unknown>;
  completed?: boolean;
  result?: Record<string, unknown>;
};

export type IntegrationReceipt = {
  receiptId: string;
  duplicate: boolean;
  status: string;
};

const memoryReceipts = new Map<
  string,
  IntegrationReceipt & { payloadHash: string }
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
  const status = input.completed ? "completed" : "received";
  const payloadHash = hashIntegrationPayload(input.rawBody);
  const db = getDb();
  if (!db) {
    const key = `${provider}:${externalEventId}`;
    const existing = memoryReceipts.get(key);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new Error("INTEGRATION_RECEIPT_PAYLOAD_MISMATCH");
      }
      return { ...existing, duplicate: true };
    }
    const receipt = {
      receiptId: crypto.randomUUID(),
      duplicate: false,
      status,
      payloadHash,
    };
    memoryReceipts.set(key, receipt);
    return receipt;
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
      attempts: input.completed ? 1 : 0,
      result: input.result ?? null,
      processedAt: input.completed ? new Date() : null,
    })
    .onConflictDoNothing({
      target: [
        integrationInbox.provider,
        integrationInbox.externalEventId,
      ],
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
  }>(sql`
    select integration_inbox_id, payload_hash, status
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
  };
}

export function resetIntegrationReceiptMemory(): void {
  memoryReceipts.clear();
}
