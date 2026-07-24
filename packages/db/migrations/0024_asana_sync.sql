ALTER TABLE public.work_migration_run
  DROP CONSTRAINT IF EXISTS work_migration_run_mode_check;

ALTER TABLE public.work_migration_run
  ADD CONSTRAINT work_migration_run_mode_check
  CHECK (mode IN ('dry_run', 'import', 'sync'));

CREATE TABLE IF NOT EXISTS public.asana_sync_state (
  workspace_external_id text PRIMARY KEY,
  workspace_name text NOT NULL,
  connected_account_id text NOT NULL,
  sync_token text,
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'error')),
  last_event_count integer NOT NULL DEFAULT 0 CHECK (last_event_count >= 0),
  total_event_count bigint NOT NULL DEFAULT 0 CHECK (total_event_count >= 0),
  last_event_at timestamptz,
  last_synced_at timestamptz,
  last_reconciled_at timestamptz,
  last_error text,
  requested_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asana_sync_state_status_idx
  ON public.asana_sync_state (status, last_synced_at);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY['asana_sync_state']::text[] LOOP
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
