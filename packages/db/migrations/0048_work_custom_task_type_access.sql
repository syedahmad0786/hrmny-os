ALTER TABLE public.work_custom_task_type
  ADD COLUMN IF NOT EXISTS default_access_level text NOT NULL DEFAULT 'user';

ALTER TABLE public.work_custom_task_type
  DROP CONSTRAINT IF EXISTS work_custom_task_type_default_access_level_check,
  ADD CONSTRAINT work_custom_task_type_default_access_level_check
    CHECK (default_access_level IN ('admin', 'editor', 'user', 'none'));

CREATE TABLE IF NOT EXISTS public.work_custom_task_type_member (
  work_custom_task_type_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_custom_task_type_id uuid NOT NULL
    REFERENCES public.work_custom_task_type(work_custom_task_type_id)
    ON DELETE CASCADE,
  member_type text NOT NULL CHECK (member_type IN ('employee', 'team')),
  employee_id uuid REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  work_team_id uuid REFERENCES public.work_team(work_team_id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('admin', 'editor', 'user')),
  source_platform text NOT NULL DEFAULT 'native'
    CHECK (source_platform IN ('native', 'asana')),
  external_id text,
  source_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (member_type = 'employee' AND employee_id IS NOT NULL AND work_team_id IS NULL)
    OR (member_type = 'team' AND work_team_id IS NOT NULL AND employee_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS work_custom_task_type_member_employee_uniq
  ON public.work_custom_task_type_member (work_custom_task_type_id, employee_id)
  WHERE member_type = 'employee';
CREATE UNIQUE INDEX IF NOT EXISTS work_custom_task_type_member_team_uniq
  ON public.work_custom_task_type_member (work_custom_task_type_id, work_team_id)
  WHERE member_type = 'team';
CREATE UNIQUE INDEX IF NOT EXISTS work_custom_task_type_member_source_uniq
  ON public.work_custom_task_type_member (source_platform, external_id)
  WHERE external_id IS NOT NULL;

INSERT INTO public.work_custom_task_type_member (
  work_custom_task_type_id, member_type, employee_id, access_level
)
SELECT work_custom_task_type_id, 'employee', created_by_employee_id, 'admin'
FROM public.work_custom_task_type
ON CONFLICT (work_custom_task_type_id, employee_id)
  WHERE member_type = 'employee'
DO NOTHING;

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_custom_task_type',
    'work_custom_task_type_member'
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
