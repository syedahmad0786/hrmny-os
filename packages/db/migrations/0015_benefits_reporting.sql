CREATE TABLE IF NOT EXISTS public.benefit_catalog (
  benefit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'health_insurance', 'allowance', 'wellness', 'perk', 'other'
  )),
  description text,
  provider_name text,
  provider_reference text,
  provider_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency text NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$'),
  employee_contribution_limit numeric(14,2)
    CHECK (employee_contribution_limit IS NULL OR employee_contribution_limit >= 0),
  employer_contribution_limit numeric(14,2)
    CHECK (employer_contribution_limit IS NULL OR employer_contribution_limit >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(provider_terms) = 'object')
);

CREATE TABLE IF NOT EXISTS public.benefit_eligibility_rule (
  benefit_eligibility_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_id uuid NOT NULL REFERENCES public.benefit_catalog(benefit_id) ON DELETE CASCADE,
  department text,
  employment_type text,
  min_service_days integer NOT NULL DEFAULT 0 CHECK (min_service_days >= 0),
  starts_at date,
  ends_at date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS benefit_eligibility_rule_benefit_idx
  ON public.benefit_eligibility_rule (benefit_id, is_active);

CREATE TABLE IF NOT EXISTS public.benefit_enrolment (
  benefit_enrolment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_id uuid NOT NULL REFERENCES public.benefit_catalog(benefit_id),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'active', 'declined', 'ended', 'cancelled')),
  coverage_start date,
  coverage_end date,
  employee_contribution numeric(14,2) NOT NULL DEFAULT 0 CHECK (employee_contribution >= 0),
  employer_contribution numeric(14,2) NOT NULL DEFAULT 0 CHECK (employer_contribution >= 0),
  employee_note text,
  decision_note text,
  approved_by_employee_id uuid REFERENCES public.employee(employee_id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage_end IS NULL OR coverage_start IS NULL OR coverage_end >= coverage_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS benefit_enrolment_one_open_idx
  ON public.benefit_enrolment (benefit_id, employee_id)
  WHERE status IN ('requested', 'active');
CREATE INDEX IF NOT EXISTS benefit_enrolment_employee_status_idx
  ON public.benefit_enrolment (employee_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.employee_dependant (
  employee_dependant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  display_name text NOT NULL,
  relationship text NOT NULL CHECK (relationship IN (
    'spouse', 'child', 'parent', 'other'
  )),
  date_of_birth date,
  nationality text,
  emirates_id_number text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_dependant_id, employee_id)
);

CREATE INDEX IF NOT EXISTS employee_dependant_employee_idx
  ON public.employee_dependant (employee_id, status, display_name);

CREATE TABLE IF NOT EXISTS public.health_policy (
  health_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_id uuid REFERENCES public.benefit_catalog(benefit_id),
  provider_name text NOT NULL,
  policy_number text NOT NULL UNIQUE,
  plan_name text NOT NULL,
  starts_at date NOT NULL,
  ends_at date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'expired', 'cancelled')),
  broker_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at),
  CHECK (jsonb_typeof(broker_contact) = 'object')
);

CREATE INDEX IF NOT EXISTS health_policy_status_dates_idx
  ON public.health_policy (status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.health_policy_member (
  health_policy_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  health_policy_id uuid NOT NULL REFERENCES public.health_policy(health_policy_id),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  employee_dependant_id uuid REFERENCES public.employee_dependant(employee_dependant_id),
  member_number text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'ended', 'rejected')),
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  UNIQUE (health_policy_id, employee_id, employee_dependant_id),
  FOREIGN KEY (employee_dependant_id, employee_id)
    REFERENCES public.employee_dependant(employee_dependant_id, employee_id)
);

CREATE INDEX IF NOT EXISTS health_policy_member_employee_idx
  ON public.health_policy_member (employee_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS health_policy_member_identity_idx
  ON public.health_policy_member (
    health_policy_id,
    employee_id,
    coalesce(employee_dependant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE TABLE IF NOT EXISTS public.health_insurance_card (
  health_insurance_card_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  health_policy_member_id uuid NOT NULL REFERENCES public.health_policy_member(health_policy_member_id),
  card_number text,
  storage_path text NOT NULL,
  issued_at date,
  expires_at date,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'replaced', 'expired', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at >= issued_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS health_insurance_card_one_active_idx
  ON public.health_insurance_card (health_policy_member_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.health_policy_endorsement (
  health_policy_endorsement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  health_policy_id uuid NOT NULL REFERENCES public.health_policy(health_policy_id),
  health_policy_member_id uuid REFERENCES public.health_policy_member(health_policy_member_id),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  request_type text NOT NULL CHECK (request_type IN (
    'add_member', 'remove_member', 'change_member', 'replace_card', 'other'
  )),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'processing', 'completed', 'rejected', 'cancelled')),
  requested_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  handled_by_employee_id uuid REFERENCES public.employee(employee_id),
  decision_note text,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(request_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS health_policy_endorsement_employee_status_idx
  ON public.health_policy_endorsement (employee_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.employee_perk_usage (
  employee_perk_usage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  benefit_id uuid NOT NULL REFERENCES public.benefit_catalog(benefit_id),
  used_at date NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount numeric(14,2) CHECK (amount IS NULL OR amount >= 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$'),
  note text,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled')),
  recorded_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  decided_by_employee_id uuid REFERENCES public.employee(employee_id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_perk_usage_employee_date_idx
  ON public.employee_perk_usage (employee_id, used_at DESC);

DO $$
DECLARE
  app_table text;
  has_anon boolean;
  has_authenticated boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_authenticated;

  FOREACH app_table IN ARRAY ARRAY[
    'benefit_catalog',
    'benefit_eligibility_rule',
    'benefit_enrolment',
    'employee_dependant',
    'health_policy',
    'health_policy_member',
    'health_insurance_card',
    'health_policy_endorsement',
    'employee_perk_usage'
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
  VALUES
    ('benefit', 'manage'),
    ('health_policy', 'manage'),
    ('hr_report', 'view')
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
