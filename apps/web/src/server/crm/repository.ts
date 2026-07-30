import {
  activity,
  and,
  company,
  contact,
  crmNote,
  crmTask,
  deal,
  desc,
  eq,
  sql,
  CRM_PIPELINE_STAGES,
  CRM_PIPELINE_STAGE_LABELS,
  type Db,
} from "@hrmny/db";
import { getDb } from "../db";
import { getCrmMemory, newId } from "./memory";
import type {
  ActivityRow,
  CompanyRow,
  ContactRow,
  CrmNoteRow,
  CrmTaskRow,
  DealRow,
} from "./types";

function iso(d: Date | string | null | undefined): string {
  if (!d) return new Date().toISOString();
  return d instanceof Date ? d.toISOString() : String(d);
}

function mapCompany(r: typeof company.$inferSelect): CompanyRow {
  return {
    companyId: r.companyId,
    name: r.name,
    sector: r.sector,
    market: r.market,
    website: r.website,
    linkedinUrl: r.linkedinUrl,
    notes: r.notes,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function mapContact(r: typeof contact.$inferSelect): ContactRow {
  return {
    contactId: r.contactId,
    companyId: r.companyId,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    title: r.title,
    linkedinUrl: r.linkedinUrl,
    emailVerified: r.emailVerified,
    isPrimary: r.isPrimary,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function mapDeal(r: typeof deal.$inferSelect): DealRow {
  return {
    dealId: r.dealId,
    companyId: r.companyId ?? null,
    primaryContactId: r.primaryContactId ?? null,
    companyName: r.companyName,
    sector: r.sector,
    stage: r.stage,
    closeOutcome: r.closeOutcome,
    lostReason: r.lostReason,
    leadSourceLane: r.leadSourceLane,
    buafBudget: r.buafBudget,
    buafUrgency: r.buafUrgency,
    buafAccess: r.buafAccess,
    buafFit: r.buafFit,
    buafTemperature: r.buafTemperature,
    emailVerified: r.emailVerified,
    quoteValue: r.quoteValue,
    internalCost: r.internalCost,
    marginPct: r.marginPct,
    discountPct: r.discountPct,
    discountApprovalTier: r.discountApprovalTier,
    vendorHandlingFeePct: r.vendorHandlingFeePct,
    ownerEmployeeId: r.ownerEmployeeId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function mapActivity(r: typeof activity.$inferSelect): ActivityRow {
  return {
    activityId: r.activityId,
    type: r.type,
    subject: r.subject,
    body: r.body,
    companyId: r.companyId,
    contactId: r.contactId,
    dealId: r.dealId,
    actorEmployeeId: r.actorEmployeeId,
    occurredAt: iso(r.occurredAt),
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function mapNote(r: typeof crmNote.$inferSelect): CrmNoteRow {
  return {
    crmNoteId: r.crmNoteId,
    body: r.body,
    companyId: r.companyId,
    contactId: r.contactId,
    dealId: r.dealId,
    authorEmployeeId: r.authorEmployeeId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function mapTask(r: typeof crmTask.$inferSelect): CrmTaskRow {
  return {
    crmTaskId: r.crmTaskId,
    title: r.title,
    status: r.status,
    dueDate: r.dueDate,
    companyId: r.companyId,
    contactId: r.contactId,
    dealId: r.dealId,
    ownerEmployeeId: r.ownerEmployeeId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function pipelineStages() {
  return CRM_PIPELINE_STAGES.map((key) => ({
    key,
    label: CRM_PIPELINE_STAGE_LABELS[key],
  }));
}

export type CrmBackend = "postgres" | "memory";

export function crmBackendMode(): CrmBackend {
  return getDb() ? "postgres" : "memory";
}

async function withDb<T>(
  fn: (db: Db) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  const db = getDb();
  if (!db) return fallback();
  return fn(db);
}

// ── Companies ──────────────────────────────────────────────

export async function listCompanies(q?: {
  search?: string;
}): Promise<CompanyRow[]> {
  return withDb(
    async (db) => {
      const rows = await db.select().from(company).orderBy(company.name);
      let out = rows.map(mapCompany);
      if (q?.search) {
        const s = q.search.toLowerCase();
        out = out.filter((c) => c.name.toLowerCase().includes(s));
      }
      return out;
    },
    () => {
      let rows = [...getCrmMemory().companies.values()];
      if (q?.search) {
        const s = q.search.toLowerCase();
        rows = rows.filter((c) => c.name.toLowerCase().includes(s));
      }
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    },
  );
}

export async function getCompany(id: string): Promise<CompanyRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(company)
        .where(eq(company.companyId, id))
        .limit(1);
      return row ? mapCompany(row) : null;
    },
    () => getCrmMemory().companies.get(id) ?? null,
  );
}

export async function createCompany(input: {
  name: string;
  sector?: string | null;
  market?: "UAE" | "KSA" | "Both" | null;
  website?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
}): Promise<CompanyRow> {
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(company)
        .values({
          name: input.name,
          sector: input.sector ?? null,
          market: input.market ?? "UAE",
          website: input.website ?? null,
          linkedinUrl: input.linkedinUrl ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return mapCompany(row!);
    },
    () => {
      const t = new Date().toISOString();
      const row: CompanyRow = {
        companyId: newId(),
        name: input.name,
        sector: input.sector ?? null,
        market: input.market ?? "UAE",
        website: input.website ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        notes: input.notes ?? null,
        createdAt: t,
        updatedAt: t,
      };
      getCrmMemory().companies.set(row.companyId, row);
      return row;
    },
  );
}

export async function updateCompany(
  id: string,
  input: Partial<{
    name: string;
    sector: string | null;
    market: "UAE" | "KSA" | "Both" | null;
    website: string | null;
    linkedinUrl: string | null;
    notes: string | null;
  }>,
): Promise<CompanyRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .update(company)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(company.companyId, id))
        .returning();
      return row ? mapCompany(row) : null;
    },
    () => {
      const mem = getCrmMemory();
      const existing = mem.companies.get(id);
      if (!existing) return null;
      const next = {
        ...existing,
        ...input,
        updatedAt: new Date().toISOString(),
      };
      mem.companies.set(id, next);
      return next;
    },
  );
}

// ── Contacts ───────────────────────────────────────────────

export async function listContacts(q?: {
  companyId?: string;
  search?: string;
}): Promise<ContactRow[]> {
  return withDb(
    async (db) => {
      let rows = await db.select().from(contact).orderBy(contact.firstName);
      if (q?.companyId) {
        rows = rows.filter((r) => r.companyId === q.companyId);
      }
      let out = rows.map(mapContact);
      if (q?.search) {
        const s = q.search.toLowerCase();
        out = out.filter(
          (c) =>
            c.firstName.toLowerCase().includes(s) ||
            (c.lastName ?? "").toLowerCase().includes(s) ||
            (c.email ?? "").toLowerCase().includes(s),
        );
      }
      return out;
    },
    () => {
      let rows = [...getCrmMemory().contacts.values()];
      if (q?.companyId) rows = rows.filter((c) => c.companyId === q.companyId);
      if (q?.search) {
        const s = q.search.toLowerCase();
        rows = rows.filter(
          (c) =>
            c.firstName.toLowerCase().includes(s) ||
            (c.lastName ?? "").toLowerCase().includes(s) ||
            (c.email ?? "").toLowerCase().includes(s),
        );
      }
      return rows;
    },
  );
}

export async function getContact(id: string): Promise<ContactRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(contact)
        .where(eq(contact.contactId, id))
        .limit(1);
      return row ? mapContact(row) : null;
    },
    () => getCrmMemory().contacts.get(id) ?? null,
  );
}

export async function createContact(input: {
  companyId?: string | null;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  linkedinUrl?: string | null;
  isPrimary?: boolean;
}): Promise<ContactRow> {
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(contact)
        .values({
          companyId: input.companyId ?? null,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          title: input.title ?? null,
          linkedinUrl: input.linkedinUrl ?? null,
          isPrimary: input.isPrimary ?? false,
        })
        .returning();
      return mapContact(row!);
    },
    () => {
      const t = new Date().toISOString();
      const row: ContactRow = {
        contactId: newId(),
        companyId: input.companyId ?? null,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        title: input.title ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        emailVerified: false,
        isPrimary: input.isPrimary ?? false,
        createdAt: t,
        updatedAt: t,
      };
      getCrmMemory().contacts.set(row.contactId, row);
      return row;
    },
  );
}

export async function updateContact(
  id: string,
  input: Partial<{
    companyId: string | null;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
    linkedinUrl: string | null;
    emailVerified: boolean;
    isPrimary: boolean;
  }>,
): Promise<ContactRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .update(contact)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(contact.contactId, id))
        .returning();
      return row ? mapContact(row) : null;
    },
    () => {
      const mem = getCrmMemory();
      const existing = mem.contacts.get(id);
      if (!existing) return null;
      const next = {
        ...existing,
        ...input,
        updatedAt: new Date().toISOString(),
      };
      mem.contacts.set(id, next);
      return next;
    },
  );
}

// ── Deals ──────────────────────────────────────────────────

export async function listDeals(q?: {
  stage?: string;
  companyId?: string;
  lane?: string;
}): Promise<DealRow[]> {
  return withDb(
    async (db) => {
      const rows = await db.select().from(deal).orderBy(desc(deal.updatedAt));
      let out = rows.map(mapDeal);
      if (q?.stage) out = out.filter((d) => d.stage === q.stage);
      if (q?.companyId) out = out.filter((d) => d.companyId === q.companyId);
      if (q?.lane) out = out.filter((d) => d.leadSourceLane === q.lane);
      return out;
    },
    () => {
      let rows = [...getCrmMemory().deals.values()];
      if (q?.stage) rows = rows.filter((d) => d.stage === q.stage);
      if (q?.companyId) rows = rows.filter((d) => d.companyId === q.companyId);
      if (q?.lane) rows = rows.filter((d) => d.leadSourceLane === q.lane);
      return rows;
    },
  );
}

export async function getDeal(id: string): Promise<DealRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(deal)
        .where(eq(deal.dealId, id))
        .limit(1);
      return row ? mapDeal(row) : null;
    },
    () => getCrmMemory().deals.get(id) ?? null,
  );
}

export async function createDeal(input: {
  companyName: string;
  companyId?: string | null;
  primaryContactId?: string | null;
  sector?: string | null;
  leadSourceLane?: string;
  ownerEmployeeId?: string | null;
}): Promise<DealRow> {
  const lane = (input.leadSourceLane ??
    "relationship_led") as DealRow["leadSourceLane"];
  return withDb(
    async (db) => {
      let companyName = input.companyName;
      if (input.companyId) {
        const [c] = await db
          .select()
          .from(company)
          .where(eq(company.companyId, input.companyId))
          .limit(1);
        if (c) companyName = c.name;
      }
      const [row] = await db
        .insert(deal)
        .values({
          companyId: input.companyId ?? null,
          primaryContactId: input.primaryContactId ?? null,
          companyName,
          sector: input.sector ?? null,
          stage: "discover",
          leadSourceLane: lane as typeof deal.$inferInsert.leadSourceLane,
          vendorHandlingFeePct: "20.00",
          ownerEmployeeId: input.ownerEmployeeId ?? null,
          quoteValue: "0.00",
          internalCost: "0.00",
          marginPct: "0.00",
        })
        .returning();
      return mapDeal(row!);
    },
    () => {
      const t = new Date().toISOString();
      let companyName = input.companyName;
      if (input.companyId) {
        const c = getCrmMemory().companies.get(input.companyId);
        if (c) companyName = c.name;
      }
      const row: DealRow = {
        dealId: newId(),
        companyId: input.companyId ?? null,
        primaryContactId: input.primaryContactId ?? null,
        companyName,
        sector: input.sector ?? null,
        stage: "discover",
        closeOutcome: null,
        lostReason: null,
        leadSourceLane: lane,
        buafBudget: null,
        buafUrgency: null,
        buafAccess: null,
        buafFit: null,
        buafTemperature: null,
        emailVerified: false,
        quoteValue: "0.00",
        internalCost: "0.00",
        marginPct: "0.00",
        discountPct: null,
        discountApprovalTier: null,
        vendorHandlingFeePct: "20.00",
        ownerEmployeeId: input.ownerEmployeeId ?? null,
        createdAt: t,
        updatedAt: t,
      };
      getCrmMemory().deals.set(row.dealId, row);
      return row;
    },
  );
}

export async function updateDeal(
  id: string,
  input: Partial<{
    companyName: string;
    companyId: string | null;
    primaryContactId: string | null;
    sector: string | null;
    ownerEmployeeId: string | null;
    buafBudget: boolean | null;
    buafUrgency: boolean | null;
    buafAccess: boolean | null;
    buafFit: boolean | null;
    buafTemperature: DealRow["buafTemperature"];
    emailVerified: boolean;
    quoteValue: string | null;
    internalCost: string | null;
    marginPct: string | null;
    closeOutcome: DealRow["closeOutcome"];
    lostReason: string | null;
  }>,
): Promise<DealRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .update(deal)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(deal.dealId, id))
        .returning();
      return row ? mapDeal(row) : null;
    },
    () => {
      const mem = getCrmMemory();
      const existing = mem.deals.get(id);
      if (!existing) return null;
      const next = {
        ...existing,
        ...input,
        updatedAt: new Date().toISOString(),
      };
      mem.deals.set(id, next);
      return next;
    },
  );
}

export async function moveDealStage(input: {
  dealId: string;
  to: string;
  actorEmployeeId?: string | null;
}): Promise<{ ok: true; deal: DealRow } | { ok: false; reason: string }> {
  if (
    !CRM_PIPELINE_STAGES.includes(
      input.to as (typeof CRM_PIPELINE_STAGES)[number],
    )
  ) {
    return { ok: false, reason: `Invalid stage: ${input.to}` };
  }
  const existing = await getDeal(input.dealId);
  if (!existing) return { ok: false, reason: "Deal not found" };
  const from = existing.stage;

  const updated = await withDb(
    async (db) => {
      const [row] = await db
        .update(deal)
        .set({
          stage: input.to as typeof deal.$inferInsert.stage,
          updatedAt: new Date(),
        })
        .where(eq(deal.dealId, input.dealId))
        .returning();
      return row ? mapDeal(row) : null;
    },
    () => {
      const mem = getCrmMemory();
      const d = mem.deals.get(input.dealId);
      if (!d) return null;
      const next = {
        ...d,
        stage: input.to,
        updatedAt: new Date().toISOString(),
      };
      mem.deals.set(input.dealId, next);
      return next;
    },
  );

  if (!updated) return { ok: false, reason: "Update failed" };

  await createActivity({
    type: "stage_change",
    subject: `Stage ${from} → ${input.to}`,
    body: null,
    dealId: input.dealId,
    companyId: updated.companyId,
    actorEmployeeId: input.actorEmployeeId ?? null,
    metadata: { from, to: input.to },
  });

  return { ok: true, deal: updated };
}

// ── Activities ─────────────────────────────────────────────

export async function listActivities(q?: {
  dealId?: string;
  companyId?: string;
  contactId?: string;
  limit?: number;
}): Promise<ActivityRow[]> {
  const limit = q?.limit ?? 50;
  return withDb(
    async (db) => {
      const conditions = [];
      if (q?.dealId) conditions.push(eq(activity.dealId, q.dealId));
      if (q?.companyId) conditions.push(eq(activity.companyId, q.companyId));
      if (q?.contactId) conditions.push(eq(activity.contactId, q.contactId));
      const rows = await db
        .select()
        .from(activity)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(activity.occurredAt))
        .limit(limit);
      return rows.map(mapActivity);
    },
    () => {
      let rows = [...getCrmMemory().activities.values()];
      if (q?.dealId) rows = rows.filter((a) => a.dealId === q.dealId);
      if (q?.companyId) rows = rows.filter((a) => a.companyId === q.companyId);
      if (q?.contactId) rows = rows.filter((a) => a.contactId === q.contactId);
      return rows
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, limit);
    },
  );
}

export async function createActivity(input: {
  type: ActivityRow["type"];
  subject?: string | null;
  body?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  actorEmployeeId?: string | null;
  metadata?: Record<string, unknown>;
  /** Historical timestamp (e.g. importing a past outreach). Defaults to now. */
  occurredAt?: Date | string | null;
}): Promise<ActivityRow> {
  const occurredAt = parseOccurredAt(input.occurredAt);
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(activity)
        .values({
          type: input.type as typeof activity.$inferInsert.type,
          subject: input.subject ?? null,
          body: input.body ?? null,
          companyId: input.companyId ?? null,
          contactId: input.contactId ?? null,
          dealId: input.dealId ?? null,
          actorEmployeeId: input.actorEmployeeId ?? null,
          metadata: input.metadata ?? {},
          ...(occurredAt ? { occurredAt } : {}),
        })
        .returning();
      return mapActivity(row!);
    },
    () => {
      const t = new Date().toISOString();
      const row: ActivityRow = {
        activityId: newId(),
        type: input.type,
        subject: input.subject ?? null,
        body: input.body ?? null,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        actorEmployeeId: input.actorEmployeeId ?? null,
        occurredAt: occurredAt ? occurredAt.toISOString() : t,
        metadata: input.metadata ?? {},
        createdAt: t,
        updatedAt: t,
      };
      getCrmMemory().activities.set(row.activityId, row);
      return row;
    },
  );
}

/** Parse a caller-supplied historical timestamp; ignore unparseable values. */
function parseOccurredAt(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Notes ──────────────────────────────────────────────────

export async function listNotes(q?: {
  dealId?: string;
  companyId?: string;
  contactId?: string;
}): Promise<CrmNoteRow[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(crmNote)
        .orderBy(desc(crmNote.createdAt));
      return rows.map(mapNote).filter((n) => {
        if (q?.dealId && n.dealId !== q.dealId) return false;
        if (q?.companyId && n.companyId !== q.companyId) return false;
        if (q?.contactId && n.contactId !== q.contactId) return false;
        return true;
      });
    },
    () => {
      let rows = [...getCrmMemory().notes.values()];
      if (q?.dealId) rows = rows.filter((n) => n.dealId === q.dealId);
      if (q?.companyId) rows = rows.filter((n) => n.companyId === q.companyId);
      if (q?.contactId) rows = rows.filter((n) => n.contactId === q.contactId);
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  );
}

export async function createNote(input: {
  body: string;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  authorEmployeeId?: string | null;
}): Promise<CrmNoteRow> {
  const note = await withDb(
    async (db) => {
      const [row] = await db
        .insert(crmNote)
        .values({
          body: input.body,
          companyId: input.companyId ?? null,
          contactId: input.contactId ?? null,
          dealId: input.dealId ?? null,
          authorEmployeeId: input.authorEmployeeId ?? null,
        })
        .returning();
      return mapNote(row!);
    },
    () => {
      const t = new Date().toISOString();
      const row: CrmNoteRow = {
        crmNoteId: newId(),
        body: input.body,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        authorEmployeeId: input.authorEmployeeId ?? null,
        createdAt: t,
        updatedAt: t,
      };
      getCrmMemory().notes.set(row.crmNoteId, row);
      return row;
    },
  );
  await createActivity({
    type: "note",
    subject: "Note added",
    body: input.body.slice(0, 200),
    companyId: input.companyId,
    contactId: input.contactId,
    dealId: input.dealId,
    actorEmployeeId: input.authorEmployeeId,
  });
  return note;
}

// ── CRM tasks ──────────────────────────────────────────────

export async function listCrmTasks(q?: {
  dealId?: string;
  companyId?: string;
  status?: string;
  ownerEmployeeId?: string;
}): Promise<CrmTaskRow[]> {
  return withDb(
    async (db) => {
      const rows = await db.select().from(crmTask).orderBy(crmTask.dueDate);
      return rows.map(mapTask).filter((t) => {
        if (q?.dealId && t.dealId !== q.dealId) return false;
        if (q?.companyId && t.companyId !== q.companyId) return false;
        if (q?.status && t.status !== q.status) return false;
        if (q?.ownerEmployeeId && t.ownerEmployeeId !== q.ownerEmployeeId)
          return false;
        return true;
      });
    },
    () => {
      let rows = [...getCrmMemory().tasks.values()];
      if (q?.dealId) rows = rows.filter((t) => t.dealId === q.dealId);
      if (q?.companyId) rows = rows.filter((t) => t.companyId === q.companyId);
      if (q?.status) rows = rows.filter((t) => t.status === q.status);
      if (q?.ownerEmployeeId)
        rows = rows.filter((t) => t.ownerEmployeeId === q.ownerEmployeeId);
      return rows;
    },
  );
}

export async function createCrmTask(input: {
  title: string;
  dueDate?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  ownerEmployeeId?: string | null;
}): Promise<CrmTaskRow> {
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(crmTask)
        .values({
          title: input.title,
          dueDate: input.dueDate ?? null,
          companyId: input.companyId ?? null,
          contactId: input.contactId ?? null,
          dealId: input.dealId ?? null,
          ownerEmployeeId: input.ownerEmployeeId ?? null,
        })
        .returning();
      return mapTask(row!);
    },
    () => {
      const t = new Date().toISOString();
      const row: CrmTaskRow = {
        crmTaskId: newId(),
        title: input.title,
        status: "open",
        dueDate: input.dueDate ?? null,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        ownerEmployeeId: input.ownerEmployeeId ?? null,
        createdAt: t,
        updatedAt: t,
      };
      getCrmMemory().tasks.set(row.crmTaskId, row);
      return row;
    },
  );
}

export async function updateCrmTask(
  id: string,
  input: Partial<{
    title: string;
    status: CrmTaskRow["status"];
    dueDate: string | null;
    ownerEmployeeId: string | null;
  }>,
): Promise<CrmTaskRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .update(crmTask)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(crmTask.crmTaskId, id))
        .returning();
      return row ? mapTask(row) : null;
    },
    () => {
      const mem = getCrmMemory();
      const existing = mem.tasks.get(id);
      if (!existing) return null;
      const next = {
        ...existing,
        ...input,
        updatedAt: new Date().toISOString(),
      };
      mem.tasks.set(id, next);
      return next;
    },
  );
}

export type CrmHealth = {
  backend: CrmBackend;
  companies: number;
  contacts: number;
  deals: number;
  activities: number;
  notes: number;
  tasks: number;
};

export async function crmHealth(): Promise<CrmHealth> {
  const fallback = (): CrmHealth => {
    const m = getCrmMemory();
    return {
      backend: "memory",
      companies: m.companies.size,
      contacts: m.contacts.size,
      deals: m.deals.size,
      activities: m.activities.size,
      notes: m.notes.size,
      tasks: m.tasks.size,
    };
  };

  return withDb(async (db): Promise<CrmHealth> => {
    const count = async (
      table: typeof company | typeof contact | typeof deal,
    ): Promise<number> => {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(table);
      return Number(r?.n ?? 0);
    };
    return {
      backend: "postgres",
      companies: await count(company),
      contacts: await count(contact),
      deals: await count(deal),
      activities: Number(
        (await db.select({ n: sql<number>`count(*)::int` }).from(activity))[0]
          ?.n ?? 0,
      ),
      notes: Number(
        (await db.select({ n: sql<number>`count(*)::int` }).from(crmNote))[0]
          ?.n ?? 0,
      ),
      tasks: Number(
        (await db.select({ n: sql<number>`count(*)::int` }).from(crmTask))[0]
          ?.n ?? 0,
      ),
    };
  }, fallback);
}
