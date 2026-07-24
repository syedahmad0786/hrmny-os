CREATE TABLE IF NOT EXISTS public.work_notification (
  work_notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  actor_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  work_project_id uuid REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'assigned', 'updated', 'completed', 'commented', 'followed', 'due_soon'
  )),
  message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 500),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_notification_recipient_idx
  ON public.work_notification (recipient_employee_id, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.work_saved_search (
  work_saved_search_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_employee_id, name)
);

CREATE TABLE IF NOT EXISTS public.work_recurrence_occurrence (
  work_recurrence_occurrence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  generated_work_item_id uuid NOT NULL UNIQUE
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  scheduled_for date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_work_item_id, scheduled_for)
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
    'work_notification',
    'work_saved_search',
    'work_recurrence_occurrence'
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
