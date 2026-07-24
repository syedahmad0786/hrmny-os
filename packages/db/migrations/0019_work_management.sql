CREATE TABLE IF NOT EXISTS public.work_project (
  work_project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#C7702E' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  privacy text NOT NULL DEFAULT 'organization'
    CHECK (privacy IN ('organization', 'private')),
  client_id uuid REFERENCES public.client(client_id) ON DELETE SET NULL,
  owner_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  source_platform text NOT NULL DEFAULT 'native'
    CHECK (source_platform IN ('native', 'asana')),
  external_id text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_project_source_external_uniq
  ON public.work_project (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_project_owner_idx
  ON public.work_project (owner_employee_id, archived_at);

CREATE TABLE IF NOT EXISTS public.work_project_member (
  work_project_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  access_level text NOT NULL DEFAULT 'editor'
    CHECK (access_level IN ('admin', 'editor', 'commenter', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_project_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.work_section (
  work_section_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  position integer NOT NULL DEFAULT 0,
  source_platform text NOT NULL DEFAULT 'native'
    CHECK (source_platform IN ('native', 'asana')),
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_project_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_section_source_external_uniq
  ON public.work_section (source_platform, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_item (
  work_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_work_item_id uuid
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  description text NOT NULL DEFAULT '',
  item_type text NOT NULL DEFAULT 'task'
    CHECK (item_type IN ('task', 'milestone', 'approval')),
  priority text CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  start_date date,
  due_at timestamptz,
  completed_at timestamptz,
  recurrence jsonb,
  source_platform text NOT NULL DEFAULT 'native'
    CHECK (source_platform IN ('native', 'asana')),
  external_id text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR due_at IS NULL OR start_date <= due_at::date)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_item_source_external_uniq
  ON public.work_item (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_item_assignee_due_idx
  ON public.work_item (assignee_employee_id, due_at)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS work_item_parent_idx
  ON public.work_item (parent_work_item_id);

CREATE TABLE IF NOT EXISTS public.work_project_item (
  work_project_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  work_section_id uuid REFERENCES public.work_section(work_section_id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_project_id, work_item_id)
);

CREATE INDEX IF NOT EXISTS work_project_item_order_idx
  ON public.work_project_item (work_project_id, work_section_id, position);

CREATE TABLE IF NOT EXISTS public.work_item_dependency (
  work_item_dependency_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  depends_on_work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, depends_on_work_item_id),
  CHECK (work_item_id <> depends_on_work_item_id)
);

CREATE TABLE IF NOT EXISTS public.work_comment (
  work_comment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  author_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_comment_item_created_idx
  ON public.work_comment (work_item_id, created_at);

CREATE TABLE IF NOT EXISTS public.work_item_follower (
  work_item_follower_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.work_tag (
  work_tag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 80),
  color text NOT NULL DEFAULT '#6B7280' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_item_tag (
  work_item_tag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  work_tag_id uuid NOT NULL
    REFERENCES public.work_tag(work_tag_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, work_tag_id)
);

CREATE TABLE IF NOT EXISTS public.work_custom_field (
  work_custom_field_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  field_type text NOT NULL
    CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'single_select', 'multi_select', 'people')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_required boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_custom_field_value (
  work_custom_field_value_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  work_custom_field_id uuid NOT NULL
    REFERENCES public.work_custom_field(work_custom_field_id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, work_custom_field_id)
);

CREATE TABLE IF NOT EXISTS public.work_attachment (
  work_attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 255),
  storage_path text,
  external_url text,
  content_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  uploaded_by_employee_id uuid
    REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  source_platform text NOT NULL DEFAULT 'native'
    CHECK (source_platform IN ('native', 'asana', 'external')),
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((storage_path IS NOT NULL) <> (external_url IS NOT NULL))
);

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
    'work_project',
    'work_project_member',
    'work_section',
    'work_item',
    'work_project_item',
    'work_item_dependency',
    'work_comment',
    'work_item_follower',
    'work_tag',
    'work_item_tag',
    'work_custom_field',
    'work_custom_field_value',
    'work_attachment'
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
SELECT role_id, 'work', '*', 'allow'
FROM public.role
WHERE role.key IN (
  'partner', 'director', 'am', 'traffic', 'creative_director',
  'creative', 'developer', 'hr', 'finance', 'staff'
)
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = 'work'
      AND existing.action = '*'
      AND existing.effect = 'allow'
  );
