CREATE TABLE IF NOT EXISTS public.custom_app (
  custom_app_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text NOT NULL,
  description text,
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
  access_scope text NOT NULL DEFAULT 'admin_only'
    CHECK (access_scope IN ('admin_only', 'all_staff', 'roles')),
  allowed_roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  record_visibility text NOT NULL DEFAULT 'own'
    CHECK (record_visibility IN ('own', 'all')),
  is_active boolean NOT NULL DEFAULT true,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (access_scope <> 'roles' OR cardinality(allowed_roles) > 0)
);

CREATE TABLE IF NOT EXISTS public.custom_app_record (
  custom_app_record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_app_id uuid NOT NULL REFERENCES public.custom_app(custom_app_id),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_app_record_app_created_idx
  ON public.custom_app_record (custom_app_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS custom_app_record_creator_idx
  ON public.custom_app_record (created_by_employee_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.governed_report (
  governed_report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  metrics text[] NOT NULL CHECK (cardinality(metrics) BETWEEN 1 AND 20),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  approved_by_employee_id uuid REFERENCES public.employee(employee_id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS governed_report_status_created_idx
  ON public.governed_report (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.governed_report_run (
  governed_report_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governed_report_id uuid NOT NULL REFERENCES public.governed_report(governed_report_id),
  requested_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS governed_report_run_report_created_idx
  ON public.governed_report_run (governed_report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.governed_report_schedule (
  governed_report_schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governed_report_id uuid NOT NULL REFERENCES public.governed_report(governed_report_id),
  cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  export_format text NOT NULL DEFAULT 'csv' CHECK (export_format IN ('csv', 'json')),
  recipients text[] NOT NULL CHECK (cardinality(recipients) BETWEEN 1 AND 50),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS governed_report_schedule_due_idx
  ON public.governed_report_schedule (next_run_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.report_natural_language_request (
  report_natural_language_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_text text NOT NULL,
  proposed_definition jsonb NOT NULL CHECK (jsonb_typeof(proposed_definition) = 'object'),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'rejected')),
  requested_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  accepted_report_id uuid REFERENCES public.governed_report(governed_report_id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_nl_request_requester_created_idx
  ON public.report_natural_language_request (requested_by_employee_id, created_at DESC);

DO $$
DECLARE
  app_table text;
  has_anon boolean;
  has_authenticated boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    INTO has_authenticated;

  FOREACH app_table IN ARRAY ARRAY[
    'custom_app',
    'custom_app_record',
    'governed_report',
    'governed_report_run',
    'governed_report_schedule',
    'report_natural_language_request'
  ]::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    IF has_anon THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    END IF;
    IF has_authenticated THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated',
        app_table
      );
    END IF;
  END LOOP;
END $$;

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role_id, permission.resource, permission.action, 'allow'
FROM public.role
CROSS JOIN (
  VALUES
    ('custom_app', 'manage'),
    ('governed_report', 'manage'),
    ('governed_report', 'view')
) AS permission(resource, action)
WHERE role.key IN ('partner', 'director')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = permission.resource
      AND existing.action = permission.action
      AND existing.effect = 'allow'
  );

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role_id, 'governed_report', 'view', 'allow'
FROM public.role
WHERE role.key IN ('hr', 'finance', 'manager')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = 'governed_report'
      AND existing.action = 'view'
      AND existing.effect = 'allow'
  );
