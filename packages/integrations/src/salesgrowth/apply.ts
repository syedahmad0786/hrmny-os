import {
  SALESGROWTH_SOURCE_SYSTEM,
  type CrmActivityPlan,
  type CrmCompanyPlan,
  type CrmContactPlan,
  type CrmDealPlan,
  type CrmWriter,
  type EntityRecon,
  type ImportLineageRow,
  type ImportPlan,
  type PlannedRow,
  type ReconciliationReport,
  type SkipReason,
  type SourceRef,
  type StagingRow,
  type TargetTable,
} from "./types";

/** Dry-run diff: counts of source vs create vs skip (with reasons), per source table. */
export function reconcile(plan: ImportPlan): ReconciliationReport {
  const byKey = new Map<string, EntityRecon>();
  const all: PlannedRow<unknown>[] = [
    ...plan.companies,
    ...plan.contacts,
    ...plan.deals,
    ...plan.activities,
  ];
  for (const row of all) {
    const key = `${row.sourceTable}→${row.targetTable}`;
    let e = byKey.get(key);
    if (!e) {
      e = {
        sourceTable: row.sourceTable,
        targetTable: row.targetTable,
        source: 0,
        imported: 0,
        skipped: 0,
        skipReasons: { already_imported: 0, matched_existing: 0, merged_in_batch: 0 },
      };
      byKey.set(key, e);
    }
    e.source += 1;
    if (row.action === "create") e.imported += 1;
    else {
      e.skipped += 1;
      if (row.skipReason) e.skipReasons[row.skipReason] += 1;
    }
  }
  const entities = [...byKey.values()];
  const totals = entities.reduce(
    (t, e) => ({
      source: t.source + e.source,
      imported: t.imported + e.imported,
      skipped: t.skipped + e.skipped,
    }),
    { source: 0, imported: 0, skipped: 0 },
  );
  return { sourceSystem: SALESGROWTH_SOURCE_SYSTEM, entities, totals };
}

export interface ApplyResult {
  report: ReconciliationReport;
  lineage: ImportLineageRow[];
}

/**
 * Executes the plan against the writer port. Passes run company → contact →
 * deal → activity so FK refs resolve to real ids before each insert. Idempotent:
 * `already_imported` rows are no-ops and every applied source row gets exactly
 * one lineage entry.
 */
export async function applyImport(
  plan: ImportPlan,
  writer: CrmWriter,
  existingImported: Map<SourceRef, string> = new Map(),
): Promise<ApplyResult> {
  const resolved = new Map<SourceRef, string>(existingImported);
  const lineage: ImportLineageRow[] = [];
  const staging: StagingRow[] = [];

  const resolveRef = (r: SourceRef | null): string | null =>
    r == null ? null : resolved.get(r) ?? null;

  const lineageFor = (
    row: PlannedRow<unknown>,
    targetTable: TargetTable,
    targetId: string,
  ) => {
    lineage.push({
      sourceSystem: SALESGROWTH_SOURCE_SYSTEM,
      sourceTable: row.sourceTable,
      sourceId: row.sourceId,
      targetTable,
      targetId,
      checksum: row.checksum,
    });
  };

  // Resolve a skip row to its target id (existing:<id> or an earlier ref).
  const skipTarget = (row: PlannedRow<unknown>): string | null => {
    const rt = row.resolvesTo;
    if (!rt) return null;
    if (rt.startsWith("existing:")) return rt.slice("existing:".length);
    return resolved.get(rt) ?? null;
  };

  // Generic pass: create via `create`, wire the resolved id into `resolved`,
  // and record lineage for creates + in-run/existing dedupe skips.
  async function runPass<Plan>(
    rows: PlannedRow<Plan>[],
    targetTable: TargetTable,
    create: (row: PlannedRow<Plan>) => Promise<string>,
  ) {
    for (const row of rows) {
      staging.push({
        sourceTable: row.sourceTable,
        sourceId: row.sourceId,
        checksum: row.checksum,
        raw: row.raw,
      });
      if (row.action === "create") {
        const id = await create(row);
        resolved.set(row.ref, id);
        lineageFor(row, targetTable, id);
      } else {
        const target = skipTarget(row);
        if (target) resolved.set(row.ref, target);
        // already_imported is already in lineage from a prior run; skip re-logging.
        if (target && row.skipReason !== "already_imported") {
          lineageFor(row, targetTable, target);
        }
      }
    }
  }

  await runPass<CrmCompanyPlan>(plan.companies, "company", (row) =>
    writer.createCompany({ ...row.input! }),
  );
  await runPass<CrmContactPlan>(plan.contacts, "contact", (row) => {
    const i = row.input!;
    return writer.createContact({
      companyId: resolveRef(i.companyRef),
      firstName: i.firstName,
      lastName: i.lastName,
      email: i.email,
      phone: i.phone,
      title: i.title,
      linkedinUrl: i.linkedinUrl,
    });
  });
  await runPass<CrmDealPlan>(plan.deals, "deal", (row) => {
    const i = row.input!;
    return writer.createDeal({
      companyId: resolveRef(i.companyRef),
      primaryContactId: resolveRef(i.primaryContactRef),
      companyName: i.companyName,
      sector: i.sector,
      stage: i.stage,
      closeOutcome: i.closeOutcome,
      lostReason: i.lostReason,
      leadSourceLane: i.leadSourceLane,
      quoteValue: i.quoteValue,
    });
  });
  await runPass<CrmActivityPlan>(plan.activities, "activity", (row) => {
    const i = row.input!;
    return writer.createActivity({
      type: i.type,
      subject: i.subject,
      body: i.body,
      companyId: resolveRef(i.companyRef),
      contactId: resolveRef(i.contactRef),
      dealId: resolveRef(i.dealRef),
      occurredAt: i.occurredAt,
      metadata: i.metadata,
    });
  });

  if (lineage.length) await writer.recordLineage(lineage);
  if (staging.length && writer.recordStaging) await writer.recordStaging(staging);

  return { report: reconcile(plan), lineage };
}

export type { SkipReason };
