ALTER TABLE public.role
  ADD COLUMN IF NOT EXISTS legacy_titles jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_legacy_titles_array_check'
      AND conrelid = 'public.role'::regclass
  ) THEN
    ALTER TABLE public.role
      ADD CONSTRAINT role_legacy_titles_array_check
      CHECK (jsonb_typeof(legacy_titles) = 'array');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS asset_version_asset_number_uniq
  ON public.asset_version (asset_id, version_number);

CREATE UNIQUE INDEX IF NOT EXISTS convention_rule_version_uniq
  ON public.convention (rule_key, version);

CREATE OR REPLACE FUNCTION public.prevent_immutable_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS audit_event_immutable ON public.audit_event;
CREATE TRIGGER audit_event_immutable
  BEFORE UPDATE OR DELETE ON public.audit_event
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_row_mutation();

DROP TRIGGER IF EXISTS asset_version_immutable ON public.asset_version;
CREATE TRIGGER asset_version_immutable
  BEFORE UPDATE OR DELETE ON public.asset_version
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_row_mutation();

CREATE TABLE IF NOT EXISTS public.scheduled_job (
  scheduled_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  run_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_job_due_idx
  ON public.scheduled_job (status, run_at);

ALTER TABLE public.scheduled_job ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.scheduled_job FROM PUBLIC, anon, authenticated;
