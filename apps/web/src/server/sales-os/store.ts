import { randomUUID } from "node:crypto";
import {
  and,
  companyResearch,
  contactResearch,
  desc,
  emailEvent,
  eq,
  intelSignal,
  salesOsCreditLedger,
  salesOsEvolveProposal,
  salesOsSettings,
  suppressionEntry,
  type Db,
} from "@hrmny/db";
import { getDb } from "../db";
import {
  DEFAULT_SALES_OS_SETTINGS,
  type SalesOsSettings,
} from "./sops";
import type {
  CompanyResearchRow,
  ContactResearchRow,
  CreditLedgerRow,
  EmailEventRow,
  EvolveProposalRow,
  IntelSignalRow,
  SuppressionReason,
  SuppressionRow,
} from "./types";

type Memory = {
  settings: SalesOsSettings;
  companies: Map<string, CompanyResearchRow>;
  contacts: Map<string, ContactResearchRow>;
  suppression: SuppressionRow[];
  emailEvents: EmailEventRow[];
  signals: IntelSignalRow[];
  proposals: EvolveProposalRow[];
  credits: CreditLedgerRow[];
};

const memory: Memory = {
  settings: structuredClone(DEFAULT_SALES_OS_SETTINGS),
  companies: new Map(),
  contacts: new Map(),
  suppression: [],
  emailEvents: [],
  signals: [],
  proposals: [],
  credits: [],
};

export function resetSalesOsStore(): void {
  memory.settings = structuredClone(DEFAULT_SALES_OS_SETTINGS);
  memory.companies.clear();
  memory.contacts.clear();
  memory.suppression = [];
  memory.emailEvents = [];
  memory.signals = [];
  memory.proposals = [];
  memory.credits = [];
}

async function withDb<T>(fn: (db: Db) => Promise<T>, fallback: () => T): Promise<T> {
  const db = getDb();
  if (!db) return fallback();
  return fn(db);
}

const iso = (d: Date | string | null | undefined): string =>
  d instanceof Date ? d.toISOString() : d ? String(d) : new Date().toISOString();

function mergeSettings(raw: unknown): SalesOsSettings {
  const incoming = (raw && typeof raw === "object" ? raw : {}) as Partial<SalesOsSettings>;
  return {
    ...DEFAULT_SALES_OS_SETTINGS,
    ...incoming,
    icp: { ...DEFAULT_SALES_OS_SETTINGS.icp, ...incoming.icp },
    sectorRotation: {
      ...DEFAULT_SALES_OS_SETTINGS.sectorRotation,
      ...incoming.sectorRotation,
    },
    searchTemplates: {
      ...DEFAULT_SALES_OS_SETTINGS.searchTemplates,
      ...incoming.searchTemplates,
    },
    stakeholderTitles:
      incoming.stakeholderTitles ?? DEFAULT_SALES_OS_SETTINGS.stakeholderTitles,
    outreach: { ...DEFAULT_SALES_OS_SETTINGS.outreach, ...incoming.outreach },
    buaf: { ...DEFAULT_SALES_OS_SETTINGS.buaf, ...incoming.buaf },
    caps: { ...DEFAULT_SALES_OS_SETTINGS.caps, ...incoming.caps },
    targets: { ...DEFAULT_SALES_OS_SETTINGS.targets, ...incoming.targets },
    stallDays: { ...DEFAULT_SALES_OS_SETTINGS.stallDays, ...incoming.stallDays },
  };
}

export async function getSalesOsSettings(): Promise<SalesOsSettings> {
  return withDb(
    async (db) => {
      const [row] = await db.select().from(salesOsSettings).limit(1);
      if (!row) return structuredClone(DEFAULT_SALES_OS_SETTINGS);
      return mergeSettings(row.settings);
    },
    () => structuredClone(memory.settings),
  );
}

export async function saveSalesOsSettings(
  next: SalesOsSettings,
  updatedBy?: string | null,
): Promise<SalesOsSettings> {
  const merged = mergeSettings(next);
  return withDb(
    async (db) => {
      await db
        .insert(salesOsSettings)
        .values({
          salesOsSettingsId: "default",
          settings: merged as unknown as Record<string, unknown>,
          updatedAt: new Date(),
          updatedBy: updatedBy ?? null,
        })
        .onConflictDoUpdate({
          target: salesOsSettings.salesOsSettingsId,
          set: {
            settings: merged as unknown as Record<string, unknown>,
            updatedAt: new Date(),
            updatedBy: updatedBy ?? null,
          },
        });
      return merged;
    },
    () => {
      memory.settings = merged;
      return merged;
    },
  );
}

function mapCompany(r: typeof companyResearch.$inferSelect): CompanyResearchRow {
  return {
    id: r.companyResearchId,
    companyId: r.companyId,
    name: r.name,
    sector: r.sector,
    market: (r.market as CompanyResearchRow["market"]) ?? null,
    website: r.website,
    whyThis: r.whyThis,
    evidence: r.evidence,
    leadSourceLane: r.leadSourceLane,
    estimatedValueAed: r.estimatedValueAed ? Number(r.estimatedValueAed) : null,
    suggestedServices: r.suggestedServices,
    buafBudget: r.buafBudget,
    buafUrgency: r.buafUrgency,
    buafAccess: r.buafAccess,
    buafFit: r.buafFit,
    buafTotal: r.buafTotal,
    temperature: r.temperature as CompanyResearchRow["temperature"],
    approvalState: r.approvalState as CompanyResearchRow["approvalState"],
    reworkFeedback: r.reworkFeedback,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export async function insertCompanyResearch(
  input: Omit<CompanyResearchRow, "id" | "createdAt" | "updatedAt">,
): Promise<CompanyResearchRow> {
  const now = new Date().toISOString();
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(companyResearch)
        .values({
          companyId: input.companyId,
          name: input.name,
          sector: input.sector,
          market: input.market,
          website: input.website,
          whyThis: input.whyThis,
          evidence: input.evidence,
          leadSourceLane: input.leadSourceLane,
          estimatedValueAed:
            input.estimatedValueAed != null ? String(input.estimatedValueAed) : null,
          suggestedServices: input.suggestedServices,
          buafBudget: input.buafBudget,
          buafUrgency: input.buafUrgency,
          buafAccess: input.buafAccess,
          buafFit: input.buafFit,
          buafTotal: input.buafTotal,
          temperature: input.temperature,
          approvalState: input.approvalState,
          reworkFeedback: input.reworkFeedback,
          decidedBy: input.decidedBy,
          decidedAt: input.decidedAt ? new Date(input.decidedAt) : null,
        })
        .returning();
      return mapCompany(row!);
    },
    () => {
      const row: CompanyResearchRow = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
      memory.companies.set(row.id, row);
      return row;
    },
  );
}

export async function listCompanyResearch(filter?: {
  state?: CompanyResearchRow["approvalState"];
}): Promise<CompanyResearchRow[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(companyResearch)
        .where(filter?.state ? eq(companyResearch.approvalState, filter.state) : undefined)
        .orderBy(desc(companyResearch.createdAt));
      return rows.map(mapCompany);
    },
    () => {
      let rows = [...memory.companies.values()];
      if (filter?.state) rows = rows.filter((r) => r.approvalState === filter.state);
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  );
}

export async function getCompanyResearch(id: string): Promise<CompanyResearchRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(companyResearch)
        .where(eq(companyResearch.companyResearchId, id))
        .limit(1);
      return row ? mapCompany(row) : null;
    },
    () => memory.companies.get(id) ?? null,
  );
}

export async function patchCompanyResearch(
  id: string,
  patch: Partial<CompanyResearchRow>,
): Promise<CompanyResearchRow | null> {
  return withDb(
    async (db) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.companyId !== undefined) set.companyId = patch.companyId;
      if (patch.approvalState !== undefined) set.approvalState = patch.approvalState;
      if (patch.reworkFeedback !== undefined) set.reworkFeedback = patch.reworkFeedback;
      if (patch.decidedBy !== undefined) set.decidedBy = patch.decidedBy;
      if (patch.decidedAt !== undefined)
        set.decidedAt = patch.decidedAt ? new Date(patch.decidedAt) : null;
      if (patch.whyThis !== undefined) set.whyThis = patch.whyThis;
      if (patch.evidence !== undefined) set.evidence = patch.evidence;
      if (patch.buafBudget !== undefined) set.buafBudget = patch.buafBudget;
      if (patch.buafUrgency !== undefined) set.buafUrgency = patch.buafUrgency;
      if (patch.buafAccess !== undefined) set.buafAccess = patch.buafAccess;
      if (patch.buafFit !== undefined) set.buafFit = patch.buafFit;
      if (patch.buafTotal !== undefined) set.buafTotal = patch.buafTotal;
      if (patch.temperature !== undefined) set.temperature = patch.temperature;
      const [row] = await db
        .update(companyResearch)
        .set(set)
        .where(eq(companyResearch.companyResearchId, id))
        .returning();
      return row ? mapCompany(row) : null;
    },
    () => {
      const existing = memory.companies.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      memory.companies.set(id, next);
      return next;
    },
  );
}

function mapContact(r: typeof contactResearch.$inferSelect): ContactResearchRow {
  return {
    id: r.contactResearchId,
    companyResearchId: r.companyResearchId,
    companyId: r.companyId,
    contactId: r.contactId,
    dealId: r.dealId,
    fullName: r.fullName,
    title: r.title,
    seniority: r.seniority,
    email: r.email,
    linkedinUrl: r.linkedinUrl,
    emailVerified: r.emailVerified,
    emailVerdict: r.emailVerdict,
    enrichSource: r.enrichSource,
    enrichExternalId: r.enrichExternalId,
    enrichProvider: r.enrichProvider,
    approvalState: r.approvalState as ContactResearchRow["approvalState"],
    reworkFeedback: r.reworkFeedback,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export async function insertContactResearch(
  input: Omit<ContactResearchRow, "id" | "createdAt" | "updatedAt">,
): Promise<ContactResearchRow> {
  const now = new Date().toISOString();
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(contactResearch)
        .values({
          companyResearchId: input.companyResearchId,
          companyId: input.companyId,
          contactId: input.contactId,
          dealId: input.dealId,
          fullName: input.fullName,
          title: input.title,
          seniority: input.seniority,
          email: input.email,
          linkedinUrl: input.linkedinUrl,
          emailVerified: input.emailVerified,
          emailVerdict: input.emailVerdict,
          enrichSource: input.enrichSource,
          enrichExternalId: input.enrichExternalId,
          enrichProvider: input.enrichProvider,
          approvalState: input.approvalState,
          reworkFeedback: input.reworkFeedback,
        })
        .returning();
      return mapContact(row!);
    },
    () => {
      const row: ContactResearchRow = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
      memory.contacts.set(row.id, row);
      return row;
    },
  );
}

export async function listContactResearch(filter?: {
  companyResearchId?: string;
  state?: ContactResearchRow["approvalState"];
}): Promise<ContactResearchRow[]> {
  return withDb(
    async (db) => {
      const conds = [
        filter?.companyResearchId
          ? eq(contactResearch.companyResearchId, filter.companyResearchId)
          : undefined,
        filter?.state ? eq(contactResearch.approvalState, filter.state) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(contactResearch)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(contactResearch.createdAt));
      return rows.map(mapContact);
    },
    () => {
      let rows = [...memory.contacts.values()];
      if (filter?.companyResearchId)
        rows = rows.filter((r) => r.companyResearchId === filter.companyResearchId);
      if (filter?.state) rows = rows.filter((r) => r.approvalState === filter.state);
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  );
}

export async function getContactResearch(id: string): Promise<ContactResearchRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(contactResearch)
        .where(eq(contactResearch.contactResearchId, id))
        .limit(1);
      return row ? mapContact(row) : null;
    },
    () => memory.contacts.get(id) ?? null,
  );
}

export async function patchContactResearch(
  id: string,
  patch: Partial<ContactResearchRow>,
): Promise<ContactResearchRow | null> {
  return withDb(
    async (db) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.approvalState !== undefined) set.approvalState = patch.approvalState;
      if (patch.reworkFeedback !== undefined) set.reworkFeedback = patch.reworkFeedback;
      if (patch.contactId !== undefined) set.contactId = patch.contactId;
      if (patch.dealId !== undefined) set.dealId = patch.dealId;
      if (patch.companyId !== undefined) set.companyId = patch.companyId;
      if (patch.emailVerified !== undefined) set.emailVerified = patch.emailVerified;
      if (patch.emailVerdict !== undefined) set.emailVerdict = patch.emailVerdict;
      const [row] = await db
        .update(contactResearch)
        .set(set)
        .where(eq(contactResearch.contactResearchId, id))
        .returning();
      return row ? mapContact(row) : null;
    },
    () => {
      const existing = memory.contacts.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      memory.contacts.set(id, next);
      return next;
    },
  );
}

export async function addSuppression(input: {
  email?: string | null;
  domain?: string | null;
  reason: SuppressionReason;
  source?: string | null;
}): Promise<SuppressionRow> {
  const now = new Date().toISOString();
  const email = input.email?.trim().toLowerCase() || null;
  const domain = input.domain?.trim().toLowerCase() || null;
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(suppressionEntry)
        .values({
          email,
          domain,
          reason: input.reason,
          source: input.source ?? null,
        })
        .returning();
      return {
        id: row!.suppressionEntryId,
        email: row!.email,
        domain: row!.domain,
        reason: row!.reason as SuppressionReason,
        source: row!.source,
        createdAt: iso(row!.createdAt),
      };
    },
    () => {
      const row: SuppressionRow = {
        id: randomUUID(),
        email,
        domain,
        reason: input.reason,
        source: input.source ?? null,
        createdAt: now,
      };
      memory.suppression.push(row);
      return row;
    },
  );
}

export async function listSuppression(): Promise<SuppressionRow[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(suppressionEntry)
        .orderBy(desc(suppressionEntry.createdAt));
      return rows.map((r) => ({
        id: r.suppressionEntryId,
        email: r.email,
        domain: r.domain,
        reason: r.reason as SuppressionReason,
        source: r.source,
        createdAt: iso(r.createdAt),
      }));
    },
    () => [...memory.suppression].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

export async function isSuppressed(input: {
  email?: string | null;
  domain?: string | null;
}): Promise<SuppressionRow | null> {
  const email = input.email?.trim().toLowerCase() || null;
  const domain =
    input.domain?.trim().toLowerCase() ||
    (email && email.includes("@") ? email.split("@")[1] : null) ||
    null;
  const rows = await listSuppression();
  return (
    rows.find(
      (r) =>
        (email && r.email && r.email === email) ||
        (domain && r.domain && r.domain === domain),
    ) ?? null
  );
}

export async function recordEmailEvent(input: {
  outreachItemId?: string | null;
  contactId?: string | null;
  kind: EmailEventRow["kind"];
  provider?: string;
  externalId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<EmailEventRow> {
  const now = new Date().toISOString();
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(emailEvent)
        .values({
          outreachItemId: input.outreachItemId ?? null,
          contactId: input.contactId ?? null,
          kind: input.kind,
          provider: input.provider ?? "gmail",
          externalId: input.externalId ?? null,
          payload: input.payload ?? {},
        })
        .returning();
      return {
        id: row!.emailEventId,
        outreachItemId: row!.outreachItemId,
        contactId: row!.contactId,
        kind: row!.kind as EmailEventRow["kind"],
        provider: row!.provider,
        externalId: row!.externalId,
        payload: row!.payload ?? {},
        occurredAt: iso(row!.occurredAt),
      };
    },
    () => {
      const row: EmailEventRow = {
        id: randomUUID(),
        outreachItemId: input.outreachItemId ?? null,
        contactId: input.contactId ?? null,
        kind: input.kind,
        provider: input.provider ?? "gmail",
        externalId: input.externalId ?? null,
        payload: input.payload ?? {},
        occurredAt: now,
      };
      memory.emailEvents.push(row);
      return row;
    },
  );
}

export async function listEmailEvents(filter?: {
  kind?: EmailEventRow["kind"];
  sinceIso?: string;
}): Promise<EmailEventRow[]> {
  return withDb(
    async (db) => {
      const rows = await db.select().from(emailEvent).orderBy(desc(emailEvent.occurredAt));
      return rows
        .map((r) => ({
          id: r.emailEventId,
          outreachItemId: r.outreachItemId,
          contactId: r.contactId,
          kind: r.kind as EmailEventRow["kind"],
          provider: r.provider,
          externalId: r.externalId,
          payload: r.payload ?? {},
          occurredAt: iso(r.occurredAt),
        }))
        .filter((r) => {
          if (filter?.kind && r.kind !== filter.kind) return false;
          if (filter?.sinceIso && r.occurredAt < filter.sinceIso) return false;
          return true;
        });
    },
    () =>
      memory.emailEvents.filter((r) => {
        if (filter?.kind && r.kind !== filter.kind) return false;
        if (filter?.sinceIso && r.occurredAt < filter.sinceIso) return false;
        return true;
      }),
  );
}

export async function insertIntelSignal(
  input: Omit<IntelSignalRow, "id" | "createdAt">,
): Promise<IntelSignalRow> {
  const now = new Date().toISOString();
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(intelSignal)
        .values({
          companyId: input.companyId,
          contactId: input.contactId,
          signalType: input.signalType,
          source: input.source,
          signalDate: input.signalDate,
          summary: input.summary,
          evidenceUrl: input.evidenceUrl,
        })
        .returning();
      return {
        id: row!.intelSignalId,
        companyId: row!.companyId,
        contactId: row!.contactId,
        signalType: row!.signalType,
        source: row!.source,
        signalDate: row!.signalDate,
        summary: row!.summary,
        evidenceUrl: row!.evidenceUrl,
        createdAt: iso(row!.createdAt),
      };
    },
    () => {
      const row: IntelSignalRow = { ...input, id: randomUUID(), createdAt: now };
      memory.signals.push(row);
      return row;
    },
  );
}

export async function listIntelSignals(companyId?: string): Promise<IntelSignalRow[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(intelSignal)
        .where(companyId ? eq(intelSignal.companyId, companyId) : undefined)
        .orderBy(desc(intelSignal.createdAt));
      return rows.map((r) => ({
        id: r.intelSignalId,
        companyId: r.companyId,
        contactId: r.contactId,
        signalType: r.signalType,
        source: r.source,
        signalDate: r.signalDate,
        summary: r.summary,
        evidenceUrl: r.evidenceUrl,
        createdAt: iso(r.createdAt),
      }));
    },
    () =>
      memory.signals.filter((s) => !companyId || s.companyId === companyId),
  );
}

export async function addCredit(
  kind: CreditLedgerRow["kind"],
  count = 1,
  period?: string,
): Promise<void> {
  const month =
    period ??
    (kind === "linkedin_assist"
      ? isoWeekKey(new Date())
      : new Date().toISOString().slice(0, 7));
  await withDb(
    async (db) => {
      await db.insert(salesOsCreditLedger).values({ month, kind, count });
    },
    () => {
      memory.credits.push({
        id: randomUUID(),
        month,
        kind,
        count,
        createdAt: new Date().toISOString(),
      });
    },
  );
}

function isoWeekKey(date: Date): string {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function creditUsed(
  kind: CreditLedgerRow["kind"],
  month = kind === "linkedin_assist"
    ? isoWeekKey(new Date())
    : new Date().toISOString().slice(0, 7),
): Promise<number> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(salesOsCreditLedger)
        .where(
          and(eq(salesOsCreditLedger.month, month), eq(salesOsCreditLedger.kind, kind)),
        );
      return rows.reduce((sum, r) => sum + r.count, 0);
    },
    () =>
      memory.credits
        .filter((c) => c.month === month && c.kind === kind)
        .reduce((sum, r) => sum + r.count, 0),
  );
}

export async function insertEvolveProposal(input: {
  focus: string;
  summary: string;
  proposed: Record<string, unknown>;
}): Promise<EvolveProposalRow> {
  const now = new Date().toISOString();
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(salesOsEvolveProposal)
        .values({
          focus: input.focus,
          summary: input.summary,
          proposed: input.proposed,
          state: "proposed",
        })
        .returning();
      return {
        id: row!.salesOsEvolveProposalId,
        focus: row!.focus,
        summary: row!.summary,
        proposed: row!.proposed,
        state: row!.state as EvolveProposalRow["state"],
        createdAt: iso(row!.createdAt),
        decidedAt: row!.decidedAt ? iso(row!.decidedAt) : null,
      };
    },
    () => {
      const row: EvolveProposalRow = {
        id: randomUUID(),
        focus: input.focus,
        summary: input.summary,
        proposed: input.proposed,
        state: "proposed",
        createdAt: now,
        decidedAt: null,
      };
      memory.proposals.push(row);
      return row;
    },
  );
}

export async function listEvolveProposals(): Promise<EvolveProposalRow[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(salesOsEvolveProposal)
        .orderBy(desc(salesOsEvolveProposal.createdAt));
      return rows.map((r) => ({
        id: r.salesOsEvolveProposalId,
        focus: r.focus,
        summary: r.summary,
        proposed: r.proposed,
        state: r.state as EvolveProposalRow["state"],
        createdAt: iso(r.createdAt),
        decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
      }));
    },
    () => [...memory.proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

export async function decideEvolveProposal(
  id: string,
  state: "applied" | "rejected",
): Promise<EvolveProposalRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .update(salesOsEvolveProposal)
        .set({ state, decidedAt: new Date() })
        .where(eq(salesOsEvolveProposal.salesOsEvolveProposalId, id))
        .returning();
      if (!row) return null;
      return {
        id: row.salesOsEvolveProposalId,
        focus: row.focus,
        summary: row.summary,
        proposed: row.proposed,
        state: row.state as EvolveProposalRow["state"],
        createdAt: iso(row.createdAt),
        decidedAt: row.decidedAt ? iso(row.decidedAt) : null,
      };
    },
    () => {
      const row = memory.proposals.find((p) => p.id === id);
      if (!row) return null;
      row.state = state;
      row.decidedAt = new Date().toISOString();
      return row;
    },
  );
}
