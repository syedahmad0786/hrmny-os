ALTER TABLE public.work_ai_run
  DROP CONSTRAINT IF EXISTS work_ai_run_kind_check;
ALTER TABLE public.work_ai_run
  ADD CONSTRAINT work_ai_run_kind_check CHECK (kind IN (
    'smart_chat', 'smart_summaries', 'smart_status', 'smart_fields',
    'smart_editor', 'smart_goals', 'smart_projects', 'smart_rules',
    'risk_reports', 'dash', 'studio', 'teammate'
  ));

CREATE TABLE IF NOT EXISTS public.work_ai_studio_workflow (
  work_ai_studio_workflow_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'manual', 'task_added', 'task_completed', 'task_moved',
    'priority_changed', 'due_date_set', 'approval_decided', 'scheduled'
  )),
  ai_condition text CHECK (ai_condition IS NULL OR char_length(ai_condition) <= 10000),
  instructions text NOT NULL CHECK (length(trim(instructions)) BETWEEN 1 AND 20000),
  reference_text text NOT NULL DEFAULT '' CHECK (char_length(reference_text) <= 50000),
  allowed_action_types text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (allowed_action_types <@ ARRAY[
      'create_task', 'update_task', 'create_comment', 'create_status',
      'create_goal', 'create_custom_field', 'create_rule', 'create_project'
    ]::text[]),
  model text CHECK (model IS NULL OR char_length(model) <= 200),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'paused')),
  schedule_minutes integer
    CHECK (schedule_minutes IS NULL OR schedule_minutes BETWEEN 5 AND 10080),
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  updated_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (trigger_type = 'scheduled' AND schedule_minutes IS NOT NULL)
    OR (trigger_type <> 'scheduled' AND schedule_minutes IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS work_ai_studio_workflow_project_idx
  ON public.work_ai_studio_workflow (work_project_id, status, trigger_type)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.work_ai_studio_run (
  work_ai_studio_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_ai_studio_workflow_id uuid NOT NULL
    REFERENCES public.work_ai_studio_workflow(work_ai_studio_workflow_id)
    ON DELETE CASCADE,
  work_ai_run_id uuid REFERENCES public.work_ai_run(work_ai_run_id)
    ON DELETE SET NULL,
  trigger_item_id uuid REFERENCES public.work_item(work_item_id) ON DELETE SET NULL,
  triggered_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  event_key text NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'answered', 'proposed', 'skipped', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (work_ai_studio_workflow_id, event_key)
);

CREATE INDEX IF NOT EXISTS work_ai_studio_run_workflow_idx
  ON public.work_ai_studio_run (work_ai_studio_workflow_id, created_at DESC);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_ai_studio_workflow',
    'work_ai_studio_run'
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
