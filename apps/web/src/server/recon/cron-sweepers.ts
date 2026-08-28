import { sql } from "@hrmny/db";
import { getDb } from "../db";
import { emitHealthSignal } from "../m1-persistence";
import { getDemoStore, vatOnAmount } from "../demo-store";
import { runCompetitorScan } from "../leadgen/competitor-scan";
import { backfillMissingEmbeddings } from "../ai/memory-db";
import { resolveTaxRegistration } from "../finance/tax-registration";

export const XERO_MIRROR_SIGNAL = "xero_mirror_sync";
export const COMPETITOR_SCAN_SIGNAL = "competitor_scan_daily";
export const RETAINER_MONTH_SIGNAL = "retainer_month_start";
export const MEMORY_EMBED_SIGNAL = "memory_embed_backfill";

let memoryRan: Record<string, string> = {};

export function resetReconCronMemory() {
  memoryRan = {};
}

async function alreadySignaledToday(
  signalKey: string,
  todayIso: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) return memoryRan[signalKey] === todayIso;
  const [row] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from health_signal
    where signal_key = ${signalKey}
      and created_at >= ${todayIso}::date
  `);
  return Number(row?.count ?? 0) > 0;
}

async function markRan(signalKey: string, todayIso: string, payload: Record<string, unknown>) {
  memoryRan[signalKey] = todayIso;
  await emitHealthSignal(signalKey, "info", payload).catch(() => undefined);
}

/** Read-only Xero invoice mirror. Mock-safe; never writes to Xero. */
export async function runXeroMirrorCron(now: Date = new Date()): Promise<{
  ran: boolean;
  skipped?: "already_ran";
  mode?: string;
  upserted?: number;
}> {
  const todayIso = now.toISOString().slice(0, 10);
  if (await alreadySignaledToday(XERO_MIRROR_SIGNAL, todayIso)) {
    return { ran: false, skipped: "already_ran" };
  }
  const { syncXeroInvoiceMirror } = await import("../finance/xero-mirror-sync");
  const synced = await syncXeroInvoiceMirror();
  await markRan(XERO_MIRROR_SIGNAL, todayIso, {
    date: todayIso,
    mode: synced.mode,
    upserted: synced.upserted,
  });
  return { ran: true, ...synced };
}

/** Daily competitor research against an explicit LEADGEN_COMPETITORS list. */
export async function runCompetitorScanCron(now: Date = new Date()): Promise<{
  ran: boolean;
  skipped?: "already_ran" | "no_targets";
  scanned?: number;
  findings?: number;
}> {
  const todayIso = now.toISOString().slice(0, 10);
  if (await alreadySignaledToday(COMPETITOR_SCAN_SIGNAL, todayIso)) {
    return { ran: false, skipped: "already_ran" };
  }
  const names = (process.env.LEADGEN_COMPETITORS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return { ran: false, skipped: "no_targets" };
  let findings = 0;
  for (const competitor of names.slice(0, 5)) {
    const rows = await runCompetitorScan({ competitor });
    findings += rows.length;
  }
  await markRan(COMPETITOR_SCAN_SIGNAL, todayIso, {
    date: todayIso,
    scanned: names.length,
    findings,
  });
  return { ran: true, scanned: names.length, findings };
}

/** Idempotent month-start retainer drafts. Never posts to Xero. */
export async function runRetainerMonthStartCron(now: Date = new Date()): Promise<{
  ran: boolean;
  skipped?: "already_ran";
  period: string;
  created: number;
}> {
  const period = now.toISOString().slice(0, 7);
  const todayIso = now.toISOString().slice(0, 10);
  const taxRegistration = resolveTaxRegistration();
  if (await alreadySignaledToday(`${RETAINER_MONTH_SIGNAL}:${period}`, todayIso)) {
    return { ran: false, skipped: "already_ran", period, created: 0 };
  }
  const store = getDemoStore();
  const db = getDb();
  const clients = db
    ? await (await import("../finance/os-invoices")).listDurableRetainerClients()
    : [...store.clients.values()].filter(
        (c) =>
          c.engagementType === "retainer" && c.lifecycleStatus !== "churned",
      );
  let created = 0;
  for (const client of clients) {
    if (db) {
      const { listOsInvoicesForClientPeriod, insertOsInvoice } = await import(
        "../finance/os-invoices"
      );
      const exists = await listOsInvoicesForClientPeriod({
        clientId: client.clientId,
        period,
        billingKind: "retainer",
      });
      if (exists.length) continue;
      const amountNum = Number(client.fee || client.contractValue || 0);
      await insertOsInvoice({
        invoiceId: crypto.randomUUID(),
        status: "draft",
        contactName: client.name,
        amount: amountNum.toFixed(2),
        vatAmount: vatOnAmount(amountNum),
        currency: client.currency || "AED",
        invoiceType: "retainer",
        billingKind: "retainer",
        clientId: client.clientId,
        period,
        ...taxRegistration,
        ruleCited: "UAE VAT 5% monthly retainer auto-draft",
        sourceAttached: {
          kind: "retainer_month_start",
          clientId: client.clientId,
          period,
        },
        xeroInvoiceId: null,
        proposedByEmployeeId: null,
        approvedByEmployeeId: null,
        createdAt: new Date().toISOString(),
      });
      created += 1;
      continue;
    }
    const exists = [...store.invoices.values()].some(
      (inv) =>
        inv.clientId === client.clientId &&
        inv.period === period &&
        inv.billingKind === "retainer" &&
        inv.status !== "void",
    );
    if (exists) continue;
    const amountNum = Number(client.fee || client.contractValue || 0);
    const invoiceId = crypto.randomUUID();
    store.invoices.set(invoiceId, {
      invoiceId,
      status: "draft",
      contactName: client.name,
      amount: amountNum.toFixed(2),
      vatAmount: vatOnAmount(amountNum),
      currency: client.currency || "AED",
      invoiceType: "retainer",
      billingKind: "retainer",
      clientId: client.clientId,
      period,
      ...taxRegistration,
      ruleCited: "UAE VAT 5% monthly retainer auto-draft",
      sourceAttached: {
        kind: "retainer_month_start",
        clientId: client.clientId,
        period,
      },
      xeroInvoiceId: null,
      proposedByEmployeeId: null,
      approvedByEmployeeId: null,
      createdAt: new Date().toISOString(),
    });
    created += 1;
  }
  await markRan(`${RETAINER_MONTH_SIGNAL}:${period}`, todayIso, {
    date: todayIso,
    period,
    created,
  });
  return { ran: true, period, created };
}

/** Embed null memory rows only through the explicitly selected provider. */
export async function runMemoryEmbedBackfillCron(): Promise<{
  updated: number;
  skipped?: string;
}> {
  return backfillMissingEmbeddings(50);
}

export async function runReconSweepers(now: Date = new Date()) {
  const [xeroMirror, competitorScan, retainerMonth, memoryEmbed] =
    await Promise.all([
      runXeroMirrorCron(now).catch((error) => ({
        ran: false,
        error: String(error).slice(0, 500),
      })),
      runCompetitorScanCron(now).catch((error) => ({
        ran: false,
        error: String(error).slice(0, 500),
      })),
      runRetainerMonthStartCron(now).catch((error) => ({
        ran: false,
        period: now.toISOString().slice(0, 7),
        created: 0,
        error: String(error).slice(0, 500),
      })),
      runMemoryEmbedBackfillCron().catch((error) => ({
        updated: 0,
        error: String(error).slice(0, 500),
      })),
    ]);
  return { xeroMirror, competitorScan, retainerMonth, memoryEmbed };
}
