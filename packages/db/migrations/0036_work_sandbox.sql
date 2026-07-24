CREATE TABLE IF NOT EXISTS public.work_sandbox (
  work_sandbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_key text NOT NULL DEFAULT 'default'
    CHECK (organization_key = 'default'),
  name text NOT NULL,
  environment_id text NOT NULL,
  base_url text NOT NULL,
  database_fingerprint text NOT NULL,
  auth_fingerprint text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'unreachable', 'deleted')),
  settings_copied_at timestamptz,
  last_verified_at timestamptz,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  deleted_by_employee_id uuid
    REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_key),
  UNIQUE (environment_id)
);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY['work_sandbox']::text[] LOOP
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
