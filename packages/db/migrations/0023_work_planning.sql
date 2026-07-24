ALTER TABLE public.work_item
  ADD COLUMN IF NOT EXISTS estimated_minutes integer
    CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 1000000);

ALTER TABLE public.work_project
  ADD COLUMN IF NOT EXISTS budget_amount numeric(16,2)
    CHECK (budget_amount IS NULL OR budget_amount >= 0),
  ADD COLUMN IF NOT EXISTS budget_currency text NOT NULL DEFAULT 'AED'
    CHECK (budget_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS hourly_cost_rate numeric(12,2)
    CHECK (hourly_cost_rate IS NULL OR hourly_cost_rate >= 0);

ALTER TABLE public.time_entry
  ADD COLUMN IF NOT EXISTS work_item_id uuid
    REFERENCES public.work_item(work_item_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS time_entry_item_date_idx
  ON public.time_entry (work_item_id, work_date DESC)
  WHERE work_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_goal (
  work_goal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_work_goal_id uuid REFERENCES public.work_goal(work_goal_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 300),
  description text NOT NULL DEFAULT '',
  scope text NOT NULL DEFAULT 'company'
    CHECK (scope IN ('company', 'team', 'individual')),
  owner_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'on_track'
    CHECK (status IN ('on_track', 'at_risk', 'off_track', 'achieved', 'dropped')),
  progress numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  start_date date,
  due_date date,
  privacy text NOT NULL DEFAULT 'organization'
    CHECK (privacy IN ('organization', 'private')),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.work_goal_link (
  work_goal_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_goal_id uuid NOT NULL REFERENCES public.work_goal(work_goal_id) ON DELETE CASCADE,
  work_project_id uuid REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  weight numeric(8,4) NOT NULL DEFAULT 1 CHECK (weight > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(work_project_id, work_item_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_goal_project_link_uniq
  ON public.work_goal_link (work_goal_id, work_project_id)
  WHERE work_project_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS work_goal_item_link_uniq
  ON public.work_goal_link (work_goal_id, work_item_id)
  WHERE work_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_portfolio (
  work_portfolio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#C7702E' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  privacy text NOT NULL DEFAULT 'organization'
    CHECK (privacy IN ('organization', 'private')),
  owner_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.work_portfolio_project (
  work_portfolio_id uuid NOT NULL
    REFERENCES public.work_portfolio(work_portfolio_id) ON DELETE CASCADE,
  work_project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_portfolio_id, work_project_id)
);

CREATE TABLE IF NOT EXISTS public.work_status_update (
  work_status_update_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_portfolio_id uuid REFERENCES public.work_portfolio(work_portfolio_id) ON DELETE CASCADE,
  work_goal_id uuid REFERENCES public.work_goal(work_goal_id) ON DELETE CASCADE,
  health text NOT NULL CHECK (health IN ('on_track', 'at_risk', 'off_track', 'complete')),
  progress numeric(5,2) CHECK (progress IS NULL OR progress BETWEEN 0 AND 100),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 50000),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(work_project_id, work_portfolio_id, work_goal_id) = 1)
);

CREATE INDEX IF NOT EXISTS work_status_project_created_idx
  ON public.work_status_update (work_project_id, created_at DESC)
  WHERE work_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_status_portfolio_created_idx
  ON public.work_status_update (work_portfolio_id, created_at DESC)
  WHERE work_portfolio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_status_goal_created_idx
  ON public.work_status_update (work_goal_id, created_at DESC)
  WHERE work_goal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_capacity_allocation (
  work_capacity_allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  work_project_id uuid NOT NULL REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  week_start date NOT NULL,
  allocated_minutes integer NOT NULL CHECK (allocated_minutes BETWEEN 0 AND 10080),
  role_name text,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extract(isodow from week_start) = 1),
  UNIQUE (employee_id, work_project_id, week_start)
);

CREATE TABLE IF NOT EXISTS public.work_timer (
  work_timer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  work_project_id uuid NOT NULL REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES public.work_item(work_item_id) ON DELETE SET NULL,
  description text,
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_timer_employee_active_uniq
  ON public.work_timer (employee_id) WHERE stopped_at IS NULL;

CREATE TABLE IF NOT EXISTS public.work_reporting_dashboard (
  work_reporting_dashboard_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_employee_id, name)
);

CREATE TABLE IF NOT EXISTS public.work_item_baseline (
  work_item_baseline_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid NOT NULL REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  baseline_start_date date,
  baseline_due_at timestamptz,
  captured_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_project_id, work_item_id)
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
    'work_goal', 'work_goal_link', 'work_portfolio',
    'work_portfolio_project', 'work_status_update',
    'work_capacity_allocation', 'work_timer',
    'work_reporting_dashboard', 'work_item_baseline'
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
