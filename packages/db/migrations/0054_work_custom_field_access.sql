ALTER TABLE public.work_custom_field
  ADD COLUMN IF NOT EXISTS privacy_setting text NOT NULL DEFAULT 'public_with_guests',
  ADD COLUMN IF NOT EXISTS default_access_level text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_value_read_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_workspace_external_id text,
  ADD COLUMN IF NOT EXISTS source_connection_external_id text,
  ADD COLUMN IF NOT EXISTS source_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.work_custom_field
  DROP CONSTRAINT IF EXISTS work_custom_field_privacy_setting_check,
  ADD CONSTRAINT work_custom_field_privacy_setting_check
    CHECK (privacy_setting IN ('private', 'public', 'public_with_guests')),
  DROP CONSTRAINT IF EXISTS work_custom_field_default_access_level_check,
  ADD CONSTRAINT work_custom_field_default_access_level_check
    CHECK (default_access_level IN ('admin', 'editor', 'user'));

ALTER TABLE public.work_object_custom_field_value
  ADD COLUMN IF NOT EXISTS privacy_setting text NOT NULL DEFAULT 'public_with_guests',
  ADD COLUMN IF NOT EXISTS default_access_level text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_value_read_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.work_object_custom_field_value
  DROP CONSTRAINT IF EXISTS work_object_custom_field_privacy_setting_check,
  ADD CONSTRAINT work_object_custom_field_privacy_setting_check
    CHECK (privacy_setting IN ('private', 'public', 'public_with_guests')),
  DROP CONSTRAINT IF EXISTS work_object_custom_field_default_access_level_check,
  ADD CONSTRAINT work_object_custom_field_default_access_level_check
    CHECK (default_access_level IN ('admin', 'editor', 'user'));

CREATE TABLE IF NOT EXISTS public.work_custom_field_member (
  work_custom_field_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_external_id text NOT NULL,
  member_type text NOT NULL CHECK (member_type IN ('employee', 'team')),
  employee_id uuid REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  work_team_id uuid REFERENCES public.work_team(work_team_id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('admin', 'editor', 'user')),
  source_platform text NOT NULL DEFAULT 'asana'
    CHECK (source_platform IN ('native', 'asana')),
  source_workspace_external_id text,
  source_connection_external_id text NOT NULL,
  external_id text,
  source_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (member_type = 'employee' AND employee_id IS NOT NULL AND work_team_id IS NULL)
    OR (member_type = 'team' AND work_team_id IS NOT NULL AND employee_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS work_custom_field_member_employee_uniq
  ON public.work_custom_field_member (
    source_platform, source_connection_external_id, field_external_id, employee_id
  ) WHERE member_type = 'employee';

CREATE UNIQUE INDEX IF NOT EXISTS work_custom_field_member_team_uniq
  ON public.work_custom_field_member (
    source_platform, source_connection_external_id, field_external_id, work_team_id
  ) WHERE member_type = 'team';

CREATE UNIQUE INDEX IF NOT EXISTS work_custom_field_member_source_uniq
  ON public.work_custom_field_member (
    source_platform, source_connection_external_id, external_id
  ) WHERE external_id IS NOT NULL;

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_custom_field_member'
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
