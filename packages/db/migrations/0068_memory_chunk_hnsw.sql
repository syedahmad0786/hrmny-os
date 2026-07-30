-- Optional ANN index for memory_chunk embeddings (AI-6).
-- Safe to apply before there are rows; HNSW builds empty and grows with inserts.
-- Prefer HNSW over IVFFlat at agency scale (no train step, better recall).

CREATE INDEX IF NOT EXISTS memory_chunk_embedding_hnsw
  ON public.memory_chunk
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX public.memory_chunk_embedding_hnsw IS
  'Cosine HNSW for retrieve-before-act; rebuild not required as chunks accumulate.';

-- Reaffirm table lockdown (index-only migration; no new browser surface).
ALTER TABLE public.memory_chunk ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.memory_chunk FROM PUBLIC;
REVOKE ALL ON TABLE public.memory_chunk FROM anon;
REVOKE ALL ON TABLE public.memory_chunk FROM authenticated;
