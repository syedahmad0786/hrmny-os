import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  scorecardDefinitions,
  scorecardOverrides,
  scorecardSnapshots,
  type Db,
} from "@hrmny/db";
import { getDb } from "../db";
import { getDeal } from "../crm/repository";
import {
  assertScorableKind,
  compute,
  dealBuafEvidence,
  DEAL_BUAF_V1,
  validateWeights,
  type ScorecardDefinition,
  type ScorecardEntityKind,
  type ScorecardFactor,
  type ScorecardSnapshot,
} from "./engine";

/**
 * Persistence for definitions / snapshots / overrides. DB-backed when
 * DATABASE_URL is set, in-memory fallback otherwise (same withDb pattern as
 * crm/repository.ts). The pure math lives in ./engine.
 */

export type StoredSnapshot = ScorecardSnapshot & {
  scorecardSnapshotId: string;
  definitionId: string;
  createdAt: string;
};

export type ScorecardOverride = {
  scorecardOverrideId: string;
  snapshotId: string;
  actor: string;
  reason: string;
  newScore: number;
  createdAt: string;
};

type ScorecardMemory = {
  definitions: Map<string, ScorecardDefinition>;
  snapshots: Map<string, StoredSnapshot>;
  overrides: Map<string, ScorecardOverride>;
};

let memory: ScorecardMemory | null = null;

function seedMemory(): ScorecardMemory {
  return {
    definitions: new Map([
      [DEAL_BUAF_V1.scorecardDefinitionId, { ...DEAL_BUAF_V1 }],
    ]),
    snapshots: new Map(),
    overrides: new Map(),
  };
}

function mem(): ScorecardMemory {
  if (!memory) memory = seedMemory();
  return memory;
}

/** Test hook — drop all in-memory scorecard state between cases. */
export function resetScorecardMemory(): ScorecardMemory {
  memory = seedMemory();
  return memory;
}

async function withDb<T>(
  fn: (db: Db) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  const db = getDb();
  if (!db) return fallback();
  return fn(db);
}

function mapDefinition(
  r: typeof scorecardDefinitions.$inferSelect,
): ScorecardDefinition {
  return {
    scorecardDefinitionId: r.scorecardDefinitionId,
    key: r.key,
    entityKind: r.entityKind as ScorecardEntityKind,
    version: r.version,
    weights: (r.weights ?? []) as ScorecardFactor[],
    active: r.active,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function iso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

// ── Definitions ────────────────────────────────────────────

export async function listDefinitions(q?: {
  key?: string;
  activeOnly?: boolean;
}): Promise<ScorecardDefinition[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(scorecardDefinitions)
        .orderBy(desc(scorecardDefinitions.version));
      return rows.map(mapDefinition).filter((d) => filterDef(d, q));
    },
    () =>
      [...mem().definitions.values()]
        .filter((d) => filterDef(d, q))
        .sort((a, b) => b.version - a.version),
  );
}

function filterDef(
  d: ScorecardDefinition,
  q?: { key?: string; activeOnly?: boolean },
): boolean {
  if (q?.key && d.key !== q.key) return false;
  if (q?.activeOnly && !d.active) return false;
  return true;
}

export async function getActiveDefinition(
  key: string,
): Promise<ScorecardDefinition | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(scorecardDefinitions)
        .where(
          and(
            eq(scorecardDefinitions.key, key),
            eq(scorecardDefinitions.active, true),
          ),
        )
        .orderBy(desc(scorecardDefinitions.version))
        .limit(1);
      return row ? mapDefinition(row) : null;
    },
    () =>
      [...mem().definitions.values()]
        .filter((d) => d.key === key && d.active)
        .sort((a, b) => b.version - a.version)[0] ?? null,
  );
}

export async function getDefinition(
  id: string,
): Promise<ScorecardDefinition | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(scorecardDefinitions)
        .where(eq(scorecardDefinitions.scorecardDefinitionId, id))
        .limit(1);
      return row ? mapDefinition(row) : null;
    },
    () => mem().definitions.get(id) ?? null,
  );
}

/**
 * Create or version-bump a definition by key. Saving an existing key mints
 * version = max(existing) + 1, activates it, and deactivates every prior
 * version — snapshots keep their own version, so history stays explainable.
 */
export async function saveDefinition(input: {
  key: string;
  entityKind: string;
  weights: ScorecardFactor[];
}): Promise<ScorecardDefinition> {
  assertScorableKind(input.entityKind);
  validateWeights(input.weights);
  const existing = await listDefinitions({ key: input.key });
  const nextVersion =
    existing.reduce((max, d) => Math.max(max, d.version), 0) + 1;

  return withDb(
    async (db) => {
      if (existing.length) {
        await db
          .update(scorecardDefinitions)
          .set({ active: false, updatedAt: new Date() })
          .where(eq(scorecardDefinitions.key, input.key));
      }
      const [row] = await db
        .insert(scorecardDefinitions)
        .values({
          key: input.key,
          entityKind: input.entityKind,
          version: nextVersion,
          weights: input.weights,
          active: true,
        })
        .returning();
      return mapDefinition(row!);
    },
    () => {
      const m = mem();
      for (const d of m.definitions.values()) {
        if (d.key === input.key) d.active = false;
      }
      const t = new Date().toISOString();
      const def: ScorecardDefinition = {
        scorecardDefinitionId: randomUUID(),
        key: input.key,
        entityKind: input.entityKind as ScorecardEntityKind,
        version: nextVersion,
        weights: input.weights,
        active: true,
        createdAt: t,
        updatedAt: t,
      };
      m.definitions.set(def.scorecardDefinitionId, def);
      return def;
    },
  );
}

export async function setDefinitionActive(
  id: string,
  active: boolean,
): Promise<ScorecardDefinition | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .update(scorecardDefinitions)
        .set({ active, updatedAt: new Date() })
        .where(eq(scorecardDefinitions.scorecardDefinitionId, id))
        .returning();
      return row ? mapDefinition(row) : null;
    },
    () => {
      const d = mem().definitions.get(id);
      if (!d) return null;
      d.active = active;
      d.updatedAt = new Date().toISOString();
      return d;
    },
  );
}

// ── Snapshots ──────────────────────────────────────────────

export async function insertSnapshot(input: {
  definitionId: string;
  snapshot: ScorecardSnapshot;
}): Promise<StoredSnapshot> {
  const { snapshot } = input;
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(scorecardSnapshots)
        .values({
          definitionId: input.definitionId,
          definitionKey: snapshot.definitionKey,
          version: snapshot.version,
          entityKind: snapshot.entityKind,
          entityId: snapshot.entityId,
          score: snapshot.score,
          breakdown: snapshot.breakdown as unknown as Record<string, unknown>,
        })
        .returning();
      return {
        ...snapshot,
        scorecardSnapshotId: row!.scorecardSnapshotId,
        definitionId: input.definitionId,
        createdAt: iso(row!.createdAt),
      };
    },
    () => {
      const stored: StoredSnapshot = {
        ...snapshot,
        scorecardSnapshotId: randomUUID(),
        definitionId: input.definitionId,
        createdAt: new Date().toISOString(),
      };
      mem().snapshots.set(stored.scorecardSnapshotId, stored);
      return stored;
    },
  );
}

export async function getSnapshot(id: string): Promise<StoredSnapshot | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(scorecardSnapshots)
        .where(eq(scorecardSnapshots.scorecardSnapshotId, id))
        .limit(1);
      if (!row) return null;
      return {
        scorecardSnapshotId: row.scorecardSnapshotId,
        definitionId: row.definitionId,
        definitionKey: row.definitionKey,
        version: row.version,
        entityKind: row.entityKind as ScorecardEntityKind,
        entityId: row.entityId,
        score: row.score,
        breakdown: row.breakdown as unknown as StoredSnapshot["breakdown"],
        createdAt: iso(row.createdAt),
      };
    },
    () => mem().snapshots.get(id) ?? null,
  );
}

export async function listSnapshots(q: {
  entityKind: string;
  entityId: string;
}): Promise<StoredSnapshot[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(scorecardSnapshots)
        .where(
          and(
            eq(scorecardSnapshots.entityKind, q.entityKind),
            eq(scorecardSnapshots.entityId, q.entityId),
          ),
        )
        .orderBy(desc(scorecardSnapshots.createdAt));
      return rows.map((row) => ({
        scorecardSnapshotId: row.scorecardSnapshotId,
        definitionId: row.definitionId,
        definitionKey: row.definitionKey,
        version: row.version,
        entityKind: row.entityKind as ScorecardEntityKind,
        entityId: row.entityId,
        score: row.score,
        breakdown: row.breakdown as unknown as StoredSnapshot["breakdown"],
        createdAt: iso(row.createdAt),
      }));
    },
    () =>
      [...mem().snapshots.values()]
        .filter(
          (s) => s.entityKind === q.entityKind && s.entityId === q.entityId,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

// ── Overrides ──────────────────────────────────────────────

export async function overrideSnapshot(input: {
  snapshotId: string;
  actor: string;
  reason: string;
  newScore: number;
}): Promise<ScorecardOverride> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Override requires a justification");
  if (!(input.newScore >= 0 && input.newScore <= 100)) {
    throw new Error(`Override score out of range: ${input.newScore}`);
  }
  const snapshot = await getSnapshot(input.snapshotId);
  if (!snapshot) throw new Error(`Snapshot not found: ${input.snapshotId}`);

  return withDb(
    async (db) => {
      const [row] = await db
        .insert(scorecardOverrides)
        .values({
          snapshotId: input.snapshotId,
          actor: input.actor,
          reason,
          newScore: input.newScore,
        })
        .returning();
      return {
        scorecardOverrideId: row!.scorecardOverrideId,
        snapshotId: row!.snapshotId,
        actor: row!.actor,
        reason: row!.reason,
        newScore: row!.newScore,
        createdAt: iso(row!.createdAt),
      };
    },
    () => {
      const override: ScorecardOverride = {
        scorecardOverrideId: randomUUID(),
        snapshotId: input.snapshotId,
        actor: input.actor,
        reason,
        newScore: input.newScore,
        createdAt: new Date().toISOString(),
      };
      mem().overrides.set(override.scorecardOverrideId, override);
      return override;
    },
  );
}

export async function listOverrides(
  snapshotId: string,
): Promise<ScorecardOverride[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(scorecardOverrides)
        .where(eq(scorecardOverrides.snapshotId, snapshotId))
        .orderBy(desc(scorecardOverrides.createdAt));
      return rows.map((row) => ({
        scorecardOverrideId: row.scorecardOverrideId,
        snapshotId: row.snapshotId,
        actor: row.actor,
        reason: row.reason,
        newScore: row.newScore,
        createdAt: iso(row.createdAt),
      }));
    },
    () =>
      [...mem().overrides.values()]
        .filter((o) => o.snapshotId === snapshotId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

// ── BUAF consumer ──────────────────────────────────────────

/**
 * Score a deal from its BUAF fields against the active deal-buaf-v1 definition
 * (falling back to the in-code seed), persist the snapshot, and return it.
 */
export async function scoreDealFromBuaf(input: {
  dealId: string;
  now?: number;
}): Promise<StoredSnapshot> {
  const deal = await getDeal(input.dealId);
  if (!deal) throw new Error(`Deal not found: ${input.dealId}`);
  const definition =
    (await getActiveDefinition("deal-buaf-v1")) ?? DEAL_BUAF_V1;
  const snapshot = compute(
    definition,
    deal.dealId,
    dealBuafEvidence(deal, input.now),
  );
  return insertSnapshot({
    definitionId: definition.scorecardDefinitionId,
    snapshot,
  });
}
