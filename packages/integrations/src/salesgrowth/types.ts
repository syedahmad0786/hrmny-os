// Sales & Growth (June SQLite prototype) → hrmny CRM consolidation types.
//
// The importer is a pure transform (`planImport`) plus a port-backed apply
// (`applyImport`). It never opens a DB itself except in `export.ts`, which is a
// read-only dump of the source .db into the JSON intermediate defined here.

export const SALESGROWTH_SOURCE_SYSTEM = "salesgrowth" as const;

// ── Source rows (real columns of the dashboard.db, only what we consume) ─────
// Rows keep their SQLite integer `id`. Unknown extra columns are ignored.

export interface SgCompany {
  id: number;
  company: string;
  sector: string | null;
  why_this: string | null;
  evidence: string | null;
  lead_source: string | null;
  stage: string | null;
}

export interface SgContact {
  id: number;
  company_id: number | null;
  company: string | null;
  contact_name: string;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  person_id: number | null; // → intel_people.id
}

export interface SgIntelCompany {
  id: number;
  canonical_name: string;
  sector: string | null;
  hq_country: string | null;
  uae_presence: string | null;
  website: string | null;
  linkedin_url: string | null;
  notes: string | null;
  pipeline_company_id: number | null; // → companies.id
}

export interface SgIntelPerson {
  id: number;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  phone: string | null;
  notes: string | null;
  pipeline_contact_id: number | null; // → contacts.id
}

export interface SgIntelDeal {
  id: number;
  company_id: number | null; // → intel_companies.id
  deal_name: string;
  year: number | null;
  outcome: string | null;
  value_aed: number | null;
  lead_source: string | null;
  loss_reason: string | null;
  key_contact_id: number | null; // → intel_people.id
}

export interface SgOutreach {
  id: number;
  contact_id: number | null; // → contacts.id
  company: string | null;
  contact_name: string | null;
  channel: string;
  subject: string | null;
  body: string | null;
  stage: string | null;
  date_sent: string | null;
  created_at: string | null;
}

export interface SgIntelSignal {
  id: number;
  company_id: number | null; // → intel_companies.id
  person_id: number | null; // → intel_people.id
  signal_type: string;
  source: string | null;
  signal_date: string | null;
  summary: string | null;
  evidence_url: string | null;
  created_at: string | null;
}

/** JSON intermediate produced by `exportSalesGrowthDb` / accepted by the transform. */
export interface SgIntelRole {
  id: number;
  person_id: number;
  company_id: number;
  title: string | null;
  is_current: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string | null;
}
export interface SgIntelHistory {
  id: number;
  [key: string]: unknown;
}
export interface SalesGrowthExport {
  companies: SgCompany[];
  contacts: SgContact[];
  intel_companies: SgIntelCompany[];
  intel_people: SgIntelPerson[];
  intel_deals: SgIntelDeal[];
  outreach: SgOutreach[];
  intel_signals: SgIntelSignal[];
  intel_person_roles?: SgIntelRole[];
  intel_relationships?: SgIntelHistory[];
  intel_communications?: SgIntelHistory[];
  intel_proposals?: SgIntelHistory[];
  asana_pipeline?: SgIntelHistory[];
}

// ── Target CRM shapes ───────────────────────────────────────────────────────
// Cross-entity FKs are carried as *refs* (`${sourceTable}#${sourceId}`) in the
// plan; `applyImport` resolves each ref to a real UUID before it hits the writer.

export type CrmMarket = "UAE" | "KSA" | "Both";
export type CrmActivityType =
  "note" | "call" | "meeting" | "email" | "outreach" | "system";
export type CrmDealStage =
  | "discover"
  | "qualify"
  | "engage"
  | "scope"
  | "propose"
  | "price_cost"
  | "close"
  | "handover_pack";
export type CrmCloseOutcome = "won" | "lost" | "postponed_on_hold";
export type CrmLeadSourceLane =
  "industry_scanning" | "apollo_intent" | "relationship_led" | "tejari";

/** A planned insert's FK, pointing at another planned/existing source row. */
export type SourceRef = string; // `${sourceTable}#${sourceId}`

export interface CrmCompanyPlan {
  name: string;
  sector: string | null;
  market: CrmMarket | null;
  website: string | null;
  linkedinUrl: string | null;
  notes: string | null;
}

export interface CrmContactPlan {
  companyRef: SourceRef | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  linkedinUrl: string | null;
}

export interface CrmDealPlan {
  companyRef: SourceRef | null;
  primaryContactRef: SourceRef | null;
  companyName: string;
  sector: string | null;
  stage: CrmDealStage;
  closeOutcome: CrmCloseOutcome | null;
  lostReason: string | null;
  leadSourceLane: CrmLeadSourceLane;
  quoteValue: string | null;
}

export interface CrmActivityPlan {
  type: CrmActivityType;
  subject: string | null;
  body: string | null;
  companyRef: SourceRef | null;
  contactRef: SourceRef | null;
  dealRef: SourceRef | null;
  occurredAt: string | null;
  metadata: Record<string, unknown>;
}

// Resolved writes handed to the CrmWriter (refs → real ids).
export interface CrmCompanyWrite extends Omit<CrmCompanyPlan, never> {}
export interface CrmContactWrite {
  companyId: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  linkedinUrl: string | null;
}
export interface CrmDealWrite {
  companyId: string | null;
  primaryContactId: string | null;
  companyName: string;
  sector: string | null;
  stage: CrmDealStage;
  closeOutcome: CrmCloseOutcome | null;
  lostReason: string | null;
  leadSourceLane: CrmLeadSourceLane;
  quoteValue: string | null;
}
export interface CrmActivityWrite {
  type: CrmActivityType;
  subject: string | null;
  body: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  occurredAt: string | null;
  metadata: Record<string, unknown>;
}

// ── Plan / reconciliation ───────────────────────────────────────────────────

export type TargetTable = "company" | "contact" | "deal" | "activity";
export type PlanAction = "create" | "skip";
export type SkipReason =
  | "already_imported" // (source_system, source_table, source_id) already in lineage
  | "matched_existing" // dedupe hit against an existing CRM row (email/domain/name)
  | "merged_in_batch"; // collapsed into an earlier row in this same import batch

export interface PlannedRow<Plan> {
  sourceTable: string;
  sourceId: string;
  targetTable: TargetTable;
  action: PlanAction;
  skipReason?: SkipReason;
  /** This row's own ref key. */
  ref: SourceRef;
  /** For skips: the ref (`sg#..`) or `existing:<uuid>` this row resolves to. */
  resolvesTo?: string;
  input?: Plan; // present iff action === "create"
  checksum: string;
  raw: Record<string, unknown>; // staging evidence
}

export interface ImportPlan {
  companies: PlannedRow<CrmCompanyPlan>[];
  contacts: PlannedRow<CrmContactPlan>[];
  deals: PlannedRow<CrmDealPlan>[];
  activities: PlannedRow<CrmActivityPlan>[];
}

/** Existing CRM snapshot for dedupe + re-run idempotency. */
export interface ExistingCrm {
  companies: { companyId: string; name: string; website: string | null }[];
  contacts: { contactId: string; email: string | null }[];
  /** refKey (`${sourceTable}#${sourceId}`) → already-imported target uuid. */
  imported: Map<SourceRef, string>;
}

export interface ImportLineageRow {
  sourceSystem: string;
  sourceTable: string;
  sourceId: string;
  targetTable: TargetTable;
  targetId: string;
  checksum: string;
}

export interface StagingRow {
  sourceTable: string;
  sourceId: string;
  checksum: string;
  raw: Record<string, unknown>;
}

/** Persistence port — backed in the app by the CRM repository + a lineage insert. */
export interface CrmWriter {
  createCompany(input: CrmCompanyWrite): Promise<string>;
  createContact(input: CrmContactWrite): Promise<string>;
  createDeal(input: CrmDealWrite): Promise<string>;
  createActivity(input: CrmActivityWrite): Promise<string>;
  recordLineage(rows: ImportLineageRow[]): Promise<void>;
  recordStaging?(rows: StagingRow[]): Promise<void>;
}

export interface EntityRecon {
  sourceTable: string;
  targetTable: TargetTable;
  source: number;
  imported: number;
  skipped: number;
  skipReasons: Record<SkipReason, number>;
}

export interface ReconciliationReport {
  sourceSystem: string;
  entities: EntityRecon[];
  totals: { source: number; imported: number; skipped: number };
}
