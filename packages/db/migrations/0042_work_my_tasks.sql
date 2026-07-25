CREATE TABLE IF NOT EXISTS public.work_my_tasks_section (
  work_my_tasks_section_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_my_tasks_section_id, employee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_my_tasks_section_employee_name_uniq
  ON public.work_my_tasks_section (employee_id, lower(name));
CREATE INDEX IF NOT EXISTS work_my_tasks_section_employee_order_idx
  ON public.work_my_tasks_section (employee_id, position, created_at);

CREATE TABLE IF NOT EXISTS public.work_my_tasks_membership (
  work_my_tasks_membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  work_my_tasks_section_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_item_id),
  FOREIGN KEY (work_my_tasks_section_id, employee_id)
    REFERENCES public.work_my_tasks_section (
      work_my_tasks_section_id, employee_id
    ) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS work_my_tasks_membership_section_order_idx
  ON public.work_my_tasks_membership (
    employee_id, work_my_tasks_section_id, position
  );

CREATE OR REPLACE FUNCTION public.clear_work_my_tasks_membership_on_reassign()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.assignee_employee_id IS DISTINCT FROM NEW.assignee_employee_id THEN
    DELETE FROM public.work_my_tasks_membership
    WHERE work_item_id = NEW.work_item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_item_clear_my_tasks_membership
  ON public.work_item;
CREATE TRIGGER work_item_clear_my_tasks_membership
AFTER UPDATE OF assignee_employee_id ON public.work_item
FOR EACH ROW EXECUTE FUNCTION public.clear_work_my_tasks_membership_on_reassign();

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_my_tasks_section', 'work_my_tasks_membership'
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
