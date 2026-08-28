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

type EmbeddingProvider = "none" | "local" | "openai" | "openrouter";

function embeddingProvider(): EmbeddingProvider {
  const explicit = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (
    explicit === "openai" ||
    explicit === "openrouter" ||
    explicit === "local"
  ) {
    return explicit;
  }
  if (process.env.LLM_PROVIDER?.trim().toLowerCase() === "openrouter") {
    return "openrouter";
  }
  return "none";
}

function embeddingModel(provider: EmbeddingProvider): string {
  const configured =
    process.env.LLM_EMBED_MODEL?.trim() || process.env.EMBEDDING_MODEL?.trim();
  if (configured) return configured;
  return provider === "openrouter"
    ? "openai/text-embedding-3-small"
    : "text-embedding-3-small";
}

/** Deterministic 1536-d bag-of-tokens vector when OpenRouter embeddings unavailable. */
function localEmbed(text: string): number[] {
  const dims = 1536;
  const out = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    out[idx] = (out[idx] ?? 0) + 1;
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) {
    const v = out[i] ?? 0;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  return out.map((v) => (v ?? 0) / norm);
}

/**
 * Produce a vector only through the explicitly selected bridge. Live provider
 * errors fail loud; they never silently persist a local hash as semantic data.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const provider = embeddingProvider();
  if (provider === "none") return null;
  if (provider === "local") {
    if (process.env.ALLOW_LOCAL_EMBEDDINGS !== "true") return null;
    return localEmbed(text);
  }

  const key =
    provider === "openai"
      ? process.env.OPENAI_API_KEY?.trim()
      : process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error(
      `EMBEDDING_CONFIG_MISSING:${provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY"}`,
    );
  }
  const endpoint =
    provider === "openai"
      ? "https://api.openai.com/v1/embeddings"
      : "https://openrouter.ai/api/v1/embeddings";
  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  if (provider === "openrouter") {
    headers["http-referer"] =
      process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://hrmny-os.vercel.app";
    headers["x-title"] = "hrmny-os";
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: embeddingModel(provider),
      input: text.slice(0, 8000),
      dimensions: 1536,
    }),
  });
  if (!res.ok) {
    throw new Error(`EMBEDDING_PROVIDER_ERROR:${provider}:${res.status}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error(`EMBEDDING_RESPONSE_INVALID:${provider}`);
  }
  return embedding;
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

/** Persist the chunk; embedding remains null until an approved provider exists. */
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
      const vectorLiteral = embedding ? `[${embedding.join(",")}]` : null;
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
      ${
        input.clientId
          ? sql`and metadata->>'clientId' = ${input.clientId}`
          : sql``
      }
      ${input.dealId ? sql`and metadata->>'dealId' = ${input.dealId}` : sql``}
      ${
        input.companyId
          ? sql`and metadata->>'companyId' = ${input.companyId}`
          : sql``
      }
      ${
        input.employeeId
          ? input.clientId
            ? sql`and metadata->>'employeeId' = ${input.employeeId}`
            : sql`and metadata->>'employeeId' = ${input.employeeId}
              and (metadata->>'clientId' is null or metadata->>'clientId' = '')`
          : sql``
      }
      ${input.taskId ? sql`and metadata->>'taskId' = ${input.taskId}` : sql``}
      ${
        input.sourceTypes?.length
          ? sql`and source_type = any(${input.sourceTypes}::text[])`
          : sql``
      }
    order by embedding <=> ${vectorLiteral}::vector
    limit ${limit}
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
/**
 * Fill null embeddings only when an explicit provider is configured. Mock or
 * absent providers leave the rows null so a later live backfill can distinguish
 * genuine semantic vectors from local demo hashes.
 */
export async function backfillMissingEmbeddings(
  limit = 50,
): Promise<{ updated: number; skipped?: string }> {
  const db = getDb();
  if (!db) return { updated: 0, skipped: "no_db" };
  if (embeddingProvider() === "none") {
    return { updated: 0, skipped: "no_embedding_provider" };
  }
  if (
    embeddingProvider() === "local" &&
    process.env.ALLOW_LOCAL_EMBEDDINGS !== "true"
  ) {
    return { updated: 0, skipped: "local_embeddings_not_approved" };
  }
  const rows = await db.execute<{ id: string; content: string }>(sql`
    select id, content
    from public.memory_chunk
    where embedding is null
    order by created_at asc
    limit ${limit}
  `);
  let updated = 0;
  for (const row of rows) {
    const embedding = await embedText(row.content);
    if (!embedding) return { updated, skipped: "embedding_unavailable" };
    const vectorLiteral = `[${embedding.join(",")}]`;
    await db.execute(sql`
      update public.memory_chunk
      set embedding = ${vectorLiteral}::vector
      where id = ${row.id}::uuid
    `);
    updated += 1;
  }
  return { updated };
}

export async function searchMemory(
  input: RetrieveMemoryInput,
): Promise<RetrievedChunk[]> {
  if (
    !input.clientId &&
    !input.employeeId &&
    !input.dealId &&
    !input.companyId &&
    !input.taskId
  ) {
    throw new Error("MEMORY_SCOPE_REQUIRED");
  }
  const queryEmbedding = await embedText(input.query);
  const vectorHits = queryEmbedding
    ? await vectorSearch(input, queryEmbedding)
    : [];
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
