import { auditEvent, sql } from "@hrmny/db";
import { createXeroAdapter } from "@hrmny/integrations";
import { getDb } from "../db";
import { ensureFreshXeroTokens } from "./xero-tokens";

/**
 * Pull invoices from the Xero adapter (live or mock mirror) into Postgres.
 * Keeps OS read-only vs Xero; writes only to our mirror tables.
 */
export async function syncXeroInvoiceMirror(): Promise<{
  mode: string;
  upserted: number;
  linked: number;
  paidReconciled: number;
}> {
  const vault = await ensureFreshXeroTokens();
  const adapter = createXeroAdapter(
    vault
      ? {
          mode: "live",
          clientId: process.env.XERO_CLIENT_ID,
          clientSecret: process.env.XERO_CLIENT_SECRET,
          accessToken: vault.accessToken,
          tenantId: vault.tenantId,
        }
      : {},
  );
  const invoices = await adapter.listInvoices();
  const db = getDb();
  if (!db) {
    return {
      mode: adapter.mode,
      upserted: invoices.length,
      linked: 0,
      paidReconciled: 0,
    };
  }

  let upserted = 0;
  let linked = 0;
  let paidReconciled = 0;
  for (const inv of invoices) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into public.xero_invoice_mirror (external_id, payload, synced_at)
        values (
          ${inv.externalId},
          ${JSON.stringify({
            ...inv.payload,
            contactName: inv.contactName,
            amount: inv.amount,
            currency: inv.currency,
            status: inv.status,
            reference: inv.reference,
          })}::jsonb,
          now()
        )
        on conflict (external_id) do update set
          payload = excluded.payload,
          synced_at = now(),
          updated_at = now()
      `);

      const linkedRows = await tx.execute<{ invoice_id: string }>(sql`
        update public.xero_invoice_mirror mirror
        set invoice_id = os_invoice.invoice_id,
            updated_at = now()
        from public.invoice os_invoice
        where mirror.external_id = ${inv.externalId}
          and os_invoice.xero_invoice_id = mirror.external_id
          and mirror.invoice_id is distinct from os_invoice.invoice_id
        returning mirror.invoice_id
      `);
      linked += linkedRows.length;

      if (inv.status.trim().toUpperCase() !== "PAID") return;
      const changed = await tx.execute<{ invoice_id: string }>(sql`
        update public.invoice
        set status = 'paid', updated_at = now()
        where xero_invoice_id = ${inv.externalId}
          and status = 'issued'
        returning invoice_id
      `);
      for (const row of changed) {
        await tx.insert(auditEvent).values({
          actorEmployeeId: null,
          action: "invoice.reconcile.xero_paid",
          entityType: "invoice",
          entityId: row.invoice_id,
          before: { status: "issued" },
          after: {
            status: "paid",
            xeroInvoiceId: inv.externalId,
            xeroStatus: inv.status,
          },
          reason: "Read-only Xero mirror reconciliation",
        });
      }
      paidReconciled += changed.length;
    });
    upserted += 1;
  }
  return { mode: adapter.mode, upserted, linked, paidReconciled };
}
