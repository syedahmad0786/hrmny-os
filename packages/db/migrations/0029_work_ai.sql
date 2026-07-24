CREATE TABLE IF NOT EXISTS public.work_ai_policy (
  policy_key text PRIMARY KEY DEFAULT 'default' CHECK (policy_key = 'default'),
  model text,
  monthly_token_limit integer NOT NULL DEFAULT 1000000
    CHECK (monthly_token_limit BETWEEN 1000 AND 1000000000),
  daily_user_request_limit integer NOT NULL DEFAULT 100
    CHECK (daily_user_request_limit BETWEEN 1 AND 10000),
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365),
  require_human_approval boolean NOT NULL DEFAULT true
    CHECK (require_human_approval),
  updated_by_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.work_ai_policy (policy_key) VALUES ('default')
ON CONFLICT (policy_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.work_ai_run (
  work_ai_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'smart_chat', 'smart_summaries', 'smart_status', 'smart_fields',
    'smart_editor', 'smart_goals', 'smart_projects', 'smart_rules',
    'risk_reports', 'dash'
  )),
  status text NOT NULL DEFAULT 'running' CHECK (status IN (
    'running', 'answered', 'proposed', 'partially_applied', 'applied',
    'rejected', 'failed'
  )),
  request_text text NOT NULL CHECK (char_length(request_text) <= 10000),
  project_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  item_id uuid,
  context_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  provider text,
  model text,
  provider_request_id text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  error_message text,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  approved_by_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_ai_run_owner_idx
  ON public.work_ai_run (created_by_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_ai_run_expiry_idx
  ON public.work_ai_run (expires_at);

CREATE TABLE IF NOT EXISTS public.work_ai_action_execution (
  work_ai_action_execution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_ai_run_id uuid NOT NULL REFERENCES public.work_ai_run(work_ai_run_id)
    ON DELETE CASCADE,
  action_index integer NOT NULL CHECK (action_index >= 0),
  status text NOT NULL DEFAULT 'applying'
    CHECK (status IN ('applying', 'applied', 'failed')),
  result jsonb,
  error_message text,
  approved_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_ai_run_id, action_index)
);

CREATE INDEX IF NOT EXISTS work_ai_action_run_idx
  ON public.work_ai_action_execution (work_ai_run_id, action_index);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_ai_policy',
    'work_ai_run',
    'work_ai_action_execution'
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
