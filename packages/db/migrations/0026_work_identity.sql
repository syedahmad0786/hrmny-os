ALTER TABLE public.employee
  ADD COLUMN IF NOT EXISTS scim_external_id text,
  ADD COLUMN IF NOT EXISTS scim_managed boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS employee_scim_external_uniq
  ON public.employee (scim_external_id) WHERE scim_external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employee_email_lower_uniq
  ON public.employee (lower(email));

ALTER TABLE public.work_team
  ADD COLUMN IF NOT EXISTS scim_external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS work_team_scim_external_uniq
  ON public.work_team (scim_external_id) WHERE scim_external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_sso_configuration (
  organization_key text PRIMARY KEY DEFAULT 'default'
    CHECK (organization_key = 'default'),
  status text NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('disabled', 'optional', 'enforced')),
  provider_id text,
  metadata_url text,
  domains jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(domains) = 'array'),
  break_glass_emails jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(break_glass_emails) = 'array'),
  updated_by_employee_id uuid
    REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'enforced' OR provider_id IS NOT NULL),
  CHECK (status <> 'enforced' OR jsonb_array_length(domains) > 0)
);

INSERT INTO public.work_sso_configuration (organization_key)
VALUES ('default') ON CONFLICT (organization_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.work_scim_token (
  work_scim_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS work_scim_token_active_idx
  ON public.work_scim_token (expires_at, last_used_at)
  WHERE revoked_at IS NULL;

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_sso_configuration',
    'work_scim_token'
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
