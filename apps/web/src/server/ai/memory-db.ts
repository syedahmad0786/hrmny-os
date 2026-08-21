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

/** Embed text via OpenRouter OpenAI-compatible embeddings API (1536-d). */
export async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key || process.env.LLM_PROVIDER === "mock") return null;
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
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const emb = json.data?.[0]?.embedding;
    return Array.isArray(emb) && emb.length === 1536 ? emb : null;
  } catch {
    return null;
  }
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
      if (embedding) {
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
      }
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

async function vectorSearch(
  input: RetrieveMemoryInput,
  queryEmbedding: number[],
): Promise<RetrievedChunk[]> {
  const db = getDb();
  if (!db) return [];
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;
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
      and (
        ${input.clientId ?? null}::text is null
        or metadata->>'clientId' = ${input.clientId ?? null}
      )
      and (
        ${input.dealId ?? null}::text is null
        or metadata->>'dealId' = ${input.dealId ?? null}
      )
      and (
        ${input.companyId ?? null}::text is null
        or metadata->>'companyId' = ${input.companyId ?? null}
      )
      and (
        ${input.employeeId ?? null}::text is null
        or metadata->>'employeeId' = ${input.employeeId ?? null}
      )
    order by embedding <=> ${vectorLiteral}::vector
    limit ${input.limit ?? 8}
  `);
  return rows.map((r) => ({
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
  if (queryEmbedding) {
    const vectorHits = await vectorSearch(input, queryEmbedding);
    if (vectorHits.length) {
      return retrieveMemory(input, {
        search: async () => vectorHits,
      });
    }
  }
  const rows = await loadChunks();
  return retrieveMemory(input, {
    search: async (q) => keywordSearchFromRows(rows, q),
  });
}
