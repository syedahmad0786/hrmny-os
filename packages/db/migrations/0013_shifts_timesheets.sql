CREATE TABLE IF NOT EXISTS public.shift_template (
  shift_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 720),
  site text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time <> start_time)
);

CREATE TABLE IF NOT EXISTS public.shift_instance (
  shift_instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_template_id uuid REFERENCES public.shift_template(shift_template_id),
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 720),
  site text,
  required_staff integer NOT NULL DEFAULT 1 CHECK (required_staff BETWEEN 0 AND 10000),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'cancelled')),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  published_by_employee_id uuid REFERENCES public.employee(employee_id),
  published_at timestamptz,
  cancelled_by_employee_id uuid REFERENCES public.employee(employee_id),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS shift_instance_status_starts_idx
  ON public.shift_instance (status, starts_at);
CREATE INDEX IF NOT EXISTS shift_instance_template_idx
  ON public.shift_instance (shift_template_id);

CREATE TABLE IF NOT EXISTS public.shift_assignment (
  shift_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_instance_id uuid NOT NULL REFERENCES public.shift_instance(shift_instance_id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'confirmed', 'declined', 'cancelled')),
  assigned_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_assignment_instance_employee_uniq
    UNIQUE (shift_instance_id, employee_id)
);

CREATE INDEX IF NOT EXISTS shift_assignment_employee_idx
  ON public.shift_assignment (employee_id, shift_instance_id);

CREATE TABLE IF NOT EXISTS public.shift_change_request (
  shift_change_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_assignment_id uuid NOT NULL REFERENCES public.shift_assignment(shift_assignment_id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  request_type text NOT NULL CHECK (request_type IN ('move', 'unassign')),
  requested_shift_instance_id uuid REFERENCES public.shift_instance(shift_instance_id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by_employee_id uuid REFERENCES public.employee(employee_id),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (request_type = 'move' AND requested_shift_instance_id IS NOT NULL)
    OR (request_type = 'unassign' AND requested_shift_instance_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS shift_change_request_one_pending_idx
  ON public.shift_change_request (shift_assignment_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS shift_change_request_employee_idx
  ON public.shift_change_request (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shift_change_request_status_idx
  ON public.shift_change_request (status, created_at DESC);
CREATE INDEX IF NOT EXISTS shift_change_request_requested_shift_idx
  ON public.shift_change_request (requested_shift_instance_id);

CREATE TABLE IF NOT EXISTS public.work_project (
  work_project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.client(client_id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_billable_default boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_project_client_idx
  ON public.work_project (client_id);

CREATE TABLE IF NOT EXISTS public.time_entry (
  time_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  work_project_id uuid NOT NULL REFERENCES public.work_project(work_project_id),
  work_date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  is_billable boolean NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz,
  decided_by_employee_id uuid REFERENCES public.employee(employee_id),
  decision_note text,
  decided_at timestamptz,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_entry_employee_date_idx
  ON public.time_entry (employee_id, work_date DESC);
CREATE INDEX IF NOT EXISTS time_entry_project_date_idx
  ON public.time_entry (work_project_id, work_date DESC);
CREATE INDEX IF NOT EXISTS time_entry_status_date_idx
  ON public.time_entry (status, work_date DESC);

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
    'shift_template', 'shift_instance', 'shift_assignment',
    'shift_change_request', 'work_project', 'time_entry'
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
    ('shift', 'manage'),
    ('timesheet', 'manage')
) AS permission(resource, action)
WHERE role.key IN ('partner', 'director', 'hr', 'traffic')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = permission.resource
      AND existing.action = permission.action
      AND existing.effect = 'allow'
  );
