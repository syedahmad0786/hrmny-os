CREATE TABLE IF NOT EXISTS public.salary_package (
  salary_package_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  effective_from date NOT NULL,
  effective_to date,
  currency text NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$'),
  basic_monthly numeric(14,2) NOT NULL CHECK (basic_monthly >= 0),
  housing_monthly numeric(14,2) NOT NULL DEFAULT 0 CHECK (housing_monthly >= 0),
  transport_monthly numeric(14,2) NOT NULL DEFAULT 0 CHECK (transport_monthly >= 0),
  other_allowance_monthly numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_allowance_monthly >= 0),
  bank_iban text,
  bank_routing_code text,
  mohre_person_id text,
  wps_agent_id text,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT salary_package_employee_effective_uniq UNIQUE (employee_id, effective_from)
);

CREATE INDEX IF NOT EXISTS salary_package_employee_date_idx
  ON public.salary_package (employee_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.employee_expense (
  employee_expense_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  submitted_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  expense_date date NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$'),
  receipt_asset_id uuid REFERENCES public.asset(asset_id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'reimbursed', 'cancelled')),
  approved_by_employee_id uuid REFERENCES public.employee(employee_id),
  approved_at timestamptz,
  decision_note text,
  reimbursed_payroll_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_expense_employee_date_idx
  ON public.employee_expense (employee_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS employee_expense_status_idx
  ON public.employee_expense (status, expense_date);

CREATE TABLE IF NOT EXISTS public.employee_loan (
  employee_loan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  requested_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  purpose text NOT NULL,
  principal_amount numeric(14,2) NOT NULL CHECK (principal_amount > 0),
  outstanding_amount numeric(14,2) NOT NULL CHECK (outstanding_amount >= 0),
  instalment_amount numeric(14,2) NOT NULL CHECK (instalment_amount > 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$'),
  first_deduction_period date,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'active', 'settled', 'rejected', 'cancelled')),
  approved_by_employee_id uuid REFERENCES public.employee(employee_id),
  approved_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outstanding_amount <= principal_amount)
);

CREATE INDEX IF NOT EXISTS employee_loan_employee_status_idx
  ON public.employee_loan (employee_id, status);

CREATE TABLE IF NOT EXISTS public.payroll_run (
  payroll_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  run_number integer NOT NULL DEFAULT 1 CHECK (run_number > 0),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'approved', 'posted', 'cancelled')),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$'),
  calculation_rule_version text NOT NULL,
  total_gross numeric(16,2) NOT NULL DEFAULT 0,
  total_reimbursements numeric(16,2) NOT NULL DEFAULT 0,
  total_deductions numeric(16,2) NOT NULL DEFAULT 0,
  total_net numeric(16,2) NOT NULL DEFAULT 0,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  confirmed_by_employee_id uuid REFERENCES public.employee(employee_id),
  confirmed_at timestamptz,
  approved_by_employee_id uuid REFERENCES public.employee(employee_id),
  approved_at timestamptz,
  posted_by_employee_id uuid REFERENCES public.employee(employee_id),
  posted_at timestamptz,
  xero_journal_id text,
  wps_status text NOT NULL DEFAULT 'not_generated'
    CHECK (wps_status IN ('not_generated', 'generated', 'validated', 'submitted', 'accepted', 'rejected')),
  wps_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (total_gross >= 0 AND total_reimbursements >= 0 AND total_deductions >= 0 AND total_net >= 0),
  CONSTRAINT payroll_run_period_number_uniq UNIQUE (period_start, period_end, run_number)
);

CREATE INDEX IF NOT EXISTS payroll_run_period_idx
  ON public.payroll_run (period_start DESC, period_end DESC);

CREATE TABLE IF NOT EXISTS public.payroll_line (
  payroll_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_run(payroll_run_id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  salary_package_id uuid NOT NULL REFERENCES public.salary_package(salary_package_id),
  paid_days integer NOT NULL CHECK (paid_days >= 0),
  calendar_days integer NOT NULL CHECK (calendar_days > 0 AND paid_days <= calendar_days),
  basic_amount numeric(14,2) NOT NULL DEFAULT 0,
  housing_amount numeric(14,2) NOT NULL DEFAULT 0,
  transport_amount numeric(14,2) NOT NULL DEFAULT 0,
  other_allowance_amount numeric(14,2) NOT NULL DEFAULT 0,
  overtime_amount numeric(14,2) NOT NULL DEFAULT 0,
  bonus_amount numeric(14,2) NOT NULL DEFAULT 0,
  expense_reimbursement numeric(14,2) NOT NULL DEFAULT 0,
  deductions_amount numeric(14,2) NOT NULL DEFAULT 0,
  loan_deduction numeric(14,2) NOT NULL DEFAULT 0,
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  net_amount numeric(14,2) NOT NULL CHECK (net_amount >= 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$'),
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_line_run_employee_uniq UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS payroll_line_employee_idx
  ON public.payroll_line (employee_id, payroll_run_id);

ALTER TABLE public.employee_expense
  ADD CONSTRAINT employee_expense_payroll_run_fk
  FOREIGN KEY (reimbursed_payroll_run_id) REFERENCES public.payroll_run(payroll_run_id);

CREATE TABLE IF NOT EXISTS public.payslip (
  payslip_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_run(payroll_run_id),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar', 'bilingual')),
  storage_path text NOT NULL,
  checksum text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payslip_run_employee_language_uniq UNIQUE (payroll_run_id, employee_id, language)
);

CREATE OR REPLACE FUNCTION public.prevent_locked_payroll_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_status text;
BEGIN
  SELECT status INTO run_status
  FROM public.payroll_run
  WHERE payroll_run_id = CASE
    WHEN TG_OP = 'DELETE' THEN OLD.payroll_run_id
    ELSE NEW.payroll_run_id
  END;
  IF run_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'payroll lines are immutable after confirmation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payroll_line_locked_guard ON public.payroll_line;
CREATE TRIGGER payroll_line_locked_guard
BEFORE UPDATE OR DELETE ON public.payroll_line
FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_payroll_line_mutation();

DO $$
DECLARE
  app_table text;
  has_anon boolean;
  has_authenticated boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_authenticated;
  FOREACH app_table IN ARRAY ARRAY[
    'salary_package', 'employee_expense', 'employee_loan',
    'payroll_run', 'payroll_line', 'payslip'
  ]::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    IF has_anon THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    END IF;
    IF has_authenticated THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', app_table);
    END IF;
  END LOOP;
END $$;

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role_id, permission.resource, permission.action, 'allow'
FROM public.role
CROSS JOIN (
  VALUES ('payroll', 'view'), ('payroll', 'manage'), ('expense', 'approve'), ('loan', 'approve')
) AS permission(resource, action)
WHERE role.key IN ('partner', 'director', 'finance', 'hr')
  AND NOT EXISTS (
    SELECT 1 FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = permission.resource
      AND existing.action = permission.action
      AND existing.effect = 'allow'
  );
