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

const EMBED_MODEL =
  process.env.LLM_EMBED_MODEL?.trim() || "openai/text-embedding-3-small";

/** Deterministic 1536-d bag-of-tokens vector when OpenRouter embeddings unavailable. */
function localEmbed(text: string): number[] {
  const dims = 1536;
  const out = new Float64Array(dims);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    out[idx] += 1;
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(out, (v) => v / norm);
}

/** Embed text via OpenRouter; falls back to local hash vectors for demo pgvector. */
export async function embedText(text: string): Promise<number[]> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (key && process.env.LLM_PROVIDER !== "mock") {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "http-referer": "https://hrmny-os.vercel.app",
          "x-title": "hrmny-os",
        },
        body: JSON.stringify({
          model: EMBED_MODEL,
          input: text.slice(0, 8000),
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{ embedding?: number[] }>;
        };
        const emb = json.data?.[0]?.embedding;
        if (Array.isArray(emb) && emb.length === 1536) return emb;
      }
    } catch {
      /* fall through to local */
    }
  }
  return localEmbed(text);
}

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

/** Persist into Postgres memory_chunk and embed when OpenRouter is live. */
export async function persistMemoryChunk(
  chunk: MemoryChunk,
): Promise<{ id: string }> {
  const db = getDb();
  if (!db) {
    return upsertMemoryChunk(chunk, {
      persist: async (c) => ({ id: c.id ?? crypto.randomUUID() }),
    });
  }
  const embedding = await embedText(chunk.content);
  return upsertMemoryChunk(chunk, {
    persist: async (c) => {
      const vectorLiteral = `[${embedding.join(",")}]`;
      const rows = await db.execute<{ id: string }>(sql`
        insert into public.memory_chunk (source_type, source_id, content, metadata, embedding)
        values (
          ${c.sourceType},
          ${c.sourceId ?? null}::uuid,
          ${c.content},
          ${JSON.stringify(c.metadata ?? {})}::jsonb,
          ${vectorLiteral}::vector
        )
        returning id
      `);
      return { id: rows[0]!.id };
    },
  });
}

async function vectorSearch(
  input: RetrieveMemoryInput,
  queryEmbedding: number[],
): Promise<RetrievedChunk[]> {
  const db = getDb();
  if (!db) return [];
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;
  const limit = Math.max(input.limit ?? 8, 24);
  const rows = await db.execute<{
    id: string;
    source_type: MemoryChunk["sourceType"];
    source_id: string | null;
    content: string;
    metadata: Record<string, unknown>;
    score: number;
  }>(sql`
    select
      id, source_type, source_id, content, metadata,
      (1 - (embedding <=> ${vectorLiteral}::vector))::float8 as score
    from public.memory_chunk
    where embedding is not null
    order by embedding <=> ${vectorLiteral}::vector
    limit ${limit}
  `);
  return rows
    .filter((r) => {
      const meta = r.metadata ?? {};
      if (
        input.clientId &&
        String(meta.clientId ?? "") !== input.clientId
      ) {
        return false;
      }
      if (input.dealId && String(meta.dealId ?? "") !== input.dealId) {
        return false;
      }
      if (
        input.companyId &&
        String(meta.companyId ?? "") !== input.companyId
      ) {
        return false;
      }
      if (
        input.employeeId &&
        String(meta.employeeId ?? "") !== input.employeeId
      ) {
        return false;
      }
      if (
        input.sourceTypes &&
        !input.sourceTypes.includes(r.source_type)
      ) {
        return false;
      }
      return true;
    })
    .slice(0, input.limit ?? 8)
    .map((r) => ({
      id: r.id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      content: r.content,
      score: r.score,
      metadata: r.metadata ?? {},
    }));
}

/**
 * Retrieve with deal/client/user sandbox filters.
 * Prefers pgvector cosine when embeddings exist; falls back to keyword.
 */
export async function searchMemory(
  input: RetrieveMemoryInput,
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embedText(input.query);
  const vectorHits = await vectorSearch(input, queryEmbedding);
  if (vectorHits.length) {
    return retrieveMemory(input, {
      search: async () => vectorHits,
    });
  }
  const rows = await loadChunks();
  return retrieveMemory(input, {
    search: async (q) => keywordSearchFromRows(rows, q),
  });
}
