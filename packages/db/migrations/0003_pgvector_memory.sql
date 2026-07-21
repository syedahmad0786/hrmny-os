-- Agent memory: pgvector chunks for semantic retrieval
-- Apply via Supabase SQL editor or: psql "$DIRECT_URL" -f packages/db/migrations/0003_pgvector_memory.sql
--
-- If CREATE EXTENSION fails via SQL (permissions), enable in Dashboard:
--   Database → Extensions → search "vector" → Enable
-- Then re-run the CREATE TABLE / INDEX section below.

CREATE EXTENSION IF NOT EXISTS vector;

-- source_type: note | deal | email | doc | activity | feedback | other
CREATE TABLE IF NOT EXISTS memory_chunk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id uuid,
  content text NOT NULL,
  -- text-embedding-3-small default dims; change + re-embed if switching Voyage dims
  embedding vector(1536),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_chunk_source_idx
  ON memory_chunk (source_type, source_id);

CREATE INDEX IF NOT EXISTS memory_chunk_created_idx
  ON memory_chunk (created_at DESC);

-- IVFFlat needs data to be useful; create after first ~100 rows if desired:
-- CREATE INDEX memory_chunk_embedding_ivfflat
--   ON memory_chunk USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMENT ON TABLE memory_chunk IS 'Semantic memory for agents; Postgres SoT remains CRM tables. HITL outcomes may land as source_type=feedback.';
