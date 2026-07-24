CREATE TABLE IF NOT EXISTS public.work_team (
  work_team_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  privacy text NOT NULL DEFAULT 'request'
    CHECK (privacy IN ('public', 'request', 'private')),
  source_platform text NOT NULL DEFAULT 'native'
    CHECK (source_platform IN ('native', 'asana')),
  external_id text,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_team_name_active_uniq
  ON public.work_team (lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_team_source_external_uniq
  ON public.work_team (source_platform, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_team_member (
  work_team_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_team_id uuid NOT NULL
    REFERENCES public.work_team(work_team_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_team_id, employee_id)
);

CREATE INDEX IF NOT EXISTS work_team_member_employee_idx
  ON public.work_team_member (employee_id, work_team_id);

CREATE TABLE IF NOT EXISTS public.work_team_project (
  work_team_project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_team_id uuid NOT NULL
    REFERENCES public.work_team(work_team_id) ON DELETE CASCADE,
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  access_level text NOT NULL DEFAULT 'editor'
    CHECK (access_level IN ('editor', 'commenter', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_team_id, work_project_id)
);

CREATE INDEX IF NOT EXISTS work_team_project_project_idx
  ON public.work_team_project (work_project_id, work_team_id);

CREATE TABLE IF NOT EXISTS public.work_project_guest (
  work_project_guest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  portal_user_id uuid NOT NULL
    REFERENCES public.client_portal_user(client_portal_user_id) ON DELETE CASCADE,
  access_level text NOT NULL DEFAULT 'viewer'
    CHECK (access_level IN ('commenter', 'viewer')),
  invited_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_project_id, portal_user_id)
);

CREATE INDEX IF NOT EXISTS work_project_guest_user_idx
  ON public.work_project_guest (portal_user_id, work_project_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_user_client_email_uniq
  ON public.client_portal_user (client_id, lower(email));

CREATE TABLE IF NOT EXISTS public.work_member_license (
  employee_id uuid PRIMARY KEY
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  license_type text NOT NULL DEFAULT 'full'
    CHECK (license_type IN ('full', 'view_only')),
  updated_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_organization_policy (
  organization_key text PRIMARY KEY DEFAULT 'default'
    CHECK (organization_key = 'default'),
  approved_domains jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(approved_domains) = 'array'),
  default_project_privacy text NOT NULL DEFAULT 'organization'
    CHECK (default_project_privacy IN ('organization', 'private')),
  default_team_privacy text NOT NULL DEFAULT 'request'
    CHECK (default_team_privacy IN ('public', 'request', 'private')),
  guest_invite_policy text NOT NULL DEFAULT 'admins'
    CHECK (guest_invite_policy IN ('admins', 'members', 'disabled')),
  external_sharing_enabled boolean NOT NULL DEFAULT true,
  app_policy text NOT NULL DEFAULT 'approved_only'
    CHECK (app_policy IN ('allow_all', 'approved_only', 'disabled')),
  session_timeout_minutes integer NOT NULL DEFAULT 720
    CHECK (session_timeout_minutes BETWEEN 15 AND 43200),
  updated_by_employee_id uuid
    REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.work_organization_policy (organization_key)
VALUES ('default') ON CONFLICT (organization_key) DO NOTHING;

ALTER TABLE public.work_comment
  ADD COLUMN IF NOT EXISTS author_portal_user_id uuid
    REFERENCES public.client_portal_user(client_portal_user_id) ON DELETE RESTRICT;
ALTER TABLE public.work_comment ALTER COLUMN author_employee_id DROP NOT NULL;
ALTER TABLE public.work_comment
  DROP CONSTRAINT IF EXISTS work_comment_one_author_check;
ALTER TABLE public.work_comment
  ADD CONSTRAINT work_comment_one_author_check CHECK (
    (author_employee_id IS NOT NULL)::integer +
    (author_portal_user_id IS NOT NULL)::integer = 1
  );

ALTER TABLE public.audit_event
  ADD COLUMN IF NOT EXISTS actor_portal_user_id uuid
    REFERENCES public.client_portal_user(client_portal_user_id) ON DELETE SET NULL;

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_team',
    'work_team_member',
    'work_team_project',
    'work_project_guest',
    'work_member_license',
    'work_organization_policy'
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

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role_id, 'admin', 'work', 'allow'
FROM public.role
WHERE role.key IN ('partner', 'director')
  AND NOT EXISTS (
    SELECT 1 FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = 'admin'
      AND existing.action = 'work'
      AND existing.effect = 'allow'
  );
