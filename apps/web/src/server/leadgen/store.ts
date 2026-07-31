import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import type { CompetitorFinding } from "@hrmny/ai";
import { getDb } from "../db";

/**
 * Outreach + competitor findings store.
 * Uses Postgres (`outreach_items`, `competitor_findings`) when DATABASE_URL is
 * set; falls back to process memory for local demos/tests.
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

export type CompetitorFindingRow = CompetitorFinding & {
  id: string;
  createdAt: string;
};

type LeadgenMemory = {
  outreach: Map<string, OutreachItem>;
  competitorFindings: CompetitorFindingRow[];
};

const memory: LeadgenMemory = {
  outreach: new Map(),
  competitorFindings: [],
};

/** Test hook — drop all in-memory leadgen state between cases. */
export function resetLeadgenStore(): void {
  memory.outreach.clear();
  memory.competitorFindings = [];
}

type OutreachDbRow = {
  id: string;
  deal_id: string | null;
  channel: string;
  state: OutreachState;
  recipient: string;
  subject: string | null;
  body: string;
  approved_by: string | null;
  sent_at: Date | string | null;
  external_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapOutreach(row: OutreachDbRow): OutreachItem {
  return {
    id: row.id,
    dealId: row.deal_id ?? "",
    channel: row.channel,
    state: row.state,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    approvedBy: row.approved_by,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    externalId: row.external_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// ── outreach_items ─────────────────────────────────────────

export async function insertOutreach(input: {
  dealId: string;
  channel: string;
  recipient: string;
  subject?: string | null;
  body: string;
}): Promise<OutreachItem> {
  const db = getDb();
  if (!db) {
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
    memory.outreach.set(item.id, item);
    return item;
  }

  const rows = (await db.execute(sql`
    insert into public.outreach_items (
      deal_id, channel, state, recipient, subject, body
    ) values (
      ${input.dealId}::uuid,
      ${input.channel},
      'draft',
      ${input.recipient},
      ${input.subject ?? null},
      ${input.body}
    )
    returning
      outreach_item_id as id,
      deal_id, channel, state, recipient, subject, body,
      approved_by, sent_at, external_id, created_at, updated_at
  `)) as unknown as OutreachDbRow[];
  return mapOutreach(rows[0]!);
}

export async function getOutreach(id: string): Promise<OutreachItem | null> {
  const db = getDb();
  if (!db) return memory.outreach.get(id) ?? null;
  const rows = (await db.execute(sql`
    select
      outreach_item_id as id,
      deal_id, channel, state, recipient, subject, body,
      approved_by, sent_at, external_id, created_at, updated_at
    from public.outreach_items
    where outreach_item_id = ${id}::uuid
    limit 1
  `)) as unknown as OutreachDbRow[];
  return rows[0] ? mapOutreach(rows[0]) : null;
}

export async function listOutreach(filter?: {
  dealId?: string;
  state?: OutreachState;
}): Promise<OutreachItem[]> {
  const db = getDb();
  if (!db) {
    let rows = [...memory.outreach.values()];
    if (filter?.dealId) rows = rows.filter((r) => r.dealId === filter.dealId);
    if (filter?.state) rows = rows.filter((r) => r.state === filter.state);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const rows = (await db.execute(sql`
    select
      outreach_item_id as id,
      deal_id, channel, state, recipient, subject, body,
      approved_by, sent_at, external_id, created_at, updated_at
    from public.outreach_items
    where (
      ${filter?.dealId ?? null}::uuid is null
      or deal_id = ${filter?.dealId ?? null}::uuid
    )
    and (
      ${filter?.state ?? null}::text is null
      or state = ${filter?.state ?? null}
    )
    order by created_at desc
  `)) as unknown as OutreachDbRow[];
  return rows.map(mapOutreach);
}

export async function patchOutreach(
  id: string,
  patch: Partial<OutreachItem>,
): Promise<OutreachItem | null> {
  const db = getDb();
  if (!db) {
    const existing = memory.outreach.get(id);
    if (!existing) return null;
    const next = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    memory.outreach.set(id, next);
    return next;
  }

  const current = await getOutreach(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  const rows = (await db.execute(sql`
    update public.outreach_items set
      state = ${next.state},
      recipient = ${next.recipient},
      subject = ${next.subject},
      body = ${next.body},
      approved_by = ${next.approvedBy}::uuid,
      sent_at = ${next.sentAt}::timestamptz,
      external_id = ${next.externalId},
      updated_at = now()
    where outreach_item_id = ${id}::uuid
    returning
      outreach_item_id as id,
      deal_id, channel, state, recipient, subject, body,
      approved_by, sent_at, external_id, created_at, updated_at
  `)) as unknown as OutreachDbRow[];
  return rows[0] ? mapOutreach(rows[0]) : null;
}

// ── competitor_findings ────────────────────────────────────

export async function insertCompetitorFindings(
  findings: CompetitorFinding[],
): Promise<CompetitorFindingRow[]> {
  const db = getDb();
  if (!db) {
    const rows = findings.map((f) => ({
      ...f,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }));
    memory.competitorFindings.push(...rows);
    return rows;
  }

  const out: CompetitorFindingRow[] = [];
  for (const finding of findings) {
    const rows = (await db.execute(sql`
      insert into public.competitor_findings (
        competitor, source, headline, detail, url, scope_id, captured_at
      ) values (
        ${finding.competitor},
        ${finding.source},
        ${finding.headline},
        ${finding.detail},
        ${finding.url ?? null},
        ${finding.scopeId ?? null},
        ${finding.capturedAt}::timestamptz
      )
      returning
        competitor_finding_id as id,
        competitor, source, headline, detail, url, scope_id as "scopeId",
        captured_at as "capturedAt",
        created_at as "createdAt"
    `)) as unknown as Array<{
      id: string;
      competitor: string;
      source: CompetitorFinding["source"];
      headline: string;
      detail: string;
      url: string | null;
      scopeId: string | null;
      capturedAt: Date | string;
      createdAt: Date | string;
    }>;
    const row = rows[0]!;
    out.push({
      id: row.id,
      competitor: row.competitor,
      source: row.source,
      headline: row.headline,
      detail: row.detail,
      url: row.url ?? undefined,
      scopeId: row.scopeId ?? undefined,
      capturedAt: new Date(row.capturedAt).toISOString(),
      createdAt: new Date(row.createdAt).toISOString(),
    });

    // Also land in pgvector memory for retrieve-before-act.
    try {
      const { rememberChunk } = await import("../memory/postgres");
      await rememberChunk({
        sourceType: "other",
        sourceId: null,
        content: `${row.competitor}: ${row.headline}. ${row.detail}`,
        metadata: {
          competitor: row.competitor,
          scopeId: row.scopeId,
          findingId: row.id,
        },
      });
    } catch {
      /* memory optional */
    }
  }
  return out;
}

export async function listCompetitorFindings(
  scopeId?: string,
): Promise<CompetitorFindingRow[]> {
  const db = getDb();
  if (!db) {
    const rows = scopeId
      ? memory.competitorFindings.filter((r) => r.scopeId === scopeId)
      : memory.competitorFindings;
    return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const rows = (await db.execute(sql`
    select
      competitor_finding_id as id,
      competitor, source, headline, detail, url,
      scope_id as "scopeId",
      captured_at as "capturedAt",
      created_at as "createdAt"
    from public.competitor_findings
    where (
      ${scopeId ?? null}::text is null
      or scope_id = ${scopeId ?? null}
    )
    order by created_at desc
  `)) as unknown as Array<{
    id: string;
    competitor: string;
    source: CompetitorFinding["source"];
    headline: string;
    detail: string;
    url: string | null;
    scopeId: string | null;
    capturedAt: Date | string;
    createdAt: Date | string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    competitor: row.competitor,
    source: row.source,
    headline: row.headline,
    detail: row.detail,
    url: row.url ?? undefined,
    scopeId: row.scopeId ?? undefined,
    capturedAt: new Date(row.capturedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}
