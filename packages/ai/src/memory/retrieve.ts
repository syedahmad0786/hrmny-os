import {
  RetrieveMemoryInputSchema,
  type RetrieveMemoryInput,
  type RetrievedChunk,
  type MemoryChunk,
} from "./types";

export type RetrieveMemoryDeps = {
  /**
   * Vector / keyword search against memory_chunk.
   * Production: pgvector cosine distance + metadata filters.
   */
  search: (input: RetrieveMemoryInput) => Promise<RetrievedChunk[]>;
  /** Optional Redis-cached result */
  cacheGet?: (key: string) => Promise<RetrievedChunk[] | null>;
  cacheSet?: (key: string, value: RetrievedChunk[], ttlSeconds: number) => Promise<void>;
};

function simpleScore(query: string, content: string): number {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  const c = content.toLowerCase();
  if (q.length === 0) return 0;
  const hits = q.filter((w) => c.includes(w)).length;
  return hits / q.length;
}

/**
 * Retrieve-before-act: call before any agent drafts outreach / research.
 */
export async function retrieveMemory(
  raw: RetrieveMemoryInput,
  deps: RetrieveMemoryDeps,
): Promise<RetrievedChunk[]> {
  const input = RetrieveMemoryInputSchema.parse(raw);
  const cacheKey = [
    "mem",
    input.dealId ?? "",
    input.companyId ?? "",
    input.clientId ?? "",
    input.employeeId ?? "",
    input.taskId ?? "",
    input.query.slice(0, 80),
    String(input.limit),
  ].join(":");

  if (deps.cacheGet) {
    const hit = await deps.cacheGet(cacheKey);
    if (hit) return hit;
  }

  const results = await deps.search(input);

  if (deps.cacheSet) {
    await deps.cacheSet(cacheKey, results, 60);
  }
  return results;
}

/**
 * Keyword fallback when pgvector not enabled yet — used by stubs/tests.
 */
export function keywordSearchFromRows(
  rows: Iterable<MemoryChunk & { id: string }>,
  input: RetrieveMemoryInput,
): RetrievedChunk[] {
  const parsed = RetrieveMemoryInputSchema.parse(input);
  const out: RetrievedChunk[] = [];
  for (const row of rows) {
    if (
      parsed.sourceTypes &&
      !parsed.sourceTypes.includes(row.sourceType)
    ) {
      continue;
    }
    const meta = row.metadata ?? {};
    if (parsed.clientId) {
      if (meta.clientId == null || String(meta.clientId) !== parsed.clientId) {
        continue;
      }
    }
    if (parsed.employeeId) {
      if (
        meta.employeeId == null ||
        String(meta.employeeId) !== parsed.employeeId
      ) {
        continue;
      }
      // User sandbox: exclude dual-tagged client notes so client runs do not
      // leak into partner/user-scoped retrieve.
      if (
        !parsed.clientId &&
        meta.clientId != null &&
        String(meta.clientId).length > 0
      ) {
        continue;
      }
    }
    if (parsed.dealId) {
      if (meta.dealId == null || String(meta.dealId) !== parsed.dealId) {
        continue;
      }
    }
    if (parsed.companyId) {
      if (meta.companyId == null || String(meta.companyId) !== parsed.companyId) {
        continue;
      }
    }
    if (parsed.taskId) {
      if (meta.taskId == null || String(meta.taskId) !== parsed.taskId) {
        continue;
      }
    }
    const score = simpleScore(parsed.query, row.content);
    if (score <= 0) continue;
    out.push({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId ?? null,
      content: row.content,
      score,
      metadata: meta,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, parsed.limit);
}
