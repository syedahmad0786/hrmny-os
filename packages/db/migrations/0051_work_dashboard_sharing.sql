ALTER TABLE public.work_reporting_dashboard
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

ALTER TABLE public.work_reporting_dashboard
  DROP CONSTRAINT IF EXISTS work_reporting_dashboard_visibility_check;
ALTER TABLE public.work_reporting_dashboard
  ADD CONSTRAINT work_reporting_dashboard_visibility_check
  CHECK (visibility IN ('private', 'organization'));

CREATE TABLE IF NOT EXISTS public.work_reporting_dashboard_viewer (
  work_reporting_dashboard_id uuid NOT NULL
    REFERENCES public.work_reporting_dashboard(work_reporting_dashboard_id)
    ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  added_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_reporting_dashboard_id, employee_id)
);

CREATE INDEX IF NOT EXISTS work_reporting_dashboard_viewer_employee_idx
  ON public.work_reporting_dashboard_viewer (employee_id);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_reporting_dashboard_viewer'
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
