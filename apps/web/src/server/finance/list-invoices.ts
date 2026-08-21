import { sql } from "@hrmny/db";
import { getDb } from "../db";

export type BillingInvoiceRow = {
  invoiceId: string;
  status: string;
  contactName: string;
  amount: string;
  vatAmount: string | null;
  currency: string;
  invoiceType: string;
  billingKind: string;
  clientId: string | null;
  period: string | null;
  trn: string | null;
  trnStatus: string | null;
  ruleCited: string | null;
  sourceAttached: Record<string, unknown> | null;
  xeroInvoiceId: string | null;
  proposedByEmployeeId: string | null;
  approvedByEmployeeId: string | null;
  createdAt: string;
  readOnly?: boolean;
  source?: "os" | "xero_mirror";
};

type OsRow = {
  invoice_id: string;
  client_id: string | null;
  invoice_type: string;
  status: string;
  amount: string;
  vat_amount: string | null;
  currency: string;
  xero_invoice_id: string | null;
  period: string | null;
  created_at: Date | string;
};

type MirrorRow = {
  xero_invoice_mirror_id: string;
  invoice_id: string | null;
  external_id: string;
  payload: Record<string, unknown> | null;
  synced_at: Date | string;
};

function pickString(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

/** OS invoice table rows shaped for billing / finance UI. */
export async function listOsInvoices(): Promise<BillingInvoiceRow[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.execute<OsRow>(sql`
    select
      invoice_id, client_id, invoice_type, status,
      amount::text as amount, vat_amount::text as vat_amount,
      currency, xero_invoice_id, period, created_at
    from public.invoice
    order by created_at desc
    limit 200
  `);
  return rows.map((r) => ({
    invoiceId: r.invoice_id,
    status: r.status,
    contactName: "Client",
    amount: r.amount,
    vatAmount: r.vat_amount,
    currency: r.currency ?? "AED",
    invoiceType: r.invoice_type,
    billingKind: "os",
    clientId: r.client_id,
    period: r.period,
    trn: null,
    trnStatus: null,
    ruleCited: null,
    sourceAttached: null,
    xeroInvoiceId: r.xero_invoice_id,
    proposedByEmployeeId: null,
    approvedByEmployeeId: null,
    createdAt: new Date(r.created_at).toISOString(),
    readOnly: false,
    source: "os" as const,
  }));
}

/** Xero mirror rows as read-only billing cards. */
export async function listXeroMirrorInvoices(): Promise<BillingInvoiceRow[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.execute<MirrorRow>(sql`
    select
      xero_invoice_mirror_id, invoice_id, external_id, payload, synced_at
    from public.xero_invoice_mirror
    order by synced_at desc
    limit 200
  `);
  return rows.map((r) => {
    const p = r.payload ?? {};
    const amount = pickString(p.amount, "0");
    return {
      invoiceId: r.invoice_id ?? r.xero_invoice_mirror_id,
      status: pickString(p.status, "mirrored").toLowerCase(),
      contactName: pickString(p.contactName, "Xero contact"),
      amount,
      vatAmount: pickString(p.vatAmount) || null,
      currency: pickString(p.currency, "AED"),
      invoiceType: pickString(p.invoiceType, "ACCREC"),
      billingKind: "xero_mirror",
      clientId: null,
      period: null,
      trn: null,
      trnStatus: null,
      ruleCited: null,
      sourceAttached: {
        xeroExternalId: r.external_id,
        syncedAt: new Date(r.synced_at).toISOString(),
        reference: pickString(p.reference) || null,
      },
      xeroInvoiceId: r.external_id,
      proposedByEmployeeId: null,
      approvedByEmployeeId: null,
      createdAt: new Date(r.synced_at).toISOString(),
      readOnly: true,
      source: "xero_mirror" as const,
    };
  });
}

/**
 * Prefer OS invoices; append Xero-mirror-only rows not already linked.
 */
export async function listBillingInvoices(): Promise<BillingInvoiceRow[]> {
  const [os, mirror] = await Promise.all([
    listOsInvoices(),
    listXeroMirrorInvoices(),
  ]);
  const linked = new Set(
    os.map((i) => i.xeroInvoiceId).filter((id): id is string => Boolean(id)),
  );
  const mirrorOnly = mirror.filter(
    (m) => !m.xeroInvoiceId || !linked.has(m.xeroInvoiceId),
  );
  return [...os, ...mirrorOnly];
}
