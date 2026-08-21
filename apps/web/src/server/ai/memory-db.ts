import { sql } from "@hrmny/db";
import {
  keywordSearchFromRows,
  retrieveMemory,
  upsertMemoryChunk,
  type MemoryChunk,
  type RetrieveMemoryInput,
  type RetrievedChunk,
} from "@hrmny/ai";
import { getDb } from "../db";

type Row = MemoryChunk & { id: string };

async function loadChunks(limit = 200): Promise<Row[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.execute<{
    id: string;
    source_type: MemoryChunk["sourceType"];
    source_id: string | null;
    content: string;
    metadata: Record<string, unknown>;
  }>(sql`
    select id, source_type, source_id, content, metadata
    from public.memory_chunk
    order by created_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    content: r.content,
    metadata: r.metadata ?? {},
  }));
}

/** Persist into Postgres memory_chunk (embedding filled later by embed job). */
export async function persistMemoryChunk(
  chunk: MemoryChunk,
): Promise<{ id: string }> {
  const db = getDb();
  if (!db) {
    return upsertMemoryChunk(chunk, {
      persist: async (c) => ({ id: c.id ?? crypto.randomUUID() }),
    });
  }
  return upsertMemoryChunk(chunk, {
    persist: async (c) => {
      const rows = await db.execute<{ id: string }>(sql`
        insert into public.memory_chunk (source_type, source_id, content, metadata)
        values (
          ${c.sourceType},
          ${c.sourceId ?? null}::uuid,
          ${c.content},
          ${JSON.stringify(c.metadata ?? {})}::jsonb
        )
        returning id
      `);
      return { id: rows[0]!.id };
    },
  });
}

/** Retrieve with deal/client/user sandbox filters (keyword until embeddings land). */
export async function searchMemory(
  input: RetrieveMemoryInput,
): Promise<RetrievedChunk[]> {
  const rows = await loadChunks();
  return retrieveMemory(input, {
    search: async (q) => keywordSearchFromRows(rows, q),
  });
}
