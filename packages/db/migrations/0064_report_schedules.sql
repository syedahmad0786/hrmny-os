CREATE TABLE IF NOT EXISTS public.report_schedules (
  report_schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text NOT NULL,
  -- Interval cadence keyword ('daily' | 'weekly' | 'monthly'); an unknown value
  -- never auto-fires (see reports/store.ts isDue). Kept as free text so a cron
  -- expression can slot in later without a migration.
  cadence text NOT NULL DEFAULT 'weekly',
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_schedules_due_idx
  ON public.report_schedules (enabled, last_run_at);

CREATE TABLE IF NOT EXISTS public.report_runs (
  report_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_schedule_id uuid
    REFERENCES public.report_schedules (report_schedule_id) ON DELETE SET NULL,
  report_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  -- Assembled report {title, sections, generatedAt, markdown} plus delivery
  -- receipt / failure reason.
  artifact jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_runs_schedule_idx
  ON public.report_runs (report_schedule_id, created_at);

-- Lock away from the browser Data API (anon/authenticated); server role only.
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'report_schedules',
    'report_runs'
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
