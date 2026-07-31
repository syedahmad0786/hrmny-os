import { sql } from "@hrmny/db";
import {
  keywordSearchFromRows,
  upsertMemoryChunk,
  retrieveMemory,
  type MemoryChunk,
  type MemorySourceType,
  type RetrieveMemoryInput,
  type RetrievedChunk,
} from "@hrmny/ai";
import { getDb } from "../db";

type MemoryRow = {
  id: string;
  source_type: MemorySourceType;
  source_id: string | null;
  content: string;
  metadata: Record<string, unknown>;
};

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Embed text with OpenAI text-embedding-3-small (1536 dims).
 * Returns null when OPENAI_API_KEY is unset (chunk still persists without vector).
 */
export async function embedText(content: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const model =
    process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: content.slice(0, 8000),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Embedding provider error ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding || embedding.length !== 1536) {
    throw new Error("Embedding provider returned unexpected dimensions");
  }
  return embedding;
}

async function persistChunk(chunk: MemoryChunk): Promise<{ id: string }> {
  const db = getDb();
  if (!db) {
    throw new Error("DATABASE_URL required to persist memory_chunk");
  }
  const id = chunk.id ?? crypto.randomUUID();
  const embedding = chunk.embedding ?? null;
  const meta = JSON.stringify(chunk.metadata ?? {});
  if (embedding) {
    await db.execute(sql`
      insert into public.memory_chunk (
        id, source_type, source_id, content, embedding, metadata
      ) values (
        ${id}::uuid,
        ${chunk.sourceType},
        ${chunk.sourceId ?? null}::uuid,
        ${chunk.content},
        ${vectorLiteral(embedding)}::vector,
        ${meta}::jsonb
      )
      on conflict (id) do update set
        content = excluded.content,
        embedding = excluded.embedding,
        metadata = excluded.metadata
    `);
  } else {
    await db.execute(sql`
      insert into public.memory_chunk (
        id, source_type, source_id, content, metadata
      ) values (
        ${id}::uuid,
        ${chunk.sourceType},
        ${chunk.sourceId ?? null}::uuid,
        ${chunk.content},
        ${meta}::jsonb
      )
      on conflict (id) do update set
        content = excluded.content,
        metadata = excluded.metadata
    `);
  }
  return { id };
}

/** Upsert a memory chunk and embed when OPENAI_API_KEY is present. */
export async function rememberChunk(input: {
  sourceType: MemorySourceType;
  sourceId?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; embedded: boolean }> {
  let embedding: number[] | undefined;
  try {
    const vector = await embedText(input.content);
    if (vector) embedding = vector;
  } catch {
    // Persist without embedding rather than failing the business write.
    embedding = undefined;
  }
  const { id } = await upsertMemoryChunk(
    {
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      content: input.content,
      embedding,
      metadata: input.metadata ?? {},
    },
    { persist: persistChunk },
  );
  return { id, embedded: Boolean(embedding) };
}

async function vectorSearch(
  input: RetrieveMemoryInput,
): Promise<RetrievedChunk[]> {
  const db = getDb();
  if (!db) return [];

  const queryEmbedding = await embedText(input.query);
  if (!queryEmbedding) {
    // Keyword fallback against recent rows when embeddings unavailable.
    const rows = (await db.execute(sql`
      select id, source_type, source_id, content, metadata
      from public.memory_chunk
      order by created_at desc
      limit 200
    `)) as unknown as MemoryRow[];
    return keywordSearchFromRows(
      rows.map((row) => ({
        id: row.id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        content: row.content,
        metadata: row.metadata ?? {},
      })),
      input,
    );
  }

  const vec = vectorLiteral(queryEmbedding);
  const limit = input.limit ?? 8;
  const rows = (await db.execute(sql`
    select
      id,
      source_type,
      source_id,
      content,
      metadata,
      (1 - (embedding <=> ${vec}::vector))::float8 as score
    from public.memory_chunk
    where embedding is not null
      and (
        ${input.dealId ?? null}::text is null
        or metadata->>'dealId' = ${input.dealId ?? null}
      )
      and (
        ${input.companyId ?? null}::text is null
        or metadata->>'companyId' = ${input.companyId ?? null}
      )
    order by embedding <=> ${vec}::vector
    limit ${limit}
  `)) as unknown as Array<MemoryRow & { score: number }>;

  return rows.map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    content: row.content,
    score: Number(row.score),
    metadata: row.metadata ?? {},
  }));
}

/** Retrieve-before-act against Postgres pgvector (keyword fallback without key). */
export async function recallMemory(
  input: RetrieveMemoryInput,
): Promise<RetrievedChunk[]> {
  return retrieveMemory(input, { search: vectorSearch });
}

/** Record a win/loss note and embed it for future retrieval. */
export async function recordWinLossNote(input: {
  dealId: string;
  outcome: "won" | "lost" | "postponed_on_hold";
  note: string;
}): Promise<{ winLossNoteId: string; memoryId: string | null }> {
  const db = getDb();
  if (!db) {
    return { winLossNoteId: crypto.randomUUID(), memoryId: null };
  }
  const rows = (await db.execute(sql`
    insert into public.win_loss_notes (deal_id, outcome, note)
    values (${input.dealId}::uuid, ${input.outcome}, ${input.note})
    returning win_loss_note_id as id
  `)) as unknown as Array<{ id: string }>;
  const winLossNoteId = rows[0]?.id ?? crypto.randomUUID();
  let memoryId: string | null = null;
  try {
    const remembered = await rememberChunk({
      sourceType: "feedback",
      sourceId: input.dealId,
      content: `Deal ${input.outcome}: ${input.note}`,
      metadata: {
        dealId: input.dealId,
        outcome: input.outcome,
        winLossNoteId,
      },
    });
    memoryId = remembered.id;
  } catch {
    memoryId = null;
  }
  return { winLossNoteId, memoryId };
}
