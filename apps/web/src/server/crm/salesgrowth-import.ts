import {
  deal,
  eq,
  importLineage,
  salesgrowthImportStaging,
  sql,
  type Db,
} from "@hrmny/db";
import { salesgrowth } from "@hrmny/integrations";
import { getDb, withDatabaseScope } from "../db";
import {
  createActivity,
  createCompany,
  createContact,
  createDeal,
  listCompanies,
  listContacts,
  updateDeal,
} from "./repository";

type SalesGrowthExport = salesgrowth.SalesGrowthExport;
type CrmWriter = salesgrowth.CrmWriter;
type ExistingCrm = salesgrowth.ExistingCrm;

const SYSTEM = salesgrowth.SALESGROWTH_SOURCE_SYSTEM;

/** Load the CRM dedupe snapshot + prior salesgrowth lineage (re-run idempotency). */
async function loadExistingCrm(): Promise<ExistingCrm> {
  const [companies, contacts] = await Promise.all([
    listCompanies(),
    listContacts(),
  ]);
  const imported = new Map<string, string>();
  const db = getDb();
  if (db) {
    const rows = await db
      .select({
        sourceTable: importLineage.sourceTable,
        sourceId: importLineage.sourceId,
        targetId: importLineage.targetId,
      })
      .from(importLineage)
      .where(eq(importLineage.sourceSystem, SYSTEM));
    for (const r of rows)
      imported.set(`${r.sourceTable}#${r.sourceId}`, r.targetId);
  }
  return {
    companies: companies.map((c) => ({
      companyId: c.companyId,
      name: c.name,
      website: c.website,
    })),
    contacts: contacts.map((c) => ({ contactId: c.contactId, email: c.email })),
    imported,
  };
}

/**
 * CRM writer backed by the repository create functions. `withDb` inside those
 * functions makes this DB-backed when DATABASE_URL is set and in-memory otherwise
 * — so a mock run and a real run share one code path. Lineage/staging are written
 * directly (no repository fn), and no-op in memory mode.
 */
function makeWriter(): CrmWriter {
  const db = getDb();
  return {
    async createCompany(i) {
      return (await createCompany(i)).companyId;
    },
    async createContact(i) {
      return (await createContact(i)).contactId;
    },
    async createDeal(i) {
      const row = await createDeal({
        companyName: i.companyName,
        companyId: i.companyId,
        primaryContactId: i.primaryContactId,
        sector: i.sector,
        leadSourceLane: i.leadSourceLane,
      });
      // createDeal seeds stage=discover/quote=0; patch to the imported truth.
      if (db) {
        await db
          .update(deal)
          .set({
            stage: i.stage as typeof deal.$inferInsert.stage,
            closeOutcome: i.closeOutcome,
            lostReason: i.lostReason,
            quoteValue: i.quoteValue ?? "0.00",
            updatedAt: new Date(),
          })
          .where(eq(deal.dealId, row.dealId));
      } else {
        await updateDeal(row.dealId, {
          closeOutcome: i.closeOutcome,
          lostReason: i.lostReason,
          quoteValue: i.quoteValue,
        });
      }
      return row.dealId;
    },
    async createActivity(i) {
      const row = await createActivity({
        type: i.type,
        subject: i.subject,
        body: i.body,
        companyId: i.companyId,
        contactId: i.contactId,
        dealId: i.dealId,
        metadata: i.metadata,
        occurredAt: i.occurredAt,
      });
      return row.activityId;
    },
    async recordLineage(rows) {
      if (!db || rows.length === 0) return;
      await db
        .insert(importLineage)
        .values(
          rows.map((r) => ({
            sourceSystem: r.sourceSystem,
            sourceTable: r.sourceTable,
            sourceId: r.sourceId,
            targetTable: r.targetTable,
            targetId: r.targetId,
            checksum: r.checksum,
          })),
        )
        .onConflictDoNothing();
    },
    async recordStaging(rows) {
      if (!db || rows.length === 0) return;
      for (const r of rows) {
        await db
          .insert(salesgrowthImportStaging)
          .values({
            sourceTable: r.sourceTable,
            sourceId: r.sourceId,
            raw: r.raw,
            checksum: r.checksum,
          })
          .onConflictDoUpdate({
            target: [
              salesgrowthImportStaging.sourceTable,
              salesgrowthImportStaging.sourceId,
            ],
            set: { raw: r.raw, checksum: r.checksum, importedAt: new Date() },
          });
      }
    },
  };
}

export interface SalesGrowthImportResult {
  plan: salesgrowth.ImportPlan;
  report: salesgrowth.ReconciliationReport;
  applied: boolean;
  heldPrivate: number;
}

/**
 * Consolidate a Sales & Growth export into the CRM.
 * `apply: false` (default) is a dry run: returns the plan + reconciliation diff
 * with no writes. `apply: true` executes via the repository and records lineage.
 */
export async function runSalesGrowthImport(
  data: SalesGrowthExport,
  opts: { apply?: boolean; privateAuthorizedEmployeeIds?: string[] } = {},
): Promise<SalesGrowthImportResult> {
  const work = async (): Promise<SalesGrowthImportResult> => {
    const existing = await loadExistingCrm();
    const plan = salesgrowth.planImport(data, existing);
    // Historical research is context, not a newly won sale or a current forecast.
    const historicalDeals = plan.deals.map((row) => ({
      ...row,
      targetTable: "activity" as const,
      input: row.input
        ? {
            type: "note" as const,
            subject: `Historical opportunity: ${String(row.raw.deal_name ?? row.input.companyName)}`,
            body: `Outcome: ${row.raw.outcome ?? "unknown"} · year: ${row.raw.year ?? "unknown"}\nValue AED: ${row.input.quoteValue ?? "unconfirmed"}\n${row.input.lostReason ?? ""}`,
            companyRef: row.input.companyRef,
            contactRef: row.input.primaryContactRef,
            dealRef: null,
            occurredAt: null,
            metadata: {
              source: "salesgrowth",
              sourceTable: "intel_deals",
              visibility: "private",
              ownerEmployeeId: null,
              historicalYear: row.raw.year ?? null,
            },
          }
        : undefined,
    }));
    plan.deals = [];
    for (const row of plan.activities)
      if (row.input) {
        row.input.dealRef = null;
        if (row.sourceTable !== "intel_person_roles")
          row.input.metadata.visibility = "private";
      }
    const companyNotes = plan.companies.flatMap((row) => {
      const body =
        row.input?.notes ??
        (typeof row.raw.notes === "string"
          ? row.raw.notes
          : typeof row.raw.why_this === "string"
            ? row.raw.why_this
            : null);
      if (!body?.trim()) return [];
      const name =
        row.input?.name ??
        String(row.raw.company ?? row.raw.canonical_name ?? "Company");
      if (row.input) row.input.notes = null;
      const ref = `legacy_company_notes#${row.sourceTable}:${row.sourceId}`;
      const prior = existing.imported.get(ref);
      return [
        {
          ...row,
          sourceTable: "legacy_company_notes",
          sourceId: `${row.sourceTable}:${row.sourceId}`,
          ref,
          targetTable: "activity" as const,
          action: prior ? ("skip" as const) : ("create" as const),
          ...(prior
            ? {
                skipReason: "already_imported" as const,
                resolvesTo: `existing:${prior}`,
              }
            : {}),
          input: {
            type: "note" as const,
            subject: `Historical context: ${name}`,
            body,
            companyRef: row.ref,
            contactRef: null,
            dealRef: null,
            occurredAt: null,
            metadata: {
              source: "salesgrowth",
              visibility: "private",
              ownerEmployeeId: null,
            },
          },
        },
      ];
    });
    plan.activities.push(...historicalDeals, ...companyNotes);
    const isPrivate = (row: salesgrowth.ImportPlan["activities"][number]) =>
      row.input?.metadata.visibility === "private" ||
      row.sourceTable !== "intel_person_roles";
    const heldPrivate = opts.privateAuthorizedEmployeeIds?.length
      ? 0
      : plan.activities.filter(isPrivate).length;
    plan.activities = plan.activities.filter(
      (row) => !isPrivate(row) || opts.privateAuthorizedEmployeeIds?.length,
    );
    for (const row of plan.activities)
      if (isPrivate(row) && row.input)
        row.input.metadata = {
          ...row.input.metadata,
          visibility: "private",
          authorizedEmployeeIds: opts.privateAuthorizedEmployeeIds,
        };
    if (!opts.apply)
      return {
        plan,
        report: salesgrowth.reconcile(plan),
        applied: false,
        heldPrivate,
      };
    const { report } = await salesgrowth.applyImport(
      plan,
      makeWriter(),
      existing.imported,
    );
    return { plan, report, applied: true, heldPrivate };
  };
  const db = getDb();
  if (!opts.apply || !db) return work();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('salesgrowth-import'))`,
    );
    return withDatabaseScope(tx as unknown as Db, work);
  });
}
