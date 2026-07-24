ALTER TABLE public.work_project
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE public.work_project
  DROP CONSTRAINT IF EXISTS work_project_dates_check;
ALTER TABLE public.work_project
  ADD CONSTRAINT work_project_dates_check
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date);

ALTER TABLE public.work_goal
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.work_goal DROP CONSTRAINT IF EXISTS work_goal_status_check;
ALTER TABLE public.work_goal
  ADD CONSTRAINT work_goal_status_check CHECK (status IN (
    'on_track', 'at_risk', 'off_track', 'achieved', 'partial', 'missed', 'dropped'
  ));
ALTER TABLE public.work_goal
  DROP CONSTRAINT IF EXISTS work_goal_source_platform_check;
ALTER TABLE public.work_goal
  ADD CONSTRAINT work_goal_source_platform_check
  CHECK (source_platform IN ('native', 'asana'));
CREATE UNIQUE INDEX IF NOT EXISTS work_goal_source_external_uniq
  ON public.work_goal (source_platform, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.work_goal_link
  ADD COLUMN IF NOT EXISTS work_portfolio_id uuid
    REFERENCES public.work_portfolio(work_portfolio_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS supporting_work_goal_id uuid
    REFERENCES public.work_goal(work_goal_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_goal_link
  DROP CONSTRAINT IF EXISTS work_goal_link_weight_check;
ALTER TABLE public.work_goal_link
  ADD CONSTRAINT work_goal_link_weight_check CHECK (weight >= 0);
ALTER TABLE public.work_goal_link
  DROP CONSTRAINT IF EXISTS work_goal_link_source_platform_check;
ALTER TABLE public.work_goal_link
  ADD CONSTRAINT work_goal_link_source_platform_check
  CHECK (source_platform IN ('native', 'asana'));
ALTER TABLE public.work_goal_link
  DROP CONSTRAINT IF EXISTS work_goal_link_check;
ALTER TABLE public.work_goal_link
  DROP CONSTRAINT IF EXISTS work_goal_link_one_resource_check;
ALTER TABLE public.work_goal_link
  ADD CONSTRAINT work_goal_link_one_resource_check CHECK (
    num_nonnulls(
      work_project_id, work_item_id, work_portfolio_id, supporting_work_goal_id
    ) = 1
  );
CREATE UNIQUE INDEX IF NOT EXISTS work_goal_portfolio_link_uniq
  ON public.work_goal_link (work_goal_id, work_portfolio_id)
  WHERE work_portfolio_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_goal_goal_link_uniq
  ON public.work_goal_link (work_goal_id, supporting_work_goal_id)
  WHERE supporting_work_goal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_goal_link_source_external_uniq
  ON public.work_goal_link (source_platform, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.work_portfolio
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.work_portfolio
  DROP CONSTRAINT IF EXISTS work_portfolio_dates_check;
ALTER TABLE public.work_portfolio
  ADD CONSTRAINT work_portfolio_dates_check
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date);
ALTER TABLE public.work_portfolio
  DROP CONSTRAINT IF EXISTS work_portfolio_source_platform_check;
ALTER TABLE public.work_portfolio
  ADD CONSTRAINT work_portfolio_source_platform_check
  CHECK (source_platform IN ('native', 'asana'));
CREATE UNIQUE INDEX IF NOT EXISTS work_portfolio_source_external_uniq
  ON public.work_portfolio (source_platform, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.work_status_update
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.work_status_update
  DROP CONSTRAINT IF EXISTS work_status_update_health_check;
ALTER TABLE public.work_status_update
  ADD CONSTRAINT work_status_update_health_check CHECK (health IN (
    'on_track', 'at_risk', 'off_track', 'on_hold', 'complete', 'achieved',
    'partial', 'missed', 'dropped'
  ));
ALTER TABLE public.work_status_update
  DROP CONSTRAINT IF EXISTS work_status_update_source_platform_check;
ALTER TABLE public.work_status_update
  ADD CONSTRAINT work_status_update_source_platform_check
  CHECK (source_platform IN ('native', 'asana'));
CREATE UNIQUE INDEX IF NOT EXISTS work_status_update_source_external_uniq
  ON public.work_status_update (source_platform, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.work_template
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_template
  DROP CONSTRAINT IF EXISTS work_template_source_platform_check;
ALTER TABLE public.work_template
  ADD CONSTRAINT work_template_source_platform_check
  CHECK (source_platform IN ('native', 'asana'));
CREATE UNIQUE INDEX IF NOT EXISTS work_template_source_external_uniq
  ON public.work_template (source_platform, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.time_entry
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.time_entry DROP CONSTRAINT IF EXISTS time_entry_minutes_check;
ALTER TABLE public.time_entry
  ADD CONSTRAINT time_entry_minutes_check CHECK (minutes BETWEEN 1 AND 1000000);
ALTER TABLE public.time_entry
  DROP CONSTRAINT IF EXISTS time_entry_source_platform_check;
ALTER TABLE public.time_entry
  ADD CONSTRAINT time_entry_source_platform_check
  CHECK (source_platform IN ('native', 'asana'));
CREATE UNIQUE INDEX IF NOT EXISTS time_entry_source_external_uniq
  ON public.time_entry (source_platform, external_id)
  WHERE external_id IS NOT NULL;

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_project', 'work_goal', 'work_goal_link', 'work_portfolio',
    'work_status_update', 'work_template', 'time_entry'
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
