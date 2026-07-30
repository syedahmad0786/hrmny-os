import { sql } from "@hrmny/db";
import {
  getDemoStore,
  type DemoInvoice,
  type DemoInvoiceProposal,
} from "../demo-store";
import { getDb } from "../db";

type InvoiceRow = {
  invoice_id: string;
  status: string;
  contact_name: string | null;
  amount: string;
  vat_amount: string | null;
  currency: string;
  invoice_type: string;
  billing_kind: DemoInvoice["billingKind"] | null;
  client_id: string | null;
  period: string | null;
  trn: string | null;
  trn_status: "known" | "unknown_held" | null;
  rule_cited: string | null;
  source_attached: Record<string, unknown> | null;
  xero_invoice_id: string | null;
  proposed_by_employee_id: string | null;
  approved_by_employee_id: string | null;
  created_at: Date | string;
};

type ProposalRow = {
  proposal_id: string;
  email_ref: string;
  status: DemoInvoiceProposal["status"];
  payload: Record<string, unknown>;
  invoice_id: string | null;
  created_at: Date | string;
};

function mapInvoice(row: InvoiceRow): DemoInvoice {
  return {
    invoiceId: row.invoice_id,
    status: row.status,
    contactName: row.contact_name ?? "Unknown",
    amount: String(row.amount),
    vatAmount: String(row.vat_amount ?? "0"),
    currency: row.currency,
    invoiceType: row.invoice_type,
    billingKind: row.billing_kind ?? "intake",
    clientId: row.client_id,
    period: row.period,
    trn: row.trn,
    trnStatus: row.trn_status ?? "known",
    ruleCited: row.rule_cited,
    sourceAttached: row.source_attached,
    xeroInvoiceId: row.xero_invoice_id,
    proposedByEmployeeId: row.proposed_by_employee_id,
    approvedByEmployeeId: row.approved_by_employee_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapProposal(row: ProposalRow): DemoInvoiceProposal {
  return {
    proposalId: row.proposal_id,
    emailRef: row.email_ref,
    status: row.status,
    payload: row.payload ?? {},
    invoiceId: row.invoice_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listInvoices(): Promise<DemoInvoice[]> {
  const db = getDb();
  if (!db) return [...getDemoStore().invoices.values()];
  const rows = (await db.execute(sql`
    select
      invoice_id, status, contact_name, amount::text as amount,
      vat_amount::text as vat_amount, currency, invoice_type, billing_kind,
      client_id, period, trn, trn_status, rule_cited, source_attached,
      xero_invoice_id, proposed_by_employee_id, approved_by_employee_id,
      created_at
    from public.invoice
    order by created_at desc
  `)) as unknown as InvoiceRow[];
  return rows.map(mapInvoice);
}

export async function listProposals(): Promise<DemoInvoiceProposal[]> {
  const db = getDb();
  if (!db) return [...getDemoStore().proposals.values()];
  const rows = (await db.execute(sql`
    select proposal_id, email_ref, status, payload, invoice_id, created_at
    from public.invoice_proposal
    order by created_at desc
  `)) as unknown as ProposalRow[];
  return rows.map(mapProposal);
}

export async function insertProposal(
  proposal: DemoInvoiceProposal,
): Promise<DemoInvoiceProposal> {
  const db = getDb();
  if (!db) {
    getDemoStore().proposals.set(proposal.proposalId, proposal);
    return proposal;
  }
  await db.execute(sql`
    insert into public.invoice_proposal (
      proposal_id, email_ref, status, payload, invoice_id, created_at
    ) values (
      ${proposal.proposalId}::uuid,
      ${proposal.emailRef},
      ${proposal.status},
      ${JSON.stringify(proposal.payload)}::jsonb,
      ${proposal.invoiceId}::uuid,
      ${proposal.createdAt}::timestamptz
    )
  `);
  return proposal;
}

export async function upsertInvoice(invoice: DemoInvoice): Promise<DemoInvoice> {
  const db = getDb();
  if (!db) {
    getDemoStore().invoices.set(invoice.invoiceId, invoice);
    return invoice;
  }
  await db.execute(sql`
    insert into public.invoice (
      invoice_id, client_id, invoice_type, status, amount, vat_amount, currency,
      xero_invoice_id, period, contact_name, billing_kind, trn, trn_status,
      rule_cited, source_attached, proposed_by_employee_id, approved_by_employee_id,
      created_at
    ) values (
      ${invoice.invoiceId}::uuid,
      ${invoice.clientId}::uuid,
      ${invoice.invoiceType},
      ${invoice.status}::invoice_status_enum,
      ${invoice.amount},
      ${invoice.vatAmount},
      ${invoice.currency},
      ${invoice.xeroInvoiceId},
      ${invoice.period},
      ${invoice.contactName},
      ${invoice.billingKind},
      ${invoice.trn},
      ${invoice.trnStatus},
      ${invoice.ruleCited},
      ${JSON.stringify(invoice.sourceAttached ?? {})}::jsonb,
      ${invoice.proposedByEmployeeId}::uuid,
      ${invoice.approvedByEmployeeId}::uuid,
      ${invoice.createdAt}::timestamptz
    )
    on conflict (invoice_id) do update set
      status = excluded.status,
      amount = excluded.amount,
      vat_amount = excluded.vat_amount,
      xero_invoice_id = excluded.xero_invoice_id,
      contact_name = excluded.contact_name,
      billing_kind = excluded.billing_kind,
      trn = excluded.trn,
      trn_status = excluded.trn_status,
      rule_cited = excluded.rule_cited,
      source_attached = excluded.source_attached,
      approved_by_employee_id = excluded.approved_by_employee_id,
      updated_at = now()
  `);
  return invoice;
}

export async function updateProposal(
  proposalId: string,
  patch: Partial<DemoInvoiceProposal>,
): Promise<DemoInvoiceProposal | null> {
  const db = getDb();
  if (!db) {
    const existing = getDemoStore().proposals.get(proposalId);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    getDemoStore().proposals.set(proposalId, next);
    return next;
  }
  const current = (await listProposals()).find((p) => p.proposalId === proposalId);
  if (!current) return null;
  const next = { ...current, ...patch };
  await db.execute(sql`
    update public.invoice_proposal set
      status = ${next.status},
      payload = ${JSON.stringify(next.payload)}::jsonb,
      invoice_id = ${next.invoiceId}::uuid,
      updated_at = now()
    where proposal_id = ${proposalId}::uuid
  `);
  return next;
}

export async function getProposal(
  proposalId: string,
): Promise<DemoInvoiceProposal | null> {
  const db = getDb();
  if (!db) return getDemoStore().proposals.get(proposalId) ?? null;
  const rows = (await db.execute(sql`
    select proposal_id, email_ref, status, payload, invoice_id, created_at
    from public.invoice_proposal
    where proposal_id = ${proposalId}::uuid
    limit 1
  `)) as unknown as ProposalRow[];
  return rows[0] ? mapProposal(rows[0]) : null;
}

export async function getInvoice(
  invoiceId: string,
): Promise<DemoInvoice | null> {
  const db = getDb();
  if (!db) return getDemoStore().invoices.get(invoiceId) ?? null;
  const rows = (await db.execute(sql`
    select
      invoice_id, status, contact_name, amount::text as amount,
      vat_amount::text as vat_amount, currency, invoice_type, billing_kind,
      client_id, period, trn, trn_status, rule_cited, source_attached,
      xero_invoice_id, proposed_by_employee_id, approved_by_employee_id,
      created_at
    from public.invoice
    where invoice_id = ${invoiceId}::uuid
    limit 1
  `)) as unknown as InvoiceRow[];
  return rows[0] ? mapInvoice(rows[0]) : null;
}
