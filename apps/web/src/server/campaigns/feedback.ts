import { randomUUID } from "node:crypto";
import { asc, eq, portalFeedback, type Db } from "@hrmny/db";
import { getDb } from "../db";

/**
 * Consolidated portal proofing feedback (slot 0063). One ordered thread per
 * campaign item, shared between staff and the item's single client. Postgres
 * over portal_feedback when DATABASE_URL is set, else an in-memory array —
 * same mock-first shape as ../campaigns/repository. Pure CRUD: the caller
 * resolves the item and enforces the client trust boundary (a portal actor may
 * only touch threads whose scope client_id matches their bound clientId).
 */

export type FeedbackAuthorKind = "staff" | "client";

export type FeedbackRow = {
  id: string;
  campaignItemId: string;
  authorKind: FeedbackAuthorKind;
  authorId: string | null;
  /** Scope spine — always the item's clientId, so the client sees staff replies. */
  clientId: string | null;
  body: string;
  anchor: Record<string, unknown> | null;
  resolved: boolean;
  createdAt: string;
};

// In-memory fallback. An append-only array keeps insertion == chronological
// order for the thread without depending on createdAt tie-breaking.
let memory: FeedbackRow[] | null = null;

function mem(): FeedbackRow[] {
  return (memory ??= []);
}

export function resetFeedbackMemory(): void {
  memory = [];
}

function iso(d: Date | string | null | undefined): string {
  if (!d) return new Date().toISOString();
  return d instanceof Date ? d.toISOString() : String(d);
}

function mapRow(r: typeof portalFeedback.$inferSelect): FeedbackRow {
  return {
    id: r.portalFeedbackId,
    campaignItemId: r.campaignItemId,
    authorKind: r.authorKind as FeedbackAuthorKind,
    authorId: r.authorId ?? null,
    clientId: r.clientId ?? null,
    body: r.body,
    anchor: (r.anchor ?? null) as Record<string, unknown> | null,
    resolved: r.resolved,
    createdAt: iso(r.createdAt),
  };
}

async function withDb<T>(
  fn: (db: Db) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  const db = getDb();
  if (!db) return fallback();
  return fn(db);
}

export async function addFeedback(opts: {
  campaignItemId: string;
  authorKind: FeedbackAuthorKind;
  authorId: string | null;
  clientId: string | null;
  body: string;
  anchor?: Record<string, unknown> | null;
}): Promise<FeedbackRow> {
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(portalFeedback)
        .values({
          campaignItemId: opts.campaignItemId,
          authorKind: opts.authorKind,
          authorId: opts.authorId,
          clientId: opts.clientId,
          body: opts.body,
          anchor: opts.anchor ?? null,
        })
        .returning();
      return mapRow(row!);
    },
    () => {
      const row: FeedbackRow = {
        id: randomUUID(),
        campaignItemId: opts.campaignItemId,
        authorKind: opts.authorKind,
        authorId: opts.authorId,
        clientId: opts.clientId,
        body: opts.body,
        anchor: opts.anchor ?? null,
        resolved: false,
        createdAt: new Date().toISOString(),
      };
      mem().push(row);
      return row;
    },
  );
}

/** Consolidated thread for one item, oldest first. No client scoping — the
 *  caller decides whether the actor may see this item's thread. */
export async function listFeedbackByItem(
  campaignItemId: string,
): Promise<FeedbackRow[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(portalFeedback)
        .where(eq(portalFeedback.campaignItemId, campaignItemId))
        .orderBy(asc(portalFeedback.createdAt));
      return rows.map(mapRow);
    },
    () => mem().filter((r) => r.campaignItemId === campaignItemId),
  );
}

/** Staff-only resolve (enforced by staffProcedure at the router). */
export async function resolveFeedback(id: string): Promise<FeedbackRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .update(portalFeedback)
        .set({ resolved: true })
        .where(eq(portalFeedback.portalFeedbackId, id))
        .returning();
      return row ? mapRow(row) : null;
    },
    () => {
      const row = mem().find((r) => r.id === id);
      if (!row) return null;
      row.resolved = true;
      return row;
    },
  );
}
