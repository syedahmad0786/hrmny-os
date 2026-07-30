-- Sales & Growth (June SQLite prototype) → PostgreSQL consolidation.
-- Slot 0065 adds the import provenance layer: a generic per-row lineage table
-- (which source row became which CRM row) plus a Sales & Growth staging table
-- holding the raw exported rows as reconciliation evidence. The transform +
-- apply live in @hrmny/integrations/salesgrowth; these tables are what a run writes.

-- Generic import lineage: one row per source row consumed, whatever the target.
-- The (source_system, source_table, source_id) uniqueness is the idempotency key
-- that makes re-running an import a no-op.
CREATE TABLE IF NOT EXISTS public.import_lineage (
  import_lineage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  source_table text NOT NULL,
  source_id text NOT NULL,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  checksum text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_lineage_source_uniq
    UNIQUE (source_system, source_table, source_id)
);

CREATE INDEX IF NOT EXISTS import_lineage_target_idx
  ON public.import_lineage (target_table, target_id);
CREATE INDEX IF NOT EXISTS import_lineage_system_idx
  ON public.import_lineage (source_system, source_table);

-- Sales & Growth raw staging: the JSON export intermediate, kept verbatim as
-- reconciliation evidence (what was ingested, with a content checksum). Upserted
-- on (source_table, source_id) so a re-export refreshes the same row.
CREATE TABLE IF NOT EXISTS public.salesgrowth_import_staging (
  salesgrowth_import_staging_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_id text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salesgrowth_import_staging_source_uniq
    UNIQUE (source_table, source_id)
);

CREATE INDEX IF NOT EXISTS salesgrowth_import_staging_table_idx
  ON public.salesgrowth_import_staging (source_table);

-- Lock away from the browser Data API (anon/authenticated); server role only.
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'import_lineage',
    'salesgrowth_import_staging'
  ]::text[] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', app_table
      );
    END IF;
  END LOOP;
END $$;
