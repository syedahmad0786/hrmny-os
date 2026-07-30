import { randomUUID } from "node:crypto";
import type { CompetitorFinding } from "@hrmny/ai";

/**
 * Mock-first in-memory backing for the M8 `outreach_items` (0059) and
 * `competitor_findings` (0060) tables. Merged-but-inert like M2–M6: the SQL
 * migrations are the durable schema-of-record; the live Postgres path binds
 * when a drizzle table + `withDb` swap land (same seam the CRM repository uses).
 *
 * ponytail: process-local Maps, no persistence across restarts — swap the two
 * accessor groups for drizzle queries when DATABASE_URL is wired for leadgen.
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

type LeadgenMemory = {
  outreach: Map<string, OutreachItem>;
  competitorFindings: CompetitorFindingRow[];
};

const store: LeadgenMemory = { outreach: new Map(), competitorFindings: [] };

/** Test hook — drop all in-memory leadgen state between cases. */
export function resetLeadgenStore(): void {
  store.outreach.clear();
  store.competitorFindings = [];
}

// ── outreach_items ─────────────────────────────────────────

export function insertOutreach(input: {
  dealId: string;
  channel: string;
  recipient: string;
  subject?: string | null;
  body: string;
}): OutreachItem {
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
}

export function getOutreach(id: string): OutreachItem | null {
  return store.outreach.get(id) ?? null;
}

export function listOutreach(filter?: { dealId?: string; state?: OutreachState }): OutreachItem[] {
  let rows = [...store.outreach.values()];
  if (filter?.dealId) rows = rows.filter((r) => r.dealId === filter.dealId);
  if (filter?.state) rows = rows.filter((r) => r.state === filter.state);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function patchOutreach(id: string, patch: Partial<OutreachItem>): OutreachItem | null {
  const existing = store.outreach.get(id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  store.outreach.set(id, next);
  return next;
}

// ── competitor_findings ────────────────────────────────────

export function insertCompetitorFindings(findings: CompetitorFinding[]): CompetitorFindingRow[] {
  const rows = findings.map((f) => ({
    ...f,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }));
  store.competitorFindings.push(...rows);
  return rows;
}

export function listCompetitorFindings(scopeId?: string): CompetitorFindingRow[] {
  const rows = scopeId
    ? store.competitorFindings.filter((r) => r.scopeId === scopeId)
    : store.competitorFindings;
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
