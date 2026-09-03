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
  ownerEmployeeId?: string | null;
  credentialConnectionAccountId?: string | null;
};

export type IntegrationReceipt = {
  receiptId: string;
  duplicate: boolean;
  status: string;
  operation?: string;
  payload?: Record<string, unknown>;
  payloadHash?: string;
  attempts?: number;
  stateVersion?: number;
  attemptToken?: string | null;
  attemptLeaseExpiresAt?: Date | string | null;
  ownerEmployeeId?: string | null;
  credentialConnectionAccountId?: string | null;
  result?: Record<string, unknown> | null;
  lastError?: string | null;
};

const memoryReceipts = new Map<
  string,
  IntegrationReceipt & {
    provider: string;
    externalEventId: string;
    operation: string;
    payload: Record<string, unknown>;
    payloadHash: string;
    attempts: number;
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
        operation: existing.operation,
        payload: existing.payload,
        payloadHash: existing.payloadHash,
        attempts: existing.attempts,
        stateVersion: existing.stateVersion,
        attemptToken: existing.attemptToken,
        attemptLeaseExpiresAt: existing.attemptLeaseExpiresAt,
        ownerEmployeeId: existing.ownerEmployeeId,
        credentialConnectionAccountId: existing.credentialConnectionAccountId,
        result: existing.result ?? null,
        lastError: existing.lastError ?? null,
      };
    }
    const receipt = {
      receiptId: crypto.randomUUID(),
      duplicate: false,
      status,
      result: input.result ?? null,
      provider,
      externalEventId,
      operation: input.operation,
      payload: input.payload ?? {},
      payloadHash,
      attempts: status === "received" ? 0 : 1,
      stateVersion: 0,
      attemptToken: null,
      attemptLeaseExpiresAt: null,
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      credentialConnectionAccountId:
        input.credentialConnectionAccountId ?? null,
    };
    memoryReceipts.set(key, receipt);
    return {
      receiptId: receipt.receiptId,
      duplicate: false,
      status,
      operation: input.operation,
      payload: input.payload ?? {},
      payloadHash,
      attempts: receipt.attempts,
      stateVersion: receipt.stateVersion,
      attemptToken: receipt.attemptToken,
      attemptLeaseExpiresAt: receipt.attemptLeaseExpiresAt,
      ownerEmployeeId: receipt.ownerEmployeeId,
      credentialConnectionAccountId: receipt.credentialConnectionAccountId,
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
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      credentialConnectionAccountId:
        input.credentialConnectionAccountId ?? null,
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
      operation: input.operation,
      payload: input.payload ?? {},
      payloadHash,
      attempts: status === "received" ? 0 : 1,
      stateVersion: 0,
      attemptToken: null,
      attemptLeaseExpiresAt: null,
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      credentialConnectionAccountId:
        input.credentialConnectionAccountId ?? null,
    };
  }

  const rows = await db.execute<{
    integration_inbox_id: string;
    payload_hash: string;
    status: string;
    operation: string;
    payload: Record<string, unknown>;
    attempts: number;
    result: Record<string, unknown> | null;
    last_error: string | null;
    state_version: number;
    attempt_token: string | null;
    attempt_lease_expires_at: Date | string | null;
    owner_employee_id: string | null;
    credential_connection_account_id: string | null;
  }>(sql`
    select integration_inbox_id, payload_hash, status, operation, payload,
           attempts, result, last_error, state_version, attempt_token,
           attempt_lease_expires_at, owner_employee_id,
           credential_connection_account_id
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
    operation: existing.operation,
    payload: existing.payload,
    payloadHash: existing.payload_hash,
    attempts: existing.attempts,
    result: existing.result,
    lastError: existing.last_error,
    stateVersion: existing.state_version,
    attemptToken: existing.attempt_token,
    attemptLeaseExpiresAt: existing.attempt_lease_expires_at,
    ownerEmployeeId: existing.owner_employee_id,
    credentialConnectionAccountId: existing.credential_connection_account_id,
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
          operation: row.operation,
          payload: row.payload,
          payloadHash: row.payloadHash,
          attempts: row.attempts,
          stateVersion: row.stateVersion,
          attemptToken: row.attemptToken,
          attemptLeaseExpiresAt: row.attemptLeaseExpiresAt,
          ownerEmployeeId: row.ownerEmployeeId,
          credentialConnectionAccountId: row.credentialConnectionAccountId,
          result: row.result ?? null,
          lastError: row.lastError ?? null,
        }
      : null;
  }
  const [row] = await db
    .select({
      receiptId: integrationInbox.integrationInboxId,
      status: integrationInbox.status,
      operation: integrationInbox.operation,
      payload: integrationInbox.payload,
      payloadHash: integrationInbox.payloadHash,
      attempts: integrationInbox.attempts,
      stateVersion: integrationInbox.stateVersion,
      attemptToken: integrationInbox.attemptToken,
      attemptLeaseExpiresAt: integrationInbox.attemptLeaseExpiresAt,
      ownerEmployeeId: integrationInbox.ownerEmployeeId,
      credentialConnectionAccountId:
        integrationInbox.credentialConnectionAccountId,
      result: integrationInbox.result,
      lastError: integrationInbox.lastError,
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
        operation: row.operation,
        payload: row.payload,
        payloadHash: row.payloadHash,
        attempts: row.attempts,
        stateVersion: row.stateVersion,
        attemptToken: row.attemptToken,
        attemptLeaseExpiresAt: row.attemptLeaseExpiresAt,
        ownerEmployeeId: row.ownerEmployeeId,
        credentialConnectionAccountId: row.credentialConnectionAccountId,
        result: row.result,
        lastError: row.lastError,
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
      row.stateVersion = (row.stateVersion ?? 0) + 1;
      row.attemptToken = null;
      row.attemptLeaseExpiresAt = null;
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
      stateVersion: sql`${integrationInbox.stateVersion} + 1`,
      attemptToken: null,
      attemptLeaseExpiresAt: null,
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
      row.stateVersion = (row.stateVersion ?? 0) + 1;
      row.attemptToken = null;
      row.attemptLeaseExpiresAt = null;
      return;
    }
    throw new Error("INTEGRATION_RECEIPT_NOT_FOUND");
  }
  const updated = await db
    .update(integrationInbox)
    .set({
      status: "failed",
      lastError: safeError,
      stateVersion: sql`${integrationInbox.stateVersion} + 1`,
      attemptToken: null,
      attemptLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(integrationInbox.integrationInboxId, receiptId))
    .returning({ id: integrationInbox.integrationInboxId });
  if (!updated[0]) throw new Error("INTEGRATION_RECEIPT_NOT_FOUND");
}

export async function updateIntegrationReceiptProgress(
  receiptId: string,
  input: {
    status: "received" | "processing" | "completed" | "failed";
    result?: Record<string, unknown> | null;
    lastError?: string | null;
    processed?: boolean;
  },
): Promise<void> {
  const safeError = input.lastError?.slice(0, 500) ?? null;
  const db = getDb();
  if (!db) {
    for (const row of memoryReceipts.values()) {
      if (row.receiptId !== receiptId) continue;
      row.status = input.status;
      row.result = input.result ?? null;
      row.lastError = safeError;
      row.stateVersion = (row.stateVersion ?? 0) + 1;
      row.attemptToken = null;
      row.attemptLeaseExpiresAt = null;
      return;
    }
    throw new Error("INTEGRATION_RECEIPT_NOT_FOUND");
  }
  const updated = await db
    .update(integrationInbox)
    .set({
      status: input.status,
      result: input.result ?? null,
      lastError: safeError,
      processedAt: input.processed ? new Date() : null,
      stateVersion: sql`${integrationInbox.stateVersion} + 1`,
      attemptToken: null,
      attemptLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(integrationInbox.integrationInboxId, receiptId))
    .returning({ id: integrationInbox.integrationInboxId });
  if (!updated[0]) throw new Error("INTEGRATION_RECEIPT_NOT_FOUND");
}

/**
 * Compare-and-set a receipt transition so a stale worker cannot overwrite a
 * terminal outcome chosen by another worker or an administrator.
 */
export async function transitionIntegrationReceiptProgress(
  receiptId: string,
  expected: {
    status: "received" | "processing" | "completed" | "failed";
    bridgeStatus?: string;
    attemptToken?: string;
    stateVersion?: number;
  },
  input: {
    status: "received" | "processing" | "completed" | "failed";
    result?: Record<string, unknown> | null;
    lastError?: string | null;
    processed?: boolean;
  },
): Promise<boolean> {
  const safeError = input.lastError?.slice(0, 500) ?? null;
  const db = getDb();
  if (!db) {
    for (const row of memoryReceipts.values()) {
      if (row.receiptId !== receiptId) continue;
      if (row.status !== expected.status) return false;
      if (
        expected.bridgeStatus &&
        row.result?.bridgeStatus !== expected.bridgeStatus
      ) {
        return false;
      }
      if (expected.attemptToken && row.attemptToken !== expected.attemptToken) {
        return false;
      }
      if (
        expected.stateVersion !== undefined &&
        row.stateVersion !== expected.stateVersion
      ) {
        return false;
      }
      row.status = input.status;
      row.result = input.result ?? null;
      row.lastError = safeError;
      row.stateVersion = (row.stateVersion ?? 0) + 1;
      row.attemptToken = null;
      row.attemptLeaseExpiresAt = null;
      return true;
    }
    return false;
  }
  const updated = await db
    .update(integrationInbox)
    .set({
      status: input.status,
      result: input.result ?? null,
      lastError: safeError,
      processedAt: input.processed ? new Date() : null,
      stateVersion: sql`${integrationInbox.stateVersion} + 1`,
      attemptToken: null,
      attemptLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      sql`${integrationInbox.integrationInboxId} = ${receiptId}::uuid
        and ${integrationInbox.status} = ${expected.status}
        and (
          ${expected.bridgeStatus ?? null}::text is null
          or ${integrationInbox.result} ->> 'bridgeStatus' = ${expected.bridgeStatus ?? null}
        )
        and (
          ${expected.attemptToken ?? null}::text is null
          or ${integrationInbox.attemptToken} = ${expected.attemptToken ?? null}::uuid
        )
        and (
          ${expected.stateVersion ?? null}::integer is null
          or ${integrationInbox.stateVersion} = ${expected.stateVersion ?? null}
        )`,
    )
    .returning({ id: integrationInbox.integrationInboxId });
  return Boolean(updated[0]);
}

/**
 * Claim one queued retry against the existing request receipt. The update is
 * atomic in PostgreSQL and refuses terminal or over-budget operations.
 */
export async function beginIntegrationReceiptAttempt(
  receiptId: string,
  maxAttempts: number,
  leaseExpiresAt = new Date(Date.now() + 10 * 60_000),
  attemptTokenInput?: string,
): Promise<{ attempts: number; attemptToken: string } | null> {
  const attemptToken = attemptTokenInput ?? crypto.randomUUID();
  const db = getDb();
  if (!db) {
    for (const row of memoryReceipts.values()) {
      if (row.receiptId !== receiptId) continue;
      if (
        row.status !== "processing" ||
        row.result?.bridgeStatus !== "retry_scheduled" ||
        row.attempts >= maxAttempts
      ) {
        return null;
      }
      row.attempts += 1;
      row.stateVersion = (row.stateVersion ?? 0) + 1;
      row.attemptToken = attemptToken;
      row.attemptLeaseExpiresAt = leaseExpiresAt;
      row.result = {
        ...(row.result ?? {}),
        bridgeStatus: "processing",
      };
      return { attempts: row.attempts, attemptToken };
    }
    return null;
  }
  const rows = await db.execute<{ attempts: number }>(sql`
    update public.integration_inbox
    set attempts = attempts + 1,
        state_version = state_version + 1,
        attempt_token = ${attemptToken}::uuid,
        attempt_lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
        result = coalesce(result, '{}'::jsonb)
          || jsonb_build_object(
            'bridgeStatus', 'processing'
          ),
        updated_at = now()
    where integration_inbox_id = ${receiptId}::uuid
      and status = 'processing'
      and result ->> 'bridgeStatus' = 'retry_scheduled'
      and attempts < ${maxAttempts}
    returning attempts
  `);
  return rows[0] ? { attempts: Number(rows[0].attempts), attemptToken } : null;
}

/** Do not overwrite a request that was revoked while the provider was in flight. */
export async function completeIntegrationReceiptIfProcessing(
  receiptId: string,
  attemptToken: string,
  result: Record<string, unknown>,
): Promise<boolean> {
  const db = getDb();
  if (!db) {
    for (const row of memoryReceipts.values()) {
      if (row.receiptId !== receiptId) continue;
      if (
        row.status !== "processing" ||
        row.result?.bridgeStatus !== "processing" ||
        row.attemptToken !== attemptToken
      ) {
        return false;
      }
      row.status = "completed";
      row.result = result;
      row.lastError = null;
      row.stateVersion = (row.stateVersion ?? 0) + 1;
      row.attemptToken = null;
      row.attemptLeaseExpiresAt = null;
      return true;
    }
    return false;
  }
  const updated = await db
    .update(integrationInbox)
    .set({
      status: "completed",
      result,
      lastError: null,
      processedAt: new Date(),
      stateVersion: sql`${integrationInbox.stateVersion} + 1`,
      attemptToken: null,
      attemptLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      sql`${integrationInbox.integrationInboxId} = ${receiptId}::uuid
        and ${integrationInbox.status} = 'processing'
        and ${integrationInbox.result} ->> 'bridgeStatus' = 'processing'
        and ${integrationInbox.attemptToken} = ${attemptToken}::uuid`,
    )
    .returning({ id: integrationInbox.integrationInboxId });
  return Boolean(updated[0]);
}

export function resetIntegrationReceiptMemory(): void {
  memoryReceipts.clear();
}
