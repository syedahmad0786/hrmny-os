CREATE TABLE IF NOT EXISTS public.leave_policy (
  leave_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  leave_type text NOT NULL,
  annual_days numeric(5,2) NOT NULL DEFAULT 0 CHECK (annual_days >= 0),
  max_carryover_days numeric(5,2) NOT NULL DEFAULT 0 CHECK (max_carryover_days >= 0),
  is_paid boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.leave_balance (
  leave_balance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  leave_policy_id uuid NOT NULL REFERENCES public.leave_policy(leave_policy_id),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  entitled_days numeric(5,2) NOT NULL DEFAULT 0 CHECK (entitled_days >= 0),
  carried_over_days numeric(5,2) NOT NULL DEFAULT 0 CHECK (carried_over_days >= 0),
  adjustment_days numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_balance_employee_policy_year_uniq
    UNIQUE (employee_id, leave_policy_id, year)
);

CREATE INDEX IF NOT EXISTS leave_balance_employee_year_idx
  ON public.leave_balance (employee_id, year);

CREATE TABLE IF NOT EXISTS public.leave_request (
  leave_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  leave_policy_id uuid NOT NULL REFERENCES public.leave_policy(leave_policy_id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  portion text NOT NULL DEFAULT 'full'
    CHECK (portion IN ('full', 'first_half', 'second_half')),
  days numeric(5,2) NOT NULL CHECK (days > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by_employee_id uuid REFERENCES public.employee(employee_id),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS leave_request_employee_start_idx
  ON public.leave_request (employee_id, start_date);
CREATE INDEX IF NOT EXISTS leave_request_status_start_idx
  ON public.leave_request (status, start_date);
CREATE INDEX IF NOT EXISTS leave_request_policy_idx
  ON public.leave_request (leave_policy_id);

CREATE TABLE IF NOT EXISTS public.attendance_record (
  attendance_record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  work_date date NOT NULL,
  clock_in_at timestamptz NOT NULL,
  clock_out_at timestamptz,
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'correction')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_record_employee_date_uniq UNIQUE (employee_id, work_date),
  CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at)
);

CREATE INDEX IF NOT EXISTS attendance_record_work_date_idx
  ON public.attendance_record (work_date);

CREATE TABLE IF NOT EXISTS public.attendance_correction_request (
  attendance_correction_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  attendance_record_id uuid REFERENCES public.attendance_record(attendance_record_id),
  work_date date NOT NULL,
  requested_clock_in_at timestamptz NOT NULL,
  requested_clock_out_at timestamptz NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by_employee_id uuid REFERENCES public.employee(employee_id),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_clock_out_at > requested_clock_in_at)
);

CREATE INDEX IF NOT EXISTS attendance_correction_employee_date_idx
  ON public.attendance_correction_request (employee_id, work_date);
CREATE INDEX IF NOT EXISTS attendance_correction_status_date_idx
  ON public.attendance_correction_request (status, work_date);
CREATE INDEX IF NOT EXISTS attendance_correction_record_idx
  ON public.attendance_correction_request (attendance_record_id);

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
    'leave_policy',
    'leave_balance',
    'leave_request',
    'attendance_record',
    'attendance_correction_request'
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
    ('leave', 'manage'),
    ('attendance', 'manage')
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
