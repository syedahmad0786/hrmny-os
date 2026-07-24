CREATE TABLE IF NOT EXISTS public.work_project_rate (
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  hourly_cost_rate numeric(12,2) NOT NULL
    CHECK (hourly_cost_rate BETWEEN 0 AND 1000000000),
  set_by_employee_id uuid
    REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_project_id, employee_id)
);

CREATE INDEX IF NOT EXISTS work_project_rate_employee_idx
  ON public.work_project_rate (employee_id);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_project_rate'
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
