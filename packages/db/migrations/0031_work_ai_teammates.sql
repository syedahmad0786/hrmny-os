CREATE TABLE IF NOT EXISTS public.work_ai_teammate (
  work_ai_teammate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  role_description text NOT NULL DEFAULT ''
    CHECK (char_length(role_description) <= 20000),
  instructions text NOT NULL CHECK (length(trim(instructions)) BETWEEN 1 AND 20000),
  allowed_action_types text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (allowed_action_types <@ ARRAY[
      'create_task', 'update_task', 'create_comment', 'create_project'
    ]::text[]),
  model text CHECK (model IS NULL OR char_length(model) <= 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  updated_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_ai_teammate_member (
  work_ai_teammate_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_ai_teammate_id uuid NOT NULL
    REFERENCES public.work_ai_teammate(work_ai_teammate_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('owner', 'editor', 'user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_ai_teammate_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.work_ai_teammate_project_access (
  work_ai_teammate_project_access_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_ai_teammate_id uuid NOT NULL
    REFERENCES public.work_ai_teammate(work_ai_teammate_id) ON DELETE CASCADE,
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('editor', 'commenter', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_ai_teammate_id, work_project_id)
);

CREATE TABLE IF NOT EXISTS public.work_ai_teammate_skill (
  work_ai_teammate_skill_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_ai_teammate_id uuid NOT NULL
    REFERENCES public.work_ai_teammate(work_ai_teammate_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  guidance text NOT NULL CHECK (length(trim(guidance)) BETWEEN 1 AND 20000),
  trigger_condition text NOT NULL DEFAULT ''
    CHECK (char_length(trigger_condition) <= 2000),
  reference_text text NOT NULL DEFAULT '' CHECK (char_length(reference_text) <= 50000),
  is_active boolean NOT NULL DEFAULT true,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_ai_teammate_skill_active_idx
  ON public.work_ai_teammate_skill (work_ai_teammate_id, is_active, created_at);

CREATE TABLE IF NOT EXISTS public.work_ai_teammate_memory (
  work_ai_teammate_memory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_ai_teammate_id uuid NOT NULL
    REFERENCES public.work_ai_teammate(work_ai_teammate_id) ON DELETE CASCADE,
  source_work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  content text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 20000),
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  forgotten_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_ai_teammate_memory_source_idx
  ON public.work_ai_teammate_memory (
    work_ai_teammate_id, source_work_item_id, created_at DESC
  ) WHERE forgotten_at IS NULL;

CREATE TABLE IF NOT EXISTS public.work_ai_teammate_run (
  work_ai_teammate_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_ai_teammate_id uuid NOT NULL
    REFERENCES public.work_ai_teammate(work_ai_teammate_id) ON DELETE CASCADE,
  work_ai_run_id uuid REFERENCES public.work_ai_run(work_ai_run_id) ON DELETE SET NULL,
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES public.work_item(work_item_id) ON DELETE SET NULL,
  triggered_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'manual', 'assignment', 'mention', 'rule', 'follow_up'
  )),
  request_text text NOT NULL CHECK (char_length(request_text) <= 10000),
  selected_skill_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  event_key text NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'answered', 'proposed', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (work_ai_teammate_id, event_key)
);

CREATE INDEX IF NOT EXISTS work_ai_teammate_run_teammate_idx
  ON public.work_ai_teammate_run (work_ai_teammate_id, created_at DESC);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_ai_teammate',
    'work_ai_teammate_member',
    'work_ai_teammate_project_access',
    'work_ai_teammate_skill',
    'work_ai_teammate_memory',
    'work_ai_teammate_run'
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
