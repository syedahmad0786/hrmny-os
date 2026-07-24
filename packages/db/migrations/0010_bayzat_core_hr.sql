CREATE TABLE IF NOT EXISTS public.employee_hr_profile (
  employee_id uuid PRIMARY KEY REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  personal_email text,
  phone text,
  nationality text,
  date_of_birth date,
  employment_type text,
  office text,
  joining_date date,
  probation_end_date date,
  emirates_id_number text,
  work_permit_number text,
  emergency_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(emergency_contact) = 'object')
);

CREATE TABLE IF NOT EXISTS public.employee_document (
  employee_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  document_type text NOT NULL,
  document_number text,
  storage_path text NOT NULL,
  issued_at date,
  expires_at date,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'replaced', 'revoked')),
  uploaded_by_employee_id uuid REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at >= issued_at)
);

CREATE INDEX IF NOT EXISTS employee_document_employee_expiry_idx
  ON public.employee_document (employee_id, expires_at);

CREATE TABLE IF NOT EXISTS public.company_asset (
  company_asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  serial_number text,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'assigned', 'maintenance', 'retired', 'lost')),
  purchased_at date,
  purchase_cost_aed numeric(12,2) CHECK (purchase_cost_aed IS NULL OR purchase_cost_aed >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_asset_assignment (
  company_asset_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_asset_id uuid NOT NULL REFERENCES public.company_asset(company_asset_id),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  assigned_by_employee_id uuid REFERENCES public.employee(employee_id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_back_at timestamptz,
  returned_at timestamptz,
  return_condition text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (returned_at IS NULL OR returned_at >= assigned_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_asset_one_open_assignment_idx
  ON public.company_asset_assignment (company_asset_id)
  WHERE returned_at IS NULL;
CREATE INDEX IF NOT EXISTS company_asset_assignment_employee_idx
  ON public.company_asset_assignment (employee_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS public.lifecycle_task_template (
  lifecycle_task_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase text NOT NULL CHECK (phase IN ('onboarding', 'offboarding')),
  title text NOT NULL,
  description text,
  relative_due_days integer NOT NULL DEFAULT 0 CHECK (relative_due_days BETWEEN -365 AND 365),
  assignee_role text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phase, title)
);

CREATE TABLE IF NOT EXISTS public.employee_lifecycle_task (
  employee_lifecycle_task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  lifecycle_task_template_id uuid REFERENCES public.lifecycle_task_template(lifecycle_task_template_id),
  phase text NOT NULL CHECK (phase IN ('onboarding', 'offboarding')),
  title text NOT NULL,
  description text,
  assignee_role text,
  assignee_employee_id uuid REFERENCES public.employee(employee_id),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  completed_by_employee_id uuid REFERENCES public.employee(employee_id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS employee_lifecycle_task_employee_status_idx
  ON public.employee_lifecycle_task (employee_id, status, due_at);
CREATE INDEX IF NOT EXISTS employee_lifecycle_task_assignee_status_idx
  ON public.employee_lifecycle_task (assignee_employee_id, status, due_at);

CREATE TABLE IF NOT EXISTS public.employee_letter_request (
  employee_letter_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  letter_type text NOT NULL,
  addressed_to text,
  purpose text,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar', 'both')),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'processing', 'ready', 'rejected', 'cancelled')),
  storage_path text,
  handled_by_employee_id uuid REFERENCES public.employee(employee_id),
  decision_note text,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_letter_request_employee_status_idx
  ON public.employee_letter_request (employee_id, status, created_at DESC);

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
    'employee_hr_profile',
    'employee_document',
    'company_asset',
    'company_asset_assignment',
    'lifecycle_task_template',
    'employee_lifecycle_task',
    'employee_letter_request'
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
    ('employee_record', 'manage'),
    ('company_asset', 'manage'),
    ('employee_lifecycle_task', 'manage'),
    ('employee_letter', 'manage')
) AS permission(resource, action)
WHERE role.key IN ('partner', 'director', 'hr')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = permission.resource
      AND existing.action = permission.action
      AND existing.effect = 'allow'
  );
