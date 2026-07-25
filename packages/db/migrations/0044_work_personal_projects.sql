ALTER TABLE public.work_project
  ADD COLUMN IF NOT EXISTS project_kind text NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.work_project'::regclass
      AND conname = 'work_project_kind_check'
  ) THEN
    ALTER TABLE public.work_project
      ADD CONSTRAINT work_project_kind_check
      CHECK (project_kind IN ('standard', 'personal'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS work_project_personal_owner_uniq
  ON public.work_project (owner_employee_id)
  WHERE project_kind = 'personal';

-- Browser-locked application table: 'work_project'.
ALTER TABLE public.work_project ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.work_project FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_project FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_project FROM authenticated;
  END IF;
END $$;
