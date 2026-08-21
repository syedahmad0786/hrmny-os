import { randomUUID } from "node:crypto";
import type { CompetitorFinding } from "@hrmny/ai";
import {
  and,
  competitorFindings,
  contactEdges,
  desc,
  eq,
  outreachItems,
  winLossNotes,
  type Db,
} from "@hrmny/db";
import { getDb } from "../db";

/**
 * Durable leadgen store for the M8 `outreach_items` (0059) and lead_intel
 * (0060: contact_edges / win_loss_notes / competitor_findings) tables.
 * Postgres when DATABASE_URL is set, else in-memory Maps — same withDb seam as
 * crm/repository.ts and campaigns/repository.ts, so dev/tests run with no DB.
 */

export type OutreachState = "draft" | "approved" | "sent" | "discarded";

export type OutreachItem = {
  id: string;
  dealId: string;
  channel: string;
  state: OutreachState;
  recipient: string;
  subject: string | null;
  body: string;
  approvedBy: string | null;
  sentAt: string | null;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompetitorFindingRow = CompetitorFinding & { id: string; createdAt: string };

export type ContactEdgeRow = {
  id: string;
  fromContact: string;
  toContact: string;
  relation: string;
  weight: number;
  createdAt: string;
};

export type WinLossOutcome = "won" | "lost" | "postponed_on_hold";

export type WinLossNoteRow = {
  id: string;
  dealId: string | null;
  outcome: WinLossOutcome;
  note: string;
  createdAt: string;
};

type LeadgenMemory = {
  outreach: Map<string, OutreachItem>;
  competitorFindings: CompetitorFindingRow[];
  contactEdges: ContactEdgeRow[];
  winLossNotes: WinLossNoteRow[];
};

const store: LeadgenMemory = {
  outreach: new Map(),
  competitorFindings: [],
  contactEdges: [],
  winLossNotes: [],
};

/** Test hook — drop all in-memory leadgen state between cases. */
export function resetLeadgenStore(): void {
  store.outreach.clear();
  store.competitorFindings = [];
  store.contactEdges = [];
  store.winLossNotes = [];
}

/**
 * Seed Demo Co vs Other Co outreach rows (memory mode) so agent
 * `outreach.read` sandboxes can prove client A vs B isolation.
 * No-ops when DATABASE_URL is set (Postgres path owns durable rows).
 */
export function seedClientSandboxOutreach(input: {
  dealIdA: string;
  dealIdB: string;
}): void {
  if (getDb()) return;
  const now = new Date().toISOString();
  const aId = "o1000000-0000-4000-8000-0000000000a4";
  const bId = "o1000000-0000-4000-8000-0000000000b4";
  store.outreach.set(aId, {
    id: aId,
    dealId: input.dealIdA,
    channel: "email",
    state: "draft",
    recipient: "alex@democo.example",
    subject: "Demo Co launch reel follow-up",
    body: "Checking in on the Demo Co launch reel cut.",
    approvedBy: null,
    sentAt: null,
    externalId: null,
    createdAt: now,
    updatedAt: now,
  });
  store.outreach.set(bId, {
    id: bId,
    dealId: input.dealIdB,
    channel: "email",
    state: "draft",
    recipient: "ops@otherco.example",
    subject: "Other Co confidential outreach",
    body: "Private Other Co pipeline note — must not leak to Demo Co.",
    approvedBy: null,
    sentAt: null,
    externalId: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function withDb<T>(
  fn: (db: Db) => Promise<T>,
  fallback: () => T,
): Promise<T> {
  const db = getDb();
  if (!db) return fallback();
  return fn(db);
}

const iso = (d: Date | string | null | undefined): string =>
  d instanceof Date ? d.toISOString() : d ? String(d) : new Date().toISOString();

// ── outreach_items ─────────────────────────────────────────

function mapOutreach(r: typeof outreachItems.$inferSelect): OutreachItem {
  return {
    id: r.outreachItemId,
    dealId: r.dealId ?? "",
    channel: r.channel,
    state: r.state as OutreachState,
    recipient: r.recipient,
    subject: r.subject ?? null,
    body: r.body,
    approvedBy: r.approvedBy ?? null,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    externalId: r.externalId ?? null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export async function insertOutreach(input: {
  dealId: string;
  channel: string;
  recipient: string;
  subject?: string | null;
  body: string;
}): Promise<OutreachItem> {
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(outreachItems)
        .values({
          dealId: input.dealId,
          channel: input.channel,
          state: "draft",
          recipient: input.recipient,
          subject: input.subject ?? null,
          body: input.body,
        })
        .returning();
      return mapOutreach(row!);
    },
    () => {
      const now = new Date().toISOString();
      const item: OutreachItem = {
        id: randomUUID(),
        dealId: input.dealId,
        channel: input.channel,
        state: "draft",
        recipient: input.recipient,
        subject: input.subject ?? null,
        body: input.body,
        approvedBy: null,
        sentAt: null,
        externalId: null,
        createdAt: now,
        updatedAt: now,
      };
      store.outreach.set(item.id, item);
      return item;
    },
  );
}

export async function getOutreach(id: string): Promise<OutreachItem | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(outreachItems)
        .where(eq(outreachItems.outreachItemId, id))
        .limit(1);
      return row ? mapOutreach(row) : null;
    },
    () => store.outreach.get(id) ?? null,
  );
}

export async function listOutreach(filter?: {
  dealId?: string;
  state?: OutreachState;
}): Promise<OutreachItem[]> {
  return withDb(
    async (db) => {
      const conds = [
        filter?.dealId ? eq(outreachItems.dealId, filter.dealId) : undefined,
        filter?.state ? eq(outreachItems.state, filter.state) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(outreachItems)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(outreachItems.createdAt));
      return rows.map(mapOutreach);
    },
    () => {
      let rows = [...store.outreach.values()];
      if (filter?.dealId) rows = rows.filter((r) => r.dealId === filter.dealId);
      if (filter?.state) rows = rows.filter((r) => r.state === filter.state);
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  );
}

export async function patchOutreach(
  id: string,
  patch: Partial<OutreachItem>,
): Promise<OutreachItem | null> {
  return withDb(
    async (db) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.state !== undefined) set.state = patch.state;
      if (patch.approvedBy !== undefined) set.approvedBy = patch.approvedBy;
      if (patch.sentAt !== undefined)
        set.sentAt = patch.sentAt ? new Date(patch.sentAt) : null;
      if (patch.externalId !== undefined) set.externalId = patch.externalId;
      if (patch.subject !== undefined) set.subject = patch.subject;
      if (patch.body !== undefined) set.body = patch.body;
      if (patch.recipient !== undefined) set.recipient = patch.recipient;
      if (patch.channel !== undefined) set.channel = patch.channel;
      const [row] = await db
        .update(outreachItems)
        .set(set)
        .where(eq(outreachItems.outreachItemId, id))
        .returning();
      return row ? mapOutreach(row) : null;
    },
    () => {
      const existing = store.outreach.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      store.outreach.set(id, next);
      return next;
    },
  );
}

// ── competitor_findings (lead_intel 0060) ──────────────────

function mapFinding(
  r: typeof competitorFindings.$inferSelect,
): CompetitorFindingRow {
  return {
    id: r.competitorFindingId,
    competitor: r.competitor,
    source: r.source as CompetitorFinding["source"],
    headline: r.headline,
    detail: r.detail,
    url: r.url ?? undefined,
    scopeId: r.scopeId ?? undefined,
    capturedAt: iso(r.capturedAt),
    createdAt: iso(r.createdAt),
  };
}

export async function insertCompetitorFindings(
  findings: CompetitorFinding[],
): Promise<CompetitorFindingRow[]> {
  if (findings.length === 0) return [];
  return withDb(
    async (db) => {
      const rows = await db
        .insert(competitorFindings)
        .values(
          findings.map((f) => ({
            competitor: f.competitor,
            source: f.source,
            headline: f.headline,
            detail: f.detail,
            url: f.url ?? null,
            scopeId: f.scopeId ?? null,
            capturedAt: new Date(f.capturedAt),
          })),
        )
        .returning();
      return rows.map(mapFinding);
    },
    () => {
      const rows = findings.map((f) => ({
        ...f,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      }));
      store.competitorFindings.push(...rows);
      return rows;
    },
  );
}

export async function listCompetitorFindings(
  scopeId?: string,
): Promise<CompetitorFindingRow[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(competitorFindings)
        .where(scopeId ? eq(competitorFindings.scopeId, scopeId) : undefined)
        .orderBy(desc(competitorFindings.createdAt));
      return rows.map(mapFinding);
    },
    () => {
      const rows = scopeId
        ? store.competitorFindings.filter((r) => r.scopeId === scopeId)
        : store.competitorFindings;
      return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  );
}

// ── contact_edges (lead_intel 0060) ────────────────────────

export async function insertContactEdge(input: {
  fromContact: string;
  toContact: string;
  relation: string;
  /** 0–1 strength; defaults to 0.5 (the column default). */
  weight?: number;
}): Promise<ContactEdgeRow> {
  const weight = input.weight ?? 0.5;
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(contactEdges)
        .values({
          fromContact: input.fromContact,
          toContact: input.toContact,
          relation: input.relation,
          weight: String(weight),
        })
        .returning();
      return {
        id: row!.contactEdgeId,
        fromContact: row!.fromContact,
        toContact: row!.toContact,
        relation: row!.relation,
        weight: Number(row!.weight),
        createdAt: iso(row!.createdAt),
      };
    },
    () => {
      const row: ContactEdgeRow = {
        id: randomUUID(),
        fromContact: input.fromContact,
        toContact: input.toContact,
        relation: input.relation,
        weight,
        createdAt: new Date().toISOString(),
      };
      store.contactEdges.push(row);
      return row;
    },
  );
}

/** Edges touching a contact (either direction), newest first. */
export async function listContactEdges(
  contactId?: string,
): Promise<ContactEdgeRow[]> {
  const matches = (r: ContactEdgeRow) =>
    !contactId || r.fromContact === contactId || r.toContact === contactId;
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(contactEdges)
        .orderBy(desc(contactEdges.createdAt));
      return rows
        .map((r) => ({
          id: r.contactEdgeId,
          fromContact: r.fromContact,
          toContact: r.toContact,
          relation: r.relation,
          weight: Number(r.weight),
          createdAt: iso(r.createdAt),
        }))
        .filter(matches);
    },
    () =>
      [...store.contactEdges]
        .filter(matches)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

// ── win_loss_notes (lead_intel 0060) ───────────────────────

export async function insertWinLossNote(input: {
  dealId?: string | null;
  outcome: WinLossOutcome;
  note: string;
}): Promise<WinLossNoteRow> {
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(winLossNotes)
        .values({
          dealId: input.dealId ?? null,
          outcome: input.outcome,
          note: input.note,
        })
        .returning();
      return {
        id: row!.winLossNoteId,
        dealId: row!.dealId ?? null,
        outcome: row!.outcome as WinLossOutcome,
        note: row!.note,
        createdAt: iso(row!.createdAt),
      };
    },
    () => {
      const row: WinLossNoteRow = {
        id: randomUUID(),
        dealId: input.dealId ?? null,
        outcome: input.outcome,
        note: input.note,
        createdAt: new Date().toISOString(),
      };
      store.winLossNotes.push(row);
      return row;
    },
  );
}

export async function listWinLossNotes(filter?: {
  dealId?: string;
  outcome?: WinLossOutcome;
}): Promise<WinLossNoteRow[]> {
  return withDb(
    async (db) => {
      const conds = [
        filter?.dealId ? eq(winLossNotes.dealId, filter.dealId) : undefined,
        filter?.outcome ? eq(winLossNotes.outcome, filter.outcome) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(winLossNotes)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(winLossNotes.createdAt));
      return rows.map((r) => ({
        id: r.winLossNoteId,
        dealId: r.dealId ?? null,
        outcome: r.outcome as WinLossOutcome,
        note: r.note,
        createdAt: iso(r.createdAt),
      }));
    },
    () => {
      let rows = [...store.winLossNotes];
      if (filter?.dealId) rows = rows.filter((r) => r.dealId === filter.dealId);
      if (filter?.outcome) rows = rows.filter((r) => r.outcome === filter.outcome);
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  );
}
