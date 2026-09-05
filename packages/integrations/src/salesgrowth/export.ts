import { z } from "zod";
import type { SalesGrowthExport } from "./types";

// One SELECT per source table — only the columns the transform consumes. Kept
// here so a schema drift in the source .db fails loudly at export, not mid-import.
const QUERIES = {
  companies:
    "SELECT id, company, sector, why_this, evidence, lead_source, stage FROM companies",
  contacts:
    "SELECT id, company_id, company, contact_name, title, email, linkedin_url, person_id FROM contacts",
  intel_companies:
    "SELECT id, canonical_name, sector, hq_country, uae_presence, website, linkedin_url, notes, pipeline_company_id FROM intel_companies",
  intel_people:
    "SELECT id, full_name, first_name, last_name, email, linkedin_url, phone, notes, pipeline_contact_id FROM intel_people",
  intel_deals:
    "SELECT id, company_id, deal_name, year, outcome, value_aed, lead_source, loss_reason, key_contact_id FROM intel_deals",
  outreach:
    "SELECT id, contact_id, company, contact_name, channel, subject, body, stage, date_sent, created_at FROM outreach",
  intel_signals:
    "SELECT id, company_id, person_id, signal_type, source, signal_date, summary, evidence_url, created_at FROM intel_signals",
} as const;

/**
 * Read-only dump of the Sales & Growth dashboard.db into the JSON intermediate.
 *
 * Uses the Node builtin `node:sqlite` (zero new deps; no `sqlite3` CLI or native
 * driver required). Imported dynamically so the rest of the package — the pure
 * transform and its tests — never touch the experimental module.
 *
 * ponytail: node:sqlite is experimental (Node 22.5+). If it ever destabilises,
 * swap this one function for `sqlite3 -json <db> "<query>"` (same JSON out).
 */
export async function exportSalesGrowthDb(opts: {
  dbPath: string;
}): Promise<SalesGrowthExport> {
  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (err) {
    throw new Error(
      "node:sqlite unavailable (needs Node 22.5+). Either upgrade Node or " +
        "produce the JSON intermediate with `sqlite3 -json` and use parseSalesGrowthExport().",
      { cause: err },
    );
  }
  const db = new DatabaseSync(opts.dbPath, { readOnly: true });
  try {
    const read = <T>(sql: string): T[] =>
      db.prepare(sql).all() as unknown as T[];
    const tables = new Set(
      read<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table'",
      ).map((row) => row.name),
    );
    const optional = <T>(table: string): T[] =>
      tables.has(table) ? read<T>(`SELECT * FROM ${table}`) : [];
    return {
      companies: read(QUERIES.companies),
      contacts: read(QUERIES.contacts),
      intel_companies: read(QUERIES.intel_companies),
      intel_people: read(QUERIES.intel_people),
      intel_deals: read(QUERIES.intel_deals),
      outreach: read(QUERIES.outreach),
      intel_signals: read(QUERIES.intel_signals),
      intel_person_roles: optional("intel_person_roles"),
      intel_relationships: optional("intel_relationships"),
      intel_communications: optional("intel_communications"),
      intel_proposals: optional("intel_proposals"),
      asana_pipeline: optional("asana_pipeline"),
    };
  } finally {
    db.close();
  }
}

// Lenient validation of a JSON intermediate (from `sqlite3 -json` or a fixture):
// each table must be an array; rows keep whatever columns they carry.
const rowArray = z.array(z.record(z.string(), z.unknown())).default([]);
const exportSchema = z.object({
  companies: rowArray,
  contacts: rowArray,
  intel_companies: rowArray,
  intel_people: rowArray,
  intel_deals: rowArray,
  outreach: rowArray,
  intel_signals: rowArray,
  intel_person_roles: rowArray,
  intel_relationships: rowArray,
  intel_communications: rowArray,
  intel_proposals: rowArray,
  asana_pipeline: rowArray,
});

export function parseSalesGrowthExport(input: unknown): SalesGrowthExport {
  return exportSchema.parse(input) as unknown as SalesGrowthExport;
}
