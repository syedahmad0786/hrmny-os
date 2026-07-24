CREATE TABLE IF NOT EXISTS public.workplace_announcement (
  workplace_announcement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'all',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  requires_acknowledgement boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'published') = (published_at IS NOT NULL) OR status = 'archived')
);

CREATE INDEX IF NOT EXISTS workplace_announcement_status_published_idx
  ON public.workplace_announcement (status, published_at DESC);
CREATE INDEX IF NOT EXISTS workplace_announcement_created_by_idx
  ON public.workplace_announcement (created_by_employee_id);

CREATE TABLE IF NOT EXISTS public.workplace_announcement_acknowledgement (
  workplace_announcement_id uuid NOT NULL
    REFERENCES public.workplace_announcement(workplace_announcement_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workplace_announcement_id, employee_id)
);

CREATE INDEX IF NOT EXISTS workplace_announcement_ack_employee_idx
  ON public.workplace_announcement_acknowledgement (employee_id, acknowledged_at DESC);

CREATE TABLE IF NOT EXISTS public.knowledge_article (
  knowledge_article_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'published') = (published_at IS NOT NULL) OR status = 'archived')
);

CREATE INDEX IF NOT EXISTS knowledge_article_status_category_idx
  ON public.knowledge_article (status, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_article_created_by_idx
  ON public.knowledge_article (created_by_employee_id);

CREATE TABLE IF NOT EXISTS public.knowledge_article_version (
  knowledge_article_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_article_id uuid NOT NULL
    REFERENCES public.knowledge_article(knowledge_article_id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  body text NOT NULL,
  change_note text,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (knowledge_article_id, version_number)
);

CREATE INDEX IF NOT EXISTS knowledge_article_version_creator_idx
  ON public.knowledge_article_version (created_by_employee_id);

CREATE TABLE IF NOT EXISTS public.knowledge_article_acknowledgement (
  knowledge_article_id uuid NOT NULL,
  version_number integer NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (knowledge_article_id, version_number, employee_id),
  FOREIGN KEY (knowledge_article_id, version_number)
    REFERENCES public.knowledge_article_version(knowledge_article_id, version_number)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS knowledge_article_ack_employee_idx
  ON public.knowledge_article_acknowledgement (employee_id, acknowledged_at DESC);

CREATE TABLE IF NOT EXISTS public.workflow_definition (
  workflow_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  trigger_key text NOT NULL DEFAULT 'manual',
  steps jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) > 0)
);

CREATE INDEX IF NOT EXISTS workflow_definition_active_idx
  ON public.workflow_definition (is_active, name);
CREATE INDEX IF NOT EXISTS workflow_definition_creator_idx
  ON public.workflow_definition (created_by_employee_id);

CREATE TABLE IF NOT EXISTS public.workflow_run (
  workflow_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid NOT NULL
    REFERENCES public.workflow_definition(workflow_definition_id),
  subject_employee_id uuid REFERENCES public.employee(employee_id),
  requested_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(context) = 'object'),
  CHECK (completed_at IS NULL OR status IN ('completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS workflow_run_definition_status_idx
  ON public.workflow_run (workflow_definition_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_run_subject_idx
  ON public.workflow_run (subject_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_run_requester_idx
  ON public.workflow_run (requested_by_employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.workflow_run_step (
  workflow_run_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL
    REFERENCES public.workflow_run(workflow_run_id) ON DELETE CASCADE,
  step_order integer NOT NULL CHECK (step_order > 0),
  step_key text NOT NULL,
  title text NOT NULL,
  assignee_role text,
  assignee_employee_id uuid REFERENCES public.employee(employee_id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed')),
  due_at timestamptz,
  completed_by_employee_id uuid REFERENCES public.employee(employee_id),
  completed_at timestamptz,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, step_order),
  UNIQUE (workflow_run_id, step_key),
  CHECK (jsonb_typeof(result) = 'object'),
  CHECK ((status IN ('completed', 'skipped', 'failed')) = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS workflow_run_step_run_status_idx
  ON public.workflow_run_step (workflow_run_id, status, step_order);
CREATE INDEX IF NOT EXISTS workflow_run_step_assignee_idx
  ON public.workflow_run_step (assignee_employee_id, status, due_at);
CREATE INDEX IF NOT EXISTS workflow_run_step_completed_by_idx
  ON public.workflow_run_step (completed_by_employee_id);

CREATE TABLE IF NOT EXISTS public.service_request_type (
  service_request_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'general',
  description text,
  response_sla_hours integer CHECK (response_sla_hours IS NULL OR response_sla_hours > 0),
  form_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(form_schema) = 'object')
);

CREATE INDEX IF NOT EXISTS service_request_type_active_idx
  ON public.service_request_type (is_active, category, name);
CREATE INDEX IF NOT EXISTS service_request_type_creator_idx
  ON public.service_request_type (created_by_employee_id);

ALTER TABLE public.ticket
  ADD COLUMN IF NOT EXISTS service_request_type_id uuid,
  ADD COLUMN IF NOT EXISTS submitted_form jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ticket_service_request_type_fk'
      AND conrelid = 'public.ticket'::regclass
  ) THEN
    ALTER TABLE public.ticket
      ADD CONSTRAINT ticket_service_request_type_fk
      FOREIGN KEY (service_request_type_id)
      REFERENCES public.service_request_type(service_request_type_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ticket_submitted_form_object_check'
      AND conrelid = 'public.ticket'::regclass
  ) THEN
    ALTER TABLE public.ticket
      ADD CONSTRAINT ticket_submitted_form_object_check
      CHECK (jsonb_typeof(submitted_form) = 'object');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ticket_service_request_type_status_idx
  ON public.ticket (service_request_type_id, status, created_at DESC)
  WHERE service_request_type_id IS NOT NULL;

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
    'workplace_announcement',
    'workplace_announcement_acknowledgement',
    'knowledge_article',
    'knowledge_article_version',
    'knowledge_article_acknowledgement',
    'workflow_definition',
    'workflow_run',
    'workflow_run_step',
    'service_request_type'
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

  ALTER TABLE public.ticket ENABLE ROW LEVEL SECURITY;
  REVOKE ALL PRIVILEGES ON TABLE public.ticket FROM PUBLIC;
  IF has_anon THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.ticket FROM anon';
  END IF;
  IF has_authenticated THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.ticket FROM authenticated';
  END IF;
END $$;

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role_id, permission.resource, permission.action, 'allow'
FROM public.role
CROSS JOIN (
  VALUES
    ('workplace_announcement', 'manage'),
    ('knowledge_article', 'manage'),
    ('workflow', 'manage'),
    ('service_request', 'manage')
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
