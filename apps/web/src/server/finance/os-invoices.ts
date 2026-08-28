import { sql } from "@hrmny/db";
import { getDb } from "../db";
import type { BillingInvoiceRow } from "./list-invoices";

export type OsInvoiceWrite = {
  invoiceId?: string;
  clientId?: string | null;
  invoiceType: string;
  status: string;
  amount: string;
  vatAmount?: string | null;
  currency?: string;
  xeroInvoiceId?: string | null;
  period?: string | null;
  contactName?: string;
  billingKind?: string;
  trn?: string | null;
  trnStatus?: string | null;
  ruleCited?: string | null;
  sourceAttached?: Record<string, unknown> | null;
  proposedByEmployeeId?: string | null;
  approvedByEmployeeId?: string | null;
  createdAt?: string;
};

type Row = {
  invoice_id: string;
  client_id: string | null;
  client_name: string | null;
  contact_name: string | null;
  invoice_type: string;
  billing_kind: string | null;
  status: string;
  amount: string;
  vat_amount: string | null;
  currency: string;
  xero_invoice_id: string | null;
  period: string | null;
  trn: string | null;
  trn_status: string | null;
  rule_cited: string | null;
  source_attached: Record<string, unknown> | null;
  proposed_by_employee_id: string | null;
  approved_by_employee_id: string | null;
  created_at: Date | string;
};

function mapRow(
  r: Row,
  extras?: Partial<BillingInvoiceRow>,
): BillingInvoiceRow {
  return {
    invoiceId: r.invoice_id,
    status: r.status,
    contactName:
      extras?.contactName ?? r.contact_name?.trim() ?? r.client_name?.trim() ?? "Client",
    amount: r.amount,
    vatAmount: r.vat_amount,
    currency: r.currency ?? "AED",
    invoiceType: r.invoice_type,
    billingKind: extras?.billingKind ?? r.billing_kind ?? r.invoice_type,
    clientId: r.client_id,
    period: r.period,
    trn: extras?.trn ?? r.trn,
    trnStatus: extras?.trnStatus ?? r.trn_status,
    ruleCited: extras?.ruleCited ?? r.rule_cited,
    sourceAttached:
      extras?.sourceAttached ??
      r.source_attached ?? {
        source: "os",
        invoiceType: r.invoice_type,
      },
    xeroInvoiceId: r.xero_invoice_id,
    proposedByEmployeeId:
      extras?.proposedByEmployeeId ?? r.proposed_by_employee_id,
    approvedByEmployeeId:
      extras?.approvedByEmployeeId ?? r.approved_by_employee_id,
    createdAt: new Date(r.created_at).toISOString(),
    readOnly: false,
    source: "os",
  };
}

export async function getOsInvoice(
  invoiceId: string,
): Promise<BillingInvoiceRow | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute<Row>(sql`
    select
      i.invoice_id, i.client_id, c.name as client_name, i.contact_name,
      i.invoice_type, i.billing_kind, i.status,
      i.amount::text as amount, i.vat_amount::text as vat_amount,
      i.currency, i.xero_invoice_id, i.period,
      i.trn, i.trn_status, i.rule_cited, i.source_attached,
      i.proposed_by_employee_id, i.approved_by_employee_id, i.created_at
    from public.invoice i
    left join public.client c on c.client_id = i.client_id
    where i.invoice_id = ${invoiceId}::uuid
    limit 1
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insertOsInvoice(
  input: OsInvoiceWrite,
): Promise<BillingInvoiceRow | null> {
  const db = getDb();
  if (!db) return null;
  const invoiceId = input.invoiceId ?? crypto.randomUUID();
  const rows = await db.execute<Row>(sql`
    insert into public.invoice (
      invoice_id, client_id, contact_name, invoice_type, billing_kind, status,
      amount, vat_amount, currency, xero_invoice_id, period,
      trn, trn_status, rule_cited, source_attached,
      proposed_by_employee_id, approved_by_employee_id
    ) values (
      ${invoiceId}::uuid,
      ${input.clientId ?? null}::uuid,
      ${input.contactName ?? null},
      ${input.invoiceType},
      ${input.billingKind ?? input.invoiceType},
      ${input.status}::invoice_status_enum,
      ${input.amount}::numeric,
      ${input.vatAmount ?? null}::numeric,
      ${input.currency ?? "AED"},
      ${input.xeroInvoiceId ?? null},
      ${input.period ?? null},
      ${input.trn ?? null},
      ${input.trnStatus ?? null},
      ${input.ruleCited ?? null},
      ${JSON.stringify(input.sourceAttached ?? null)}::jsonb,
      ${input.proposedByEmployeeId ?? null}::uuid,
      ${input.approvedByEmployeeId ?? null}::uuid
    )
    returning
      invoice_id, client_id, null::text as client_name, contact_name,
      invoice_type, billing_kind, status,
      amount::text as amount, vat_amount::text as vat_amount,
      currency, xero_invoice_id, period,
      trn, trn_status, rule_cited, source_attached,
      proposed_by_employee_id, approved_by_employee_id, created_at
  `);
  return rows[0]
    ? mapRow(rows[0], {
        contactName: input.contactName,
        billingKind: input.billingKind,
        trn: input.trn,
        trnStatus: input.trnStatus as BillingInvoiceRow["trnStatus"],
        ruleCited: input.ruleCited,
        sourceAttached: input.sourceAttached,
        proposedByEmployeeId: input.proposedByEmployeeId,
        approvedByEmployeeId: input.approvedByEmployeeId,
      })
    : null;
}

export async function updateOsInvoice(input: {
  invoiceId: string;
  status?: string;
  xeroInvoiceId?: string | null;
  clearXeroInvoiceId?: boolean;
  approvedByEmployeeId?: string | null;
}): Promise<BillingInvoiceRow | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute<Row>(sql`
    update public.invoice set
      status = coalesce(${input.status ?? null}::invoice_status_enum, status),
      xero_invoice_id = case
        when ${input.clearXeroInvoiceId ?? false}::boolean then null
        when ${input.xeroInvoiceId ?? null}::text is not null
          then ${input.xeroInvoiceId ?? null}
        else xero_invoice_id
      end,
      approved_by_employee_id = coalesce(
        ${input.approvedByEmployeeId ?? null}::uuid,
        approved_by_employee_id
      ),
      updated_at = now()
    where invoice_id = ${input.invoiceId}::uuid
    returning
      invoice_id, client_id, null::text as client_name, contact_name,
      invoice_type, billing_kind, status,
      amount::text as amount, vat_amount::text as vat_amount,
      currency, xero_invoice_id, period,
      trn, trn_status, rule_cited, source_attached,
      proposed_by_employee_id, approved_by_employee_id, created_at
  `);
  const mapped = rows[0] ? mapRow(rows[0]) : null;
  if (mapped && input.approvedByEmployeeId) {
    mapped.approvedByEmployeeId = input.approvedByEmployeeId;
  }
  return mapped;
}

export async function findOsInvoiceByXeroId(
  xeroInvoiceId: string,
): Promise<BillingInvoiceRow | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute<Row>(sql`
    select
      i.invoice_id, i.client_id, c.name as client_name, i.contact_name,
      i.invoice_type, i.billing_kind, i.status,
      i.amount::text as amount, i.vat_amount::text as vat_amount,
      i.currency, i.xero_invoice_id, i.period,
      i.trn, i.trn_status, i.rule_cited, i.source_attached,
      i.proposed_by_employee_id, i.approved_by_employee_id, i.created_at
    from public.invoice i
    left join public.client c on c.client_id = i.client_id
    where i.xero_invoice_id = ${xeroInvoiceId}
    limit 1
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listOsInvoicesForClientPeriod(input: {
  clientId: string;
  period: string;
  billingKind: string;
}): Promise<BillingInvoiceRow[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.execute<Row>(sql`
    select
      i.invoice_id, i.client_id, c.name as client_name, i.contact_name,
      i.invoice_type, i.billing_kind, i.status,
      i.amount::text as amount, i.vat_amount::text as vat_amount,
      i.currency, i.xero_invoice_id, i.period,
      i.trn, i.trn_status, i.rule_cited, i.source_attached,
      i.proposed_by_employee_id, i.approved_by_employee_id, i.created_at
    from public.invoice i
    left join public.client c on c.client_id = i.client_id
    where i.client_id = ${input.clientId}::uuid
      and i.period = ${input.period}
      and i.invoice_type = ${input.billingKind}
      and i.status <> 'void'
  `);
  return rows.map((r) => mapRow(r, { billingKind: input.billingKind }));
}

export async function getDurableClientForInvoice(clientId: string): Promise<{
  clientId: string;
  name: string;
  fee: string | null;
  contractValue: string | null;
  currency: string;
  engagementType: string;
  lifecycleStatus: string;
} | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute<{
    clientId: string;
    name: string;
    fee: string | null;
    contractValue: string | null;
    currency: string;
    engagementType: string;
    lifecycleStatus: string;
  }>(sql`
    select
      client_id as "clientId", name,
      fee::text as fee, contract_value::text as "contractValue",
      currency, engagement_type as "engagementType",
      lifecycle_status as "lifecycleStatus"
    from public.client
    where client_id = ${clientId}::uuid
    limit 1
  `);
  return rows[0] ?? null;
}

export async function listDurableRetainerClients(): Promise<
  Array<{
    clientId: string;
    name: string;
    fee: string | null;
    contractValue: string | null;
    currency: string;
    engagementType: string;
    lifecycleStatus: string;
  }>
> {
  const db = getDb();
  if (!db) return [];
  return db.execute(sql`
    select
      client_id as "clientId", name,
      fee::text as fee, contract_value::text as "contractValue",
      currency, engagement_type as "engagementType",
      lifecycle_status as "lifecycleStatus"
    from public.client
    where engagement_type = 'retainer'
      and lifecycle_status <> 'churned'
  `);
}
