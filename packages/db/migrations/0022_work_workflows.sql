CREATE TABLE IF NOT EXISTS public.work_form (
  work_form_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_section_id uuid REFERENCES public.work_section(work_section_id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  title_question_key text NOT NULL DEFAULT 'title',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_assignee_employee_id uuid
    REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  confirmation_message text NOT NULL DEFAULT 'Your request was submitted.',
  is_active boolean NOT NULL DEFAULT true,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_project_id, name)
);

CREATE TABLE IF NOT EXISTS public.work_form_submission (
  work_form_submission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_form_id uuid NOT NULL
    REFERENCES public.work_form(work_form_id) ON DELETE CASCADE,
  submitted_by_employee_id uuid
    REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  answers jsonb NOT NULL,
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_rule (
  work_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'task_added', 'task_completed', 'task_moved', 'priority_changed',
    'due_date_set', 'approval_decided'
  )),
  branches jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_enabled boolean NOT NULL DEFAULT true,
  owner_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_project_id, name)
);

CREATE TABLE IF NOT EXISTS public.work_rule_run (
  work_rule_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_rule_id uuid NOT NULL
    REFERENCES public.work_rule(work_rule_id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES public.work_item(work_item_id) ON DELETE SET NULL,
  trigger_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'skipped', 'failed')),
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_rule_run_rule_created_idx
  ON public.work_rule_run (work_rule_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.work_template (
  work_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  template_type text NOT NULL CHECK (template_type IN ('task', 'project')),
  blueprint jsonb NOT NULL,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_template_project_type_idx
  ON public.work_template (work_project_id, template_type)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.work_bundle (
  work_bundle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'organization'
    CHECK (visibility IN ('organization', 'limited')),
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_bundle_version (
  work_bundle_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_bundle_id uuid NOT NULL
    REFERENCES public.work_bundle(work_bundle_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  blueprint jsonb NOT NULL,
  published_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_bundle_id, version)
);

CREATE TABLE IF NOT EXISTS public.work_project_bundle (
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_bundle_id uuid NOT NULL,
  applied_version integer NOT NULL CHECK (applied_version > 0),
  applied_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_project_id, work_bundle_id),
  FOREIGN KEY (work_bundle_id, applied_version)
    REFERENCES public.work_bundle_version(work_bundle_id, version)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.work_approval_decision (
  work_approval_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN (
    'approved', 'changes_requested', 'rejected'
  )),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 10000),
  decided_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id),
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_approval_item_decided_idx
  ON public.work_approval_decision (work_item_id, decided_at DESC);

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
    'work_form', 'work_form_submission', 'work_rule', 'work_rule_run',
    'work_template', 'work_bundle', 'work_bundle_version',
    'work_project_bundle', 'work_approval_decision'
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
