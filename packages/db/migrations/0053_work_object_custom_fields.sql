ALTER TABLE public.work_project
  ADD COLUMN IF NOT EXISTS source_data jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.work_object_custom_field_value (
  work_object_custom_field_value_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_portfolio_id uuid
    REFERENCES public.work_portfolio(work_portfolio_id) ON DELETE CASCADE,
  work_goal_id uuid
    REFERENCES public.work_goal(work_goal_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  field_type text NOT NULL CHECK (field_type IN (
    'text', 'number', 'date', 'boolean', 'single_select', 'multi_select', 'people'
  )),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  display_value text,
  source_platform text NOT NULL DEFAULT 'native'
    CHECK (source_platform IN ('native', 'asana')),
  external_id text,
  field_external_id text,
  source_workspace_external_id text,
  source_connection_external_id text,
  source_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(work_project_id, work_portfolio_id, work_goal_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_object_custom_field_source_uniq
  ON public.work_object_custom_field_value (
    source_platform, source_connection_external_id, external_id
  ) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_object_custom_field_project_idx
  ON public.work_object_custom_field_value (work_project_id, field_external_id)
  WHERE work_project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_object_custom_field_portfolio_idx
  ON public.work_object_custom_field_value (work_portfolio_id, field_external_id)
  WHERE work_portfolio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_object_custom_field_goal_idx
  ON public.work_object_custom_field_value (work_goal_id, field_external_id)
  WHERE work_goal_id IS NOT NULL;

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_object_custom_field_value'
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
