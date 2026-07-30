import { createHash } from "node:crypto";
import {
  SALESGROWTH_SOURCE_SYSTEM,
  type CrmActivityPlan,
  type CrmActivityType,
  type CrmCloseOutcome,
  type CrmCompanyPlan,
  type CrmContactPlan,
  type CrmDealPlan,
  type CrmDealStage,
  type CrmLeadSourceLane,
  type CrmMarket,
  type ExistingCrm,
  type ImportPlan,
  type PlannedRow,
  type SalesGrowthExport,
  type SourceRef,
} from "./types";

// ── small utils ─────────────────────────────────────────────────────────────

const ref = (table: string, id: number | string): SourceRef => `${table}#${id}`;

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

function checksum(raw: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(raw)).digest("hex");
}

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t.length ? t : null;
};

/** Company identity key: prefer registered domain, else normalized name. */
function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(l\.?l\.?c|fz-?llc|fze|ltd|limited|inc|co|company|group|holdings?|dmcc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function domainOf(url: string | null): string | null {
  const u = clean(url);
  if (!u) return null;
  const m = u
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return m && m.includes(".") ? m : null;
}

function companyKey(name: string, website: string | null): string {
  return domainOf(website) ?? normName(name);
}

function splitName(full: string): { first: string; last: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { first: full.trim() || "Unknown", last: null };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

// ── value mappings (calibration knobs — tune against the agency taxonomy) ─────

// ponytail: lead-source lane heuristic. Source `lead_source` is free text (16+
// variants incl. typos). Bucket into the 4 canonical lanes; default relationship_led.
function laneFor(leadSource: string | null): CrmLeadSourceLane {
  const s = (leadSource ?? "").toLowerCase();
  if (/tejari|portal|rfp/.test(s)) return "tejari";
  if (/cold|inbound|outbound|website|apollo|intent/.test(s)) return "apollo_intent";
  if (/scan|industry|research/.test(s)) return "industry_scanning";
  return "relationship_led";
}

// intel_deals.outcome → (stage, closeOutcome). Only won/lost/cancelled are closed.
const DEAL_OUTCOME: Record<string, { stage: CrmDealStage; close: CrmCloseOutcome | null }> = {
  won: { stage: "close", close: "won" },
  lost: { stage: "close", close: "lost" },
  cancelled: { stage: "close", close: "postponed_on_hold" },
  submitted: { stage: "propose", close: null },
  qualified: { stage: "qualify", close: null },
  meeting: { stage: "engage", close: null },
  contacted: { stage: "engage", close: null },
  no_response: { stage: "engage", close: null },
  unknown: { stage: "discover", close: null },
};

function marketFor(hqCountry: string | null, uaePresence: string | null): CrmMarket | null {
  const c = (hqCountry ?? "").toLowerCase();
  if (/saudi|ksa/.test(c)) return "KSA";
  if (/emirates|uae|dubai|abu dhabi/.test(c)) return "UAE";
  if (clean(uaePresence) && uaePresence !== "none") return "UAE";
  return null; // repository defaults to UAE
}

function activityTypeForChannel(channel: string): CrmActivityType {
  const c = channel.toLowerCase();
  if (c === "email") return "email";
  return "outreach"; // li_connection, li_followup, …
}

// ── planning ────────────────────────────────────────────────────────────────

export function planImport(
  data: SalesGrowthExport,
  existing: ExistingCrm,
): ImportPlan {
  const imported = existing.imported;

  // Existing-CRM dedupe indexes.
  const existingCompanyByKey = new Map<string, string>();
  for (const c of existing.companies) {
    existingCompanyByKey.set(companyKey(c.name, c.website), c.companyId);
  }
  const existingContactByEmail = new Map<string, string>();
  for (const c of existing.contacts) {
    const e = clean(c.email);
    if (e) existingContactByEmail.set(e.toLowerCase(), c.contactId);
  }

  // ── companies (pipeline `companies` first, then `intel_companies`) ─────────
  const companies: PlannedRow<CrmCompanyPlan>[] = [];
  // key → ref of the winning planned/created company in this batch
  const batchCompanyKeyToRef = new Map<string, SourceRef>();
  // pipeline companies.id → ref (so intel_companies.pipeline_company_id can merge)
  const pipelineCompanyRef = new Map<number, SourceRef>();

  const addCompany = (
    table: string,
    id: number,
    raw: Record<string, unknown>,
    plan: CrmCompanyPlan,
    key: string,
    mergeRef?: SourceRef,
  ) => {
    const r = ref(table, id);
    const row: PlannedRow<CrmCompanyPlan> = {
      sourceTable: table,
      sourceId: String(id),
      targetTable: "company",
      action: "create",
      ref: r,
      checksum: checksum(raw),
      raw,
    };
    if (imported.has(r)) {
      row.action = "skip";
      row.skipReason = "already_imported";
      row.resolvesTo = `existing:${imported.get(r)!}`;
    } else if (mergeRef) {
      row.action = "skip";
      row.skipReason = "merged_in_batch";
      row.resolvesTo = mergeRef;
    } else if (batchCompanyKeyToRef.has(key)) {
      row.action = "skip";
      row.skipReason = "merged_in_batch";
      row.resolvesTo = batchCompanyKeyToRef.get(key)!;
    } else if (existingCompanyByKey.has(key)) {
      row.action = "skip";
      row.skipReason = "matched_existing";
      row.resolvesTo = `existing:${existingCompanyByKey.get(key)!}`;
    } else {
      row.input = plan;
      batchCompanyKeyToRef.set(key, r);
    }
    companies.push(row);
    return row;
  };

  for (const c of data.companies) {
    const key = companyKey(c.company, null);
    const notes = [clean(c.why_this), clean(c.evidence)].filter(Boolean).join("\n\n") || null;
    const row = addCompany("companies", c.id, { ...c }, {
      name: c.company,
      sector: clean(c.sector),
      market: null,
      website: null,
      linkedinUrl: null,
      notes,
    }, key);
    pipelineCompanyRef.set(c.id, row.ref);
    // Winning ref for this key is either this row (create) or what it merged to.
    if (row.action === "create") batchCompanyKeyToRef.set(key, row.ref);
  }

  for (const ic of data.intel_companies) {
    const key = companyKey(ic.canonical_name, ic.website);
    // Authoritative merge: intel_companies.pipeline_company_id → a pipeline company.
    const mergeRef =
      ic.pipeline_company_id != null
        ? pipelineCompanyRef.get(ic.pipeline_company_id)
        : undefined;
    addCompany("intel_companies", ic.id, { ...ic }, {
      name: ic.canonical_name,
      sector: clean(ic.sector),
      market: marketFor(ic.hq_country, ic.uae_presence),
      website: clean(ic.website),
      linkedinUrl: clean(ic.linkedin_url),
      notes: clean(ic.notes),
    }, key, mergeRef);
  }

  // ── contacts (pipeline `contacts` first, then `intel_people`) ──────────────
  const contacts: PlannedRow<CrmContactPlan>[] = [];
  const batchContactByEmail = new Map<string, SourceRef>();
  const pipelineContactRef = new Map<number, SourceRef>();

  const addContact = (
    table: string,
    id: number,
    raw: Record<string, unknown>,
    plan: CrmContactPlan,
    email: string | null,
    mergeRef?: SourceRef,
  ) => {
    const r = ref(table, id);
    const row: PlannedRow<CrmContactPlan> = {
      sourceTable: table,
      sourceId: String(id),
      targetTable: "contact",
      action: "create",
      ref: r,
      checksum: checksum(raw),
      raw,
    };
    const e = email ? email.toLowerCase() : null;
    if (imported.has(r)) {
      row.action = "skip";
      row.skipReason = "already_imported";
      row.resolvesTo = `existing:${imported.get(r)!}`;
    } else if (mergeRef) {
      row.action = "skip";
      row.skipReason = "merged_in_batch";
      row.resolvesTo = mergeRef;
    } else if (e && batchContactByEmail.has(e)) {
      row.action = "skip";
      row.skipReason = "merged_in_batch";
      row.resolvesTo = batchContactByEmail.get(e)!;
    } else if (e && existingContactByEmail.has(e)) {
      row.action = "skip";
      row.skipReason = "matched_existing";
      row.resolvesTo = `existing:${existingContactByEmail.get(e)!}`;
    } else {
      row.input = plan;
      if (e) batchContactByEmail.set(e, r);
    }
    contacts.push(row);
    return row;
  };

  for (const ct of data.contacts) {
    const { first, last } = splitName(ct.contact_name);
    const email = clean(ct.email);
    const companyRef =
      ct.company_id != null ? pipelineCompanyRef.get(ct.company_id) ?? null : null;
    const row = addContact("contacts", ct.id, { ...ct }, {
      companyRef,
      firstName: first,
      lastName: last,
      email,
      phone: null,
      title: clean(ct.title),
      linkedinUrl: clean(ct.linkedin_url),
    }, email);
    pipelineContactRef.set(ct.id, row.ref);
    if (row.action === "create" && email) {
      batchContactByEmail.set(email.toLowerCase(), row.ref);
    }
  }

  for (const p of data.intel_people) {
    const first = clean(p.first_name) ?? splitName(p.full_name).first;
    const last = clean(p.last_name) ?? splitName(p.full_name).last;
    const email = clean(p.email);
    // Authoritative merge: intel_people.pipeline_contact_id → a pipeline contact.
    const mergeRef =
      p.pipeline_contact_id != null
        ? pipelineContactRef.get(p.pipeline_contact_id)
        : undefined;
    // ponytail: intel_people carry no direct company_id (the link lives in
    // intel_person_roles, not imported). Company stays null unless merged into a
    // pipeline contact that has one — resolved in apply. Upgrade: import roles.
    addContact("intel_people", p.id, { ...p }, {
      companyRef: null,
      firstName: first,
      lastName: last,
      email,
      phone: clean(p.phone),
      title: null,
      linkedinUrl: clean(p.linkedin_url),
    }, email, mergeRef);
  }

  // ── deals (intel_deals) ────────────────────────────────────────────────────
  const intelCompanyName = new Map<number, string>();
  for (const ic of data.intel_companies) intelCompanyName.set(ic.id, ic.canonical_name);

  const deals: PlannedRow<CrmDealPlan>[] = deriveRows(
    data.intel_deals,
    "intel_deals",
    imported,
    (d): CrmDealPlan => {
      const map = DEAL_OUTCOME[(d.outcome ?? "unknown").toLowerCase()] ?? DEAL_OUTCOME.unknown!;
      const companyRef = d.company_id != null ? ref("intel_companies", d.company_id) : null;
      const companyName =
        (d.company_id != null ? intelCompanyName.get(d.company_id) : null) ??
        clean(d.deal_name) ??
        "Unknown";
      return {
        companyRef,
        primaryContactRef: d.key_contact_id != null ? ref("intel_people", d.key_contact_id) : null,
        companyName,
        sector: null,
        stage: map.stage,
        closeOutcome: map.close,
        lostReason: clean(d.loss_reason),
        leadSourceLane: laneFor(d.lead_source),
        quoteValue: d.value_aed != null ? String(d.value_aed) : null,
      };
    },
  );

  // ── activities (outreach + intel_signals) ──────────────────────────────────
  const outreachActs = deriveRows(
    data.outreach,
    "outreach",
    imported,
    (o): CrmActivityPlan => ({
      type: activityTypeForChannel(o.channel),
      subject: clean(o.subject),
      body: clean(o.body),
      companyRef: null,
      contactRef: o.contact_id != null ? ref("contacts", o.contact_id) : null,
      dealRef: null,
      occurredAt: clean(o.date_sent) ?? clean(o.created_at),
      metadata: { channel: o.channel, stage: clean(o.stage), source_company: clean(o.company) },
    }),
  );
  const signalActs = deriveRows(
    data.intel_signals,
    "intel_signals",
    imported,
    (s): CrmActivityPlan => ({
      type: "note",
      subject: s.signal_type,
      body: clean(s.summary),
      companyRef: s.company_id != null ? ref("intel_companies", s.company_id) : null,
      contactRef: s.person_id != null ? ref("intel_people", s.person_id) : null,
      dealRef: null,
      occurredAt: clean(s.signal_date) ?? clean(s.created_at),
      metadata: {
        signal_type: s.signal_type,
        source: clean(s.source),
        evidence_url: clean(s.evidence_url),
      },
    }),
  );

  return { companies, contacts, deals, activities: [...outreachActs, ...signalActs] };
}

/**
 * Append-only entity planner (deals/activities): no CRM-content dedupe — the
 * timeline/pipeline is additive; the only skip is lineage idempotency on re-run.
 */
function deriveRows<Src extends { id: number }, Plan>(
  rows: Src[],
  table: string,
  imported: Map<SourceRef, string>,
  toPlan: (row: Src) => Plan,
): PlannedRow<Plan>[] {
  return rows.map((row) => {
    const r = ref(table, row.id);
    const raw = { ...row } as Record<string, unknown>;
    if (imported.has(r)) {
      return {
        sourceTable: table,
        sourceId: String(row.id),
        targetTable: table === "intel_deals" ? "deal" : "activity",
        action: "skip",
        skipReason: "already_imported",
        ref: r,
        resolvesTo: `existing:${imported.get(r)!}`,
        checksum: checksum(raw),
        raw,
      };
    }
    return {
      sourceTable: table,
      sourceId: String(row.id),
      targetTable: table === "intel_deals" ? "deal" : "activity",
      action: "create",
      ref: r,
      input: toPlan(row),
      checksum: checksum(raw),
      raw,
    };
  });
}

export { SALESGROWTH_SOURCE_SYSTEM };
