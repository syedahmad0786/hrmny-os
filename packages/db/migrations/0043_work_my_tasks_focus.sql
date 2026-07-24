CREATE TABLE IF NOT EXISTS public.work_my_tasks_focus (
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  week_start date NOT NULL,
  focus_text text NOT NULL DEFAULT '' CHECK (length(focus_text) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS work_my_tasks_focus_week_idx
  ON public.work_my_tasks_focus (week_start, employee_id);

-- Browser-locked application table: 'work_my_tasks_focus'.
ALTER TABLE public.work_my_tasks_focus ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.work_my_tasks_focus FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_my_tasks_focus FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_my_tasks_focus FROM authenticated;
  END IF;
END $$;
