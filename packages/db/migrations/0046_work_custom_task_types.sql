CREATE TABLE IF NOT EXISTS public.work_custom_task_type (
  work_custom_task_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_work_project_id uuid
    REFERENCES public.work_project(work_project_id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  icon text NOT NULL DEFAULT '◆' CHECK (length(icon) BETWEEN 1 AND 16),
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  source_platform text NOT NULL DEFAULT 'native',
  external_id text,
  source_workspace_external_id text,
  source_connection_external_id text,
  source_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_custom_task_type_source_uniq
  ON public.work_custom_task_type (
    source_platform, source_connection_external_id, external_id
  ) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_custom_task_status_option (
  work_custom_task_status_option_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_custom_task_type_id uuid NOT NULL
    REFERENCES public.work_custom_task_type(work_custom_task_type_id)
    ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  color text NOT NULL DEFAULT '#6B7280'
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  completion_state text NOT NULL
    CHECK (completion_state IN ('incomplete', 'complete')),
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  source_platform text NOT NULL DEFAULT 'native',
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_custom_task_type_id, work_custom_task_status_option_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_custom_task_status_source_uniq
  ON public.work_custom_task_status_option (
    source_platform, external_id
  ) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_custom_task_status_name_uniq
  ON public.work_custom_task_status_option (
    work_custom_task_type_id, lower(name)
  );

CREATE TABLE IF NOT EXISTS public.work_project_custom_task_type (
  work_project_custom_task_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_custom_task_type_id uuid NOT NULL
    REFERENCES public.work_custom_task_type(work_custom_task_type_id)
    ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  source_platform text NOT NULL DEFAULT 'native',
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_project_id, work_custom_task_type_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_project_custom_task_type_default_uniq
  ON public.work_project_custom_task_type (work_project_id)
  WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS work_project_custom_task_type_source_uniq
  ON public.work_project_custom_task_type (source_platform, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.work_item
  ADD COLUMN IF NOT EXISTS work_custom_task_type_id uuid,
  ADD COLUMN IF NOT EXISTS work_custom_task_status_option_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.work_item'::regclass
      AND conname = 'work_item_custom_task_status_fk'
  ) THEN
    ALTER TABLE public.work_item
      ADD CONSTRAINT work_item_custom_task_status_fk
      FOREIGN KEY (
        work_custom_task_type_id, work_custom_task_status_option_id
      ) REFERENCES public.work_custom_task_status_option (
        work_custom_task_type_id, work_custom_task_status_option_id
      ) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.work_item'::regclass
      AND conname = 'work_item_custom_task_pair_check'
  ) THEN
    ALTER TABLE public.work_item
      ADD CONSTRAINT work_item_custom_task_pair_check CHECK (
        (work_custom_task_type_id IS NULL AND work_custom_task_status_option_id IS NULL)
        OR (
          item_type = 'task'
          AND work_custom_task_type_id IS NOT NULL
          AND work_custom_task_status_option_id IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_default_custom_task_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.work_item item
  SET work_custom_task_type_id = selected.work_custom_task_type_id,
      work_custom_task_status_option_id = selected.status_id,
      updated_at = now()
  FROM (
    SELECT association.work_custom_task_type_id,
      status.work_custom_task_status_option_id AS status_id
    FROM public.work_project_custom_task_type association
    JOIN public.work_custom_task_status_option status
      ON status.work_custom_task_type_id = association.work_custom_task_type_id
      AND status.enabled
      AND status.completion_state = 'incomplete'
    WHERE association.work_project_id = NEW.work_project_id
      AND association.is_default
    ORDER BY status.position, status.created_at
    LIMIT 1
  ) selected
  WHERE item.work_item_id = NEW.work_item_id
    AND item.item_type = 'task'
    AND item.work_custom_task_type_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_project_item_apply_default_custom_task_type
  ON public.work_project_item;
CREATE TRIGGER work_project_item_apply_default_custom_task_type
AFTER INSERT ON public.work_project_item
FOR EACH ROW EXECUTE FUNCTION public.apply_default_custom_task_type();

CREATE OR REPLACE FUNCTION public.sync_custom_task_status_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_state text;
  desired_state text;
  selected_status uuid;
BEGIN
  IF NEW.work_custom_task_type_id IS NULL
    OR OLD.completed_at IS NOT DISTINCT FROM NEW.completed_at THEN
    RETURN NEW;
  END IF;
  desired_state := CASE
    WHEN NEW.completed_at IS NULL THEN 'incomplete' ELSE 'complete'
  END;
  SELECT completion_state INTO current_state
  FROM public.work_custom_task_status_option
  WHERE work_custom_task_status_option_id = NEW.work_custom_task_status_option_id;
  IF current_state IS DISTINCT FROM desired_state THEN
    SELECT work_custom_task_status_option_id
    INTO selected_status
    FROM public.work_custom_task_status_option
    WHERE work_custom_task_type_id = NEW.work_custom_task_type_id
      AND enabled AND completion_state = desired_state
    ORDER BY position, created_at
    LIMIT 1;
    IF selected_status IS NOT NULL THEN
      NEW.work_custom_task_status_option_id := selected_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_item_sync_custom_task_status_completion
  ON public.work_item;
CREATE TRIGGER work_item_sync_custom_task_status_completion
BEFORE UPDATE OF completed_at ON public.work_item
FOR EACH ROW EXECUTE FUNCTION public.sync_custom_task_status_completion();

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_custom_task_type',
    'work_custom_task_status_option',
    'work_project_custom_task_type',
    'work_item'
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
