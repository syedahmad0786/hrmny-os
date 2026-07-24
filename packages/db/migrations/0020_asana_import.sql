CREATE TABLE IF NOT EXISTS public.work_migration_run (
  work_migration_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform text NOT NULL CHECK (source_platform IN ('asana')),
  workspace_external_id text NOT NULL,
  workspace_name text,
  mode text NOT NULL CHECK (mode IN ('dry_run', 'import')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  requested_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_migration_run_workspace_idx
  ON public.work_migration_run (source_platform, workspace_external_id, started_at DESC);

ALTER TABLE public.work_comment
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native'
    CHECK (source_platform IN ('native', 'asana')),
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS work_comment_source_external_uniq
  ON public.work_comment (source_platform, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS work_attachment_source_external_uniq
  ON public.work_attachment (source_platform, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.work_custom_field
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native'
    CHECK (source_platform IN ('native', 'asana')),
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS work_custom_field_source_external_uniq
  ON public.work_custom_field (work_project_id, source_platform, external_id)
  WHERE external_id IS NOT NULL;

DO $$
DECLARE
  app_table text;
  has_anon boolean;
  has_authenticated boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    INTO has_authenticated;

  FOREACH app_table IN ARRAY ARRAY[
    'work_migration_run'
  ]::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    IF has_anon THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    END IF;
    IF has_authenticated THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated',
        app_table
      );
    END IF;
  END LOOP;
END $$;
