import { sql } from "@hrmny/db";
import { createXeroAdapter } from "@hrmny/integrations";
import { getDb } from "../db";

/**
 * Pull invoices from the Xero adapter (live or mock mirror) into Postgres.
 * Keeps OS read-only vs Xero; writes only to our mirror tables.
 */
export async function syncXeroInvoiceMirror(): Promise<{
  mode: string;
  upserted: number;
}> {
  const adapter = createXeroAdapter();
  const invoices = await adapter.listInvoices();
  const db = getDb();
  if (!db) {
    return { mode: adapter.mode, upserted: invoices.length };
  }

  let upserted = 0;
  for (const inv of invoices) {
    await db.execute(sql`
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
    upserted += 1;
  }
  return { mode: adapter.mode, upserted };
}
