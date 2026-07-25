ALTER TABLE public.work_my_tasks_section
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source_workspace_external_id text,
  ADD COLUMN IF NOT EXISTS source_connection_external_id text;

-- Asana permits duplicate My Tasks section names; native writes still reject
-- duplicates in the application boundary.
DROP INDEX IF EXISTS public.work_my_tasks_section_employee_name_uniq;
CREATE INDEX IF NOT EXISTS work_my_tasks_section_employee_name_idx
  ON public.work_my_tasks_section (employee_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS work_my_tasks_section_source_uniq
  ON public.work_my_tasks_section (
    source_platform, source_connection_external_id, external_id
  )
  WHERE external_id IS NOT NULL;

-- Browser-locked application table: 'work_my_tasks_section'.
ALTER TABLE public.work_my_tasks_section ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.work_my_tasks_section FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_my_tasks_section FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_my_tasks_section FROM authenticated;
  END IF;
END $$;
