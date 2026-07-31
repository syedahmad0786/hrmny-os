import {
  and,
  auditEvent,
  desc,
  eq,
  healthSignal,
  ilike,
  scheduledJob,
} from "@hrmny/db";
import { getDb } from "./db";
import { getDemoStore } from "./demo-store";

const SYSTEM_EMPLOYEE_ID = "00000000-0000-4000-8000-000000000000";

export type AuditInput = {
  actorEmployeeId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
};

export async function writeAudit(input: AuditInput) {
  const db = getDb();
  if (!db) {
    return getDemoStore().appendAudit({
      ...input,
      actorEmployeeId: input.actorEmployeeId ?? SYSTEM_EMPLOYEE_ID,
      entityId: input.entityId ?? SYSTEM_EMPLOYEE_ID,
    });
  }
  const [row] = await db.insert(auditEvent).values(input).returning();
  return { ...row!, createdAt: row!.createdAt.toISOString() };
}

export async function listAudit(input: {
  limit: number;
  action?: string;
  entityType?: string;
}) {
  const db = getDb();
  if (!db)
    return getDemoStore()
      .audits.filter(
        (row) =>
          (!input.action ||
            row.action.toLowerCase().includes(input.action.toLowerCase())) &&
          (!input.entityType || row.entityType === input.entityType),
      )
      .slice(0, input.limit);
  const rows = await db
    .select()
    .from(auditEvent)
    .where(
      and(
        input.action
          ? ilike(auditEvent.action, `%${input.action}%`)
          : undefined,
        input.entityType
          ? eq(auditEvent.entityType, input.entityType)
          : undefined,
      ),
    )
    .orderBy(desc(auditEvent.createdAt))
    .limit(input.limit);
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function emitHealthSignal(
  signalKey: string,
  severity: "info" | "warn" | "critical",
  payload: Record<string, unknown>,
) {
  const db = getDb();
  if (!db) return getDemoStore().pushHealth(signalKey, severity, payload);

  const webhookConfigured = Boolean(
    process.env.GOOGLE_CHAT_WEBHOOK_URL?.trim(),
  );
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(healthSignal)
      .values({
        signalKey,
        severity,
        payload,
        deliveryStatus: webhookConfigured ? "pending" : "not_configured",
      })
      .returning();
    if (webhookConfigured) {
      await tx.insert(scheduledJob).values({
        jobKey: `health-delivery:${row!.healthSignalId}`,
        kind: "health_delivery",
        runAt: new Date(),
        payload: { healthSignalId: row!.healthSignalId },
      });
    }
    return row!;
  });
  return {
    ...created,
    notifiedAt: created.notifiedAt?.toISOString() ?? null,
    createdAt: created.createdAt.toISOString(),
  };
}

/** Deliver one durable health notification. The scheduled worker owns retries. */
export async function deliverHealthSignal(healthSignalId: string) {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for health delivery");
  const [row] = await db
    .select()
    .from(healthSignal)
    .where(eq(healthSignal.healthSignalId, healthSignalId))
    .limit(1);
  if (!row) throw new Error("Health signal not found");
  if (row.deliveryStatus === "delivered")
    return { ok: true as const, alreadyDelivered: true };

  const webhook = process.env.GOOGLE_CHAT_WEBHOOK_URL?.trim();
  if (!webhook) {
    await db
      .update(healthSignal)
      .set({ deliveryStatus: "not_configured", lastError: null })
      .where(eq(healthSignal.healthSignalId, healthSignalId));
    return { ok: true as const, notConfigured: true };
  }

  const attempts = Math.min(row.notificationAttempts + 1, 3);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `[hrmny OS] ${row.severity.toUpperCase()} · ${row.signalKey}\n${JSON.stringify(row.payload ?? {})}`,
      }),
    });
    if (!response.ok)
      throw new Error(`Google Chat webhook failed (${response.status})`);
    const notifiedAt = new Date();
    await db
      .update(healthSignal)
      .set({
        deliveryStatus: "delivered",
        notificationAttempts: attempts,
        notifiedAt,
        lastError: null,
      })
      .where(eq(healthSignal.healthSignalId, healthSignalId));
    return { ok: true as const, notifiedAt: notifiedAt.toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(healthSignal)
      .set({
        deliveryStatus: attempts >= 3 ? "failed" : "pending",
        notificationAttempts: attempts,
        lastError: message.slice(0, 2_000),
      })
      .where(eq(healthSignal.healthSignalId, healthSignalId));
    throw error;
  }
}

export async function listHealthSignals(limit: number) {
  const db = getDb();
  if (!db) return getDemoStore().healthSignals.slice(0, limit);
  const rows = await db
    .select()
    .from(healthSignal)
    .orderBy(desc(healthSignal.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}
