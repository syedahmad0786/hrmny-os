import { auditEvent, desc, eq, healthSignal } from "@hrmny/db";
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

export async function listAudit(limit: number) {
  const db = getDb();
  if (!db) return getDemoStore().audits.slice(0, limit);
  const rows = await db
    .select()
    .from(auditEvent)
    .orderBy(desc(auditEvent.createdAt))
    .limit(limit);
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

  const [created] = await db
    .insert(healthSignal)
    .values({ signalKey, severity, payload })
    .returning();
  const webhook = process.env.GOOGLE_CHAT_WEBHOOK_URL?.trim();
  let notifiedAt: Date | null = null;
  if (webhook) {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `[hrmny OS] ${severity.toUpperCase()} · ${signalKey}\n${JSON.stringify(payload)}`,
      }),
    });
    if (!response.ok) {
      throw new Error(`Google Chat webhook failed (${response.status})`);
    }
    notifiedAt = new Date();
    await db
      .update(healthSignal)
      .set({ notifiedAt })
      .where(eq(healthSignal.healthSignalId, created!.healthSignalId));
  }
  return {
    ...created!,
    notifiedAt: notifiedAt?.toISOString() ?? null,
    createdAt: created!.createdAt.toISOString(),
  };
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
