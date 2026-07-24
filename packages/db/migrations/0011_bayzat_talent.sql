CREATE TABLE IF NOT EXISTS public.job_requisition (
  job_requisition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  department text NOT NULL,
  description text NOT NULL DEFAULT '',
  location text,
  employment_type text NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
  openings integer NOT NULL DEFAULT 1 CHECK (openings > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'paused', 'closed', 'cancelled')),
  requester_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  hiring_manager_employee_id uuid REFERENCES public.employee(employee_id),
  opened_by_employee_id uuid REFERENCES public.employee(employee_id),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_requisition_status_created_idx
  ON public.job_requisition (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.job_candidate (
  job_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_requisition_id uuid NOT NULL REFERENCES public.job_requisition(job_requisition_id),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  source text,
  resume_storage_path text,
  stage text NOT NULL DEFAULT 'applied'
    CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')),
  consent_at timestamptz,
  archived_at timestamptz,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_candidate_requisition_email_uniq
  ON public.job_candidate (job_requisition_id, lower(email));
CREATE INDEX IF NOT EXISTS job_candidate_stage_created_idx
  ON public.job_candidate (stage, created_at DESC);

CREATE TABLE IF NOT EXISTS public.candidate_stage_event (
  candidate_stage_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_candidate_id uuid NOT NULL REFERENCES public.job_candidate(job_candidate_id),
  from_stage text,
  to_stage text NOT NULL,
  actor_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS candidate_stage_event_candidate_created_idx
  ON public.candidate_stage_event (job_candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.candidate_interview (
  candidate_interview_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_candidate_id uuid NOT NULL REFERENCES public.job_candidate(job_candidate_id),
  interviewer_employee_id uuid REFERENCES public.employee(employee_id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location_or_link text,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  feedback jsonb,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS candidate_interview_candidate_start_idx
  ON public.candidate_interview (job_candidate_id, starts_at);

CREATE TABLE IF NOT EXISTS public.candidate_offer (
  candidate_offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_candidate_id uuid NOT NULL REFERENCES public.job_candidate(job_candidate_id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  salary_amount numeric(12,2) NOT NULL CHECK (salary_amount >= 0),
  currency text NOT NULL DEFAULT 'AED',
  start_date date,
  expires_at timestamptz,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn')),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_offer_candidate_version_uniq UNIQUE (job_candidate_id, version)
);

CREATE INDEX IF NOT EXISTS candidate_offer_status_created_idx
  ON public.candidate_offer (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.performance_cycle (
  performance_cycle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'closed')),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS performance_cycle_status_start_idx
  ON public.performance_cycle (status, start_date DESC);

CREATE TABLE IF NOT EXISTS public.performance_goal (
  performance_goal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_cycle_id uuid REFERENCES public.performance_cycle(performance_cycle_id),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  target text,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  weight numeric(5,2) CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100)),
  due_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS performance_goal_employee_status_idx
  ON public.performance_goal (employee_id, status);

CREATE TABLE IF NOT EXISTS public.performance_review (
  performance_review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_cycle_id uuid NOT NULL REFERENCES public.performance_cycle(performance_cycle_id),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  reviewer_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  overall_rating numeric(3,2) CHECK (overall_rating IS NULL OR (overall_rating >= 1 AND overall_rating <= 5)),
  ratings jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  employee_comment text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'acknowledged')),
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_review_cycle_employee_reviewer_uniq
    UNIQUE (performance_cycle_id, employee_id, reviewer_employee_id)
);

CREATE INDEX IF NOT EXISTS performance_review_employee_status_idx
  ON public.performance_review (employee_id, status);

CREATE TABLE IF NOT EXISTS public.employee_survey (
  employee_survey_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_anonymous boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed')),
  opens_at timestamptz,
  closes_at timestamptz,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at)
);

CREATE INDEX IF NOT EXISTS employee_survey_status_created_idx
  ON public.employee_survey (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.employee_survey_response (
  employee_survey_response_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_survey_id uuid NOT NULL REFERENCES public.employee_survey(employee_survey_id),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  answers jsonb NOT NULL,
  rating integer CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_survey_response_employee_uniq UNIQUE (employee_survey_id, employee_id)
);

CREATE INDEX IF NOT EXISTS employee_survey_response_survey_idx
  ON public.employee_survey_response (employee_survey_id);

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
    'job_requisition',
    'job_candidate',
    'candidate_stage_event',
    'candidate_interview',
    'candidate_offer',
    'performance_cycle',
    'performance_goal',
    'performance_review',
    'employee_survey',
    'employee_survey_response'
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

INSERT INTO public.role (key, display_name)
VALUES
  ('hiring', 'Hiring'),
  ('admin', 'Administrator')
ON CONFLICT (key) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role.role_id, permission.resource, permission.action, 'allow'
FROM public.role
CROSS JOIN (
  VALUES
    ('talent', 'manage'),
    ('performance', 'manage'),
    ('survey', 'manage')
) AS permission(resource, action)
WHERE role.key IN ('partner', 'director', 'hr', 'developer', 'hiring', 'admin')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = permission.resource
      AND existing.action = permission.action
      AND existing.effect = 'allow'
  );
