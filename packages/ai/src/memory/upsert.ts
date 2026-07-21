import {
  MemoryChunkSchema,
  type MemoryChunk,
} from "./types";

export type UpsertMemoryDeps = {
  /**
   * Persist chunk row. Real impl: INSERT into memory_chunk (Drizzle / SQL).
   * Embedding may be null until embed pipeline runs.
   */
  persist: (chunk: MemoryChunk) => Promise<{ id: string }>;
  /** Optional: enqueue Inngest `memory/embed-source` */
  enqueueEmbed?: (id: string) => Promise<void>;
};

/**
 * Upsert semantic memory stub — validates, persists, optionally queues embed.
 * Does not call LLM providers here (keep credit-safe).
 */
export async function upsertMemoryChunk(
  input: MemoryChunk,
  deps: UpsertMemoryDeps,
): Promise<{ id: string }> {
  const chunk = MemoryChunkSchema.parse(input);
  const { id } = await deps.persist(chunk);
  if (deps.enqueueEmbed) {
    await deps.enqueueEmbed(id);
  }
  return { id };
}

/** In-memory store for unit tests / local demos without Postgres. */
export function createInMemoryMemoryStore() {
  const rows = new Map<string, MemoryChunk & { id: string }>();
  return {
    rows,
    persist: async (chunk: MemoryChunk) => {
      const id = chunk.id ?? crypto.randomUUID();
      rows.set(id, { ...chunk, id });
      return { id };
    },
  };
}
