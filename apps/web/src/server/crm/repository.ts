import {
  activity,
  and,
  company,
  contact,
  contactEdges,
  crmNote,
  crmQuote,
  crmTask,
  deal,
  desc,
  eq,
  ilike,
  or,
  sql,
  ticket,
  CRM_PIPELINE_STAGES,
  CRM_PIPELINE_STAGE_DESCRIPTIONS,
  CRM_PIPELINE_STAGE_LABELS,
  type Db,
} from "@hrmny/db";
import { getDb } from "../db";
import { listContactEdges } from "../leadgen/store";
import { getCrmMemory, newId } from "./memory";
import type {
  ActivityRow,
  CompanyRow,
  ContactRow,
  CrmNoteRow,
  CrmQuoteRow,
  CrmTaskRow,
  DealRow,
  QuoteLineItem,
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
    recordClass: r.recordClass,
    classificationReason: r.classificationReason,
    opportunityName: r.opportunityName,
    expectedCloseDate: r.expectedCloseDate,
    closedAt: r.closedAt ? iso(r.closedAt) : null,
    stageEnteredAt: r.stageEnteredAt ? iso(r.stageEnteredAt) : null,
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
    description: CRM_PIPELINE_STAGE_DESCRIPTIONS[key],
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
  market?: CompanyRow["market"];
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
    market: CompanyRow["market"];
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
    opportunityName: string | null;
    expectedCloseDate: string | null;
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
    discountPct: string | null;
    discountApprovalTier: CrmQuoteRow["discountApprovalTier"];
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
        ...(input.closeOutcome !== undefined &&
        input.closeOutcome !== existing.closeOutcome
          ? {
              closedAt:
                input.closeOutcome === "won" || input.closeOutcome === "lost"
                  ? new Date().toISOString()
                  : null,
            }
          : {}),
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
          stageEnteredAt: input.to === from ? undefined : new Date(),
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
        stageEnteredAt:
          input.to === from ? d.stageEnteredAt : new Date().toISOString(),
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

function canReadPrivateActivity(
  metadata: Record<string, unknown>,
  employeeId?: string,
): boolean {
  return (
    !!employeeId &&
    (metadata.ownerEmployeeId === employeeId ||
      (Array.isArray(metadata.authorizedEmployeeIds) &&
        metadata.authorizedEmployeeIds.includes(employeeId)))
  );
}

export async function listActivities(q?: {
  search?: string;
  dealId?: string;
  companyId?: string;
  contactId?: string;
  limit?: number;
  /** Set only from the authenticated server context. Private archives fail closed. */
  viewerEmployeeId?: string;
}): Promise<ActivityRow[]> {
  const limit = q?.limit ?? 50;
  const rows = await withDb(
    async (db) => {
      const conditions = [
        sql`(coalesce(${activity.metadata}->>'visibility', '') <> 'private'
        or (${q?.viewerEmployeeId ?? null}::text is not null and
          (${activity.metadata}->>'ownerEmployeeId' = ${q?.viewerEmployeeId ?? null}
           or ${activity.metadata}->'authorizedEmployeeIds' ? ${q?.viewerEmployeeId ?? ""})))`,
      ];
      if (q?.dealId) conditions.push(eq(activity.dealId, q.dealId));
      if (q?.companyId) conditions.push(eq(activity.companyId, q.companyId));
      if (q?.contactId) conditions.push(eq(activity.contactId, q.contactId));
      if (q?.search)
        conditions.push(
          or(
            ilike(activity.subject, `%${q.search}%`),
            ilike(activity.body, `%${q.search}%`),
          )!,
        );
      const rows = await db
        .select()
        .from(activity)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(activity.occurredAt))
        .limit(limit);
      return rows.map(mapActivity);
    },
    () => {
      let rows = [...getCrmMemory().activities.values()].filter(
        (row) =>
          row.metadata.visibility !== "private" ||
          canReadPrivateActivity(row.metadata, q?.viewerEmployeeId),
      );
      if (q?.dealId) rows = rows.filter((a) => a.dealId === q.dealId);
      if (q?.companyId) rows = rows.filter((a) => a.companyId === q.companyId);
      if (q?.contactId) rows = rows.filter((a) => a.contactId === q.contactId);
      if (q?.search) {
        const term = q.search.toLowerCase();
        rows = rows.filter((row) =>
          `${row.subject ?? ""} ${row.body ?? ""}`.toLowerCase().includes(term),
        );
      }
      return rows
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, limit);
    },
  );
  // Old imports/replies may contain full emails. Shared timelines and AI summaries
  // receive status only; the original message remains in the private mailbox.
  return rows
    .filter(
      (row) =>
        row.metadata.visibility !== "private" ||
        canReadPrivateActivity(row.metadata, q?.viewerEmployeeId),
    )
    .map((row) =>
      row.type === "email" &&
      !canReadPrivateActivity(row.metadata, q?.viewerEmployeeId)
        ? {
            ...row,
            subject: "Email activity",
            body: "Message content is available in the owner's private inbox.",
            metadata: {
              direction: row.metadata.direction,
              provider: row.metadata.provider,
              emailEventId: row.metadata.emailEventId,
            },
          }
        : row,
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

// ── Quotes ─────────────────────────────────────────────────

function mapQuote(r: typeof crmQuote.$inferSelect): CrmQuoteRow {
  return {
    quoteId: r.quoteId,
    dealId: r.dealId,
    version: r.version,
    lineItems: (r.lineItems ?? []) as QuoteLineItem[],
    quoteValue: r.quoteValue ?? "0.00",
    internalCost: r.internalCost ?? "0.00",
    marginPct: r.marginPct ?? "0.00",
    discountPct: r.discountPct,
    discountApprovalTier:
      r.discountApprovalTier as CrmQuoteRow["discountApprovalTier"],
    status: r.status as CrmQuoteRow["status"],
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export async function listQuotesByDeal(dealId: string): Promise<CrmQuoteRow[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(crmQuote)
        .where(eq(crmQuote.dealId, dealId))
        .orderBy(desc(crmQuote.version));
      return rows.map(mapQuote);
    },
    () =>
      [...getCrmMemory().quotes.values()]
        .filter((q) => q.dealId === dealId)
        .sort((a, b) => b.version - a.version),
  );
}

export async function getQuote(quoteId: string): Promise<CrmQuoteRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(crmQuote)
        .where(eq(crmQuote.quoteId, quoteId))
        .limit(1);
      return row ? mapQuote(row) : null;
    },
    () => getCrmMemory().quotes.get(quoteId) ?? null,
  );
}

export async function updateQuoteStatus(
  quoteId: string,
  status: CrmQuoteRow["status"],
): Promise<CrmQuoteRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .update(crmQuote)
        .set({ status, updatedAt: new Date() })
        .where(eq(crmQuote.quoteId, quoteId))
        .returning();
      return row ? mapQuote(row) : null;
    },
    () => {
      const row = getCrmMemory().quotes.get(quoteId);
      if (!row) return null;
      const updated = {
        ...row,
        status,
        updatedAt: new Date().toISOString(),
      };
      getCrmMemory().quotes.set(quoteId, updated);
      return updated;
    },
  );
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** Append a new quote version for the deal (version = max existing + 1). */
export async function createQuoteVersion(input: {
  dealId: string;
  lineItems: QuoteLineItem[];
  quoteValue: string;
  internalCost: string;
  marginPct: string;
  discountPct?: string | null;
  discountApprovalTier?: CrmQuoteRow["discountApprovalTier"];
  status?: CrmQuoteRow["status"];
  createdBy?: string | null;
}): Promise<CrmQuoteRow> {
  const common = {
    dealId: input.dealId,
    lineItems: input.lineItems,
    quoteValue: input.quoteValue,
    internalCost: input.internalCost,
    marginPct: input.marginPct,
    discountPct: input.discountPct ?? null,
    discountApprovalTier: input.discountApprovalTier ?? null,
    status: input.status ?? ("draft" as const),
    createdBy: input.createdBy ?? null,
  };
  return withDb(
    async (db) => {
      const insertNext = async () => {
        const [r] = await db
          .select({ v: sql<number>`coalesce(max(version), 0)::int` })
          .from(crmQuote)
          .where(eq(crmQuote.dealId, input.dealId));
        const [row] = await db
          .insert(crmQuote)
          .values({ ...common, version: Number(r?.v ?? 0) + 1 })
          .returning();
        return mapQuote(row!);
      };
      try {
        return await insertNext();
      } catch (e) {
        // ponytail: unique(deal_id, version) lost a concurrent save — one
        // re-read + retry is plenty at this write volume; move version
        // allocation into SQL (insert-select) if saves ever truly contend.
        if (!isUniqueViolation(e)) throw e;
        return insertNext();
      }
    },
    () => {
      // Version computed synchronously against the map at insert time — no
      // await between read and write, so concurrent saves can't collide.
      const mem = getCrmMemory();
      let max = 0;
      for (const q of mem.quotes.values()) {
        if (q.dealId === input.dealId && q.version > max) max = q.version;
      }
      const t = new Date().toISOString();
      const row: CrmQuoteRow = {
        quoteId: newId(),
        ...common,
        version: max + 1,
        createdAt: t,
        updatedAt: t,
      };
      getCrmMemory().quotes.set(row.quoteId, row);
      return row;
    },
  );
}

// ── Dedupe & merge ─────────────────────────────────────────

/** Normalize a website URL to a bare domain (strip scheme, www, path). */
export function normalizeDomain(
  website: string | null | undefined,
): string | null {
  if (!website?.trim()) return null;
  const stripped = website
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!;
  return stripped || null;
}

export type DedupeCandidates = {
  contacts: { key: string; contactIds: string[] }[];
  companies: { key: string; companyIds: string[] }[];
};

/** Exact-email contact groups; company groups by website domain or ci name. */
export async function dedupeCandidates(): Promise<DedupeCandidates> {
  // ponytail: full-scan grouping in app code (works for both backends);
  // move to SQL GROUP BY when row counts make it slow.
  const [contacts, companies] = await Promise.all([
    listContacts(),
    listCompanies(),
  ]);

  const byEmail = new Map<string, string[]>();
  for (const c of contacts) {
    const key = c.email?.trim().toLowerCase();
    if (!key) continue;
    byEmail.set(key, [...(byEmail.get(key) ?? []), c.contactId]);
  }

  const byCompanyKey = new Map<string, string[]>();
  for (const co of companies) {
    const key = normalizeDomain(co.website) ?? co.name.trim().toLowerCase();
    byCompanyKey.set(key, [...(byCompanyKey.get(key) ?? []), co.companyId]);
  }

  return {
    contacts: [...byEmail.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, contactIds]) => ({ key, contactIds })),
    companies: [...byCompanyKey.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, companyIds]) => ({ key, companyIds })),
  };
}

export type MergeResult =
  | { ok: true; survivorId: string; duplicateId: string }
  | { ok: false; reason: string };

/** Re-point deal/activity/note/task FKs to survivor, delete duplicate. */
export async function mergeContacts(input: {
  survivorId: string;
  duplicateId: string;
}): Promise<MergeResult> {
  const { survivorId, duplicateId } = input;
  if (survivorId === duplicateId) {
    return { ok: false, reason: "Survivor and duplicate are the same contact" };
  }
  const [survivor, duplicate] = await Promise.all([
    getContact(survivorId),
    getContact(duplicateId),
  ]);
  if (!survivor) return { ok: false, reason: "Survivor contact not found" };
  if (!duplicate) return { ok: false, reason: "Duplicate contact not found" };

  return withDb(
    async (db) => {
      await db.transaction(async (tx) => {
        await tx
          .update(deal)
          .set({ primaryContactId: survivorId })
          .where(eq(deal.primaryContactId, duplicateId));
        await tx
          .update(activity)
          .set({ contactId: survivorId })
          .where(eq(activity.contactId, duplicateId));
        await tx
          .update(crmNote)
          .set({ contactId: survivorId })
          .where(eq(crmNote.contactId, duplicateId));
        await tx
          .update(crmTask)
          .set({ contactId: survivorId })
          .where(eq(crmTask.contactId, duplicateId));
        // contact_edges (0060 lead_intel): drop edges that would become
        // self-loops (duplicate ↔ survivor — CHECK from<>to would reject the
        // repoint), then repoint both endpoints.
        await tx
          .delete(contactEdges)
          .where(
            or(
              and(
                eq(contactEdges.fromContact, duplicateId),
                eq(contactEdges.toContact, survivorId),
              ),
              and(
                eq(contactEdges.fromContact, survivorId),
                eq(contactEdges.toContact, duplicateId),
              ),
            ),
          );
        await tx
          .update(contactEdges)
          .set({ fromContact: survivorId })
          .where(eq(contactEdges.fromContact, duplicateId));
        await tx
          .update(contactEdges)
          .set({ toContact: survivorId })
          .where(eq(contactEdges.toContact, duplicateId));
        await tx.delete(contact).where(eq(contact.contactId, duplicateId));
      });
      return { ok: true as const, survivorId, duplicateId };
    },
    async () => {
      const mem = getCrmMemory();
      for (const d of mem.deals.values()) {
        if (d.primaryContactId === duplicateId)
          mem.deals.set(d.dealId, { ...d, primaryContactId: survivorId });
      }
      for (const a of mem.activities.values()) {
        if (a.contactId === duplicateId)
          mem.activities.set(a.activityId, { ...a, contactId: survivorId });
      }
      for (const n of mem.notes.values()) {
        if (n.contactId === duplicateId)
          mem.notes.set(n.crmNoteId, { ...n, contactId: survivorId });
      }
      for (const t of mem.tasks.values()) {
        if (t.contactId === duplicateId)
          mem.tasks.set(t.crmTaskId, { ...t, contactId: survivorId });
      }
      // ponytail: leadgen's memory list() returns live row references, so
      // in-place mutation repoints edges; duplicate↔survivor edges become
      // self-loops here (Postgres path deletes them) — dev-only backend,
      // add a leadgen store delete export if that ever matters.
      for (const e of await listContactEdges(duplicateId)) {
        if (e.fromContact === duplicateId) e.fromContact = survivorId;
        if (e.toContact === duplicateId) e.toContact = survivorId;
      }
      mem.contacts.delete(duplicateId);
      return { ok: true as const, survivorId, duplicateId };
    },
  );
}

/** Re-point contact/deal/activity/note/task FKs to survivor, delete duplicate. */
export async function mergeCompanies(input: {
  survivorId: string;
  duplicateId: string;
}): Promise<MergeResult> {
  const { survivorId, duplicateId } = input;
  if (survivorId === duplicateId) {
    return { ok: false, reason: "Survivor and duplicate are the same company" };
  }
  const [survivor, duplicate] = await Promise.all([
    getCompany(survivorId),
    getCompany(duplicateId),
  ]);
  if (!survivor) return { ok: false, reason: "Survivor company not found" };
  if (!duplicate) return { ok: false, reason: "Duplicate company not found" };

  return withDb(
    async (db) => {
      await db.transaction(async (tx) => {
        await tx
          .update(contact)
          .set({ companyId: survivorId })
          .where(eq(contact.companyId, duplicateId));
        await tx
          .update(deal)
          .set({ companyId: survivorId })
          .where(eq(deal.companyId, duplicateId));
        await tx
          .update(activity)
          .set({ companyId: survivorId })
          .where(eq(activity.companyId, duplicateId));
        await tx
          .update(crmNote)
          .set({ companyId: survivorId })
          .where(eq(crmNote.companyId, duplicateId));
        await tx
          .update(crmTask)
          .set({ companyId: survivorId })
          .where(eq(crmTask.companyId, duplicateId));
        // ticket (0004) also carries company_id — repoint it too. Memory path
        // has no ticket store (tickets-router stub is memory-only + private),
        // so this is Postgres-only by construction.
        await tx
          .update(ticket)
          .set({ companyId: survivorId })
          .where(eq(ticket.companyId, duplicateId));
        await tx.delete(company).where(eq(company.companyId, duplicateId));
      });
      return { ok: true as const, survivorId, duplicateId };
    },
    () => {
      const mem = getCrmMemory();
      for (const c of mem.contacts.values()) {
        if (c.companyId === duplicateId)
          mem.contacts.set(c.contactId, { ...c, companyId: survivorId });
      }
      for (const d of mem.deals.values()) {
        if (d.companyId === duplicateId)
          mem.deals.set(d.dealId, { ...d, companyId: survivorId });
      }
      for (const a of mem.activities.values()) {
        if (a.companyId === duplicateId)
          mem.activities.set(a.activityId, { ...a, companyId: survivorId });
      }
      for (const n of mem.notes.values()) {
        if (n.companyId === duplicateId)
          mem.notes.set(n.crmNoteId, { ...n, companyId: survivorId });
      }
      for (const t of mem.tasks.values()) {
        if (t.companyId === duplicateId)
          mem.tasks.set(t.crmTaskId, { ...t, companyId: survivorId });
      }
      mem.companies.delete(duplicateId);
      return { ok: true as const, survivorId, duplicateId };
    },
  );
}

// ── Omni search ────────────────────────────────────────────

export type OmniSearchResult = {
  companies: CompanyRow[];
  contacts: ContactRow[];
  deals: DealRow[];
};

/** Top-10-each substring search across companies/contacts/deals. */
export async function omniSearch(q: string): Promise<OmniSearchResult> {
  const term = q.trim();
  if (!term) return { companies: [], contacts: [], deals: [] };
  const pattern = `%${term}%`;
  return withDb(
    async (db) => {
      const [companies, contacts, deals] = await Promise.all([
        db.select().from(company).where(ilike(company.name, pattern)).limit(10),
        db
          .select()
          .from(contact)
          .where(
            or(
              ilike(contact.firstName, pattern),
              ilike(contact.lastName, pattern),
              ilike(contact.email, pattern),
            ),
          )
          .limit(10),
        db
          .select()
          .from(deal)
          .where(ilike(deal.companyName, pattern))
          .limit(10),
      ]);
      return {
        companies: companies.map(mapCompany),
        contacts: contacts.map(mapContact),
        deals: deals.map(mapDeal),
      };
    },
    () => {
      const s = term.toLowerCase();
      const mem = getCrmMemory();
      return {
        companies: [...mem.companies.values()]
          .filter((c) => c.name.toLowerCase().includes(s))
          .slice(0, 10),
        contacts: [...mem.contacts.values()]
          .filter(
            (c) =>
              c.firstName.toLowerCase().includes(s) ||
              (c.lastName ?? "").toLowerCase().includes(s) ||
              (c.email ?? "").toLowerCase().includes(s),
          )
          .slice(0, 10),
        deals: [...mem.deals.values()]
          .filter((d) => d.companyName.toLowerCase().includes(s))
          .slice(0, 10),
      };
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
