-- Ops fields for delivery board entities currently carried only in demo-store.

ALTER TABLE public.task
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS qc_passed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qc_notes text,
  ADD COLUMN IF NOT EXISTS client_revision_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revision_boundary_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brief_id uuid;

ALTER TABLE public.calendar
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'draft';

ALTER TABLE public.brief
  ADD COLUMN IF NOT EXISTS missing jsonb NOT NULL DEFAULT '[]'::jsonb;

-- brief_id on task is a soft link (brief also references task). No FK to avoid
-- insert-order cycles during seed/upsert.

-- Reaffirm RLS lockdown on altered tables (no new browser Data API surface).
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'task',
    'calendar',
    'brief'
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
