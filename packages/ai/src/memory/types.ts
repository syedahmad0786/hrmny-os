import { z } from "zod";

export const MemorySourceTypeSchema = z.enum([
  "note",
  "deal",
  "email",
  "doc",
  "activity",
  "feedback",
  "other",
]);

export type MemorySourceType = z.infer<typeof MemorySourceTypeSchema>;

export const MemoryChunkSchema = z.object({
  id: z.string().uuid().optional(),
  sourceType: MemorySourceTypeSchema,
  sourceId: z.string().uuid().nullable().optional(),
  content: z.string().min(1),
  /** 1536-dim for text-embedding-3-small; omit until embed job runs */
  embedding: z.array(z.number()).length(1536).optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime().optional(),
});

export type MemoryChunk = z.infer<typeof MemoryChunkSchema>;

export const RetrieveMemoryInputSchema = z.object({
  query: z.string().min(1),
  dealId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  sourceTypes: z.array(MemorySourceTypeSchema).optional(),
  limit: z.number().int().min(1).max(50).default(8),
});

export type RetrieveMemoryInput = z.infer<typeof RetrieveMemoryInputSchema>;

export type RetrievedChunk = {
  id: string;
  sourceType: MemorySourceType;
  sourceId: string | null;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
};
