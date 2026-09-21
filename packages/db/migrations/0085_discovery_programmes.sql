-- Discovery Package A: versioned programme configuration and stable source bindings.
-- Publishing records configuration only. It creates no jobs or provider calls.

CREATE TABLE IF NOT EXISTS public.research_programme (
  research_programme_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  reviewer_employee_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  state text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  current_draft_version integer NOT NULL DEFAULT 1,
  published_version integer,
  schedule_generation integer NOT NULL DEFAULT 0,
  published_by_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  published_at timestamptz,
  paused_by_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  paused_at timestamptz,
  pause_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_programme_state_chk CHECK (state IN ('draft', 'active', 'paused', 'archived')),
  CONSTRAINT research_programme_version_chk CHECK (
    version >= 1 AND current_draft_version >= 1 AND schedule_generation >= 0
    AND (published_version IS NULL OR (published_version >= 1 AND published_version <= current_draft_version))
  )
);

CREATE INDEX IF NOT EXISTS research_programme_owner_idx
  ON public.research_programme (owner_employee_id, updated_at);
CREATE INDEX IF NOT EXISTS research_programme_state_idx
  ON public.research_programme (state, updated_at);

CREATE TABLE IF NOT EXISTS public.research_programme_version (
  research_programme_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_programme_id uuid NOT NULL REFERENCES public.research_programme(research_programme_id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number >= 1),
  configuration jsonb NOT NULL,
  config_hash text NOT NULL CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_programme_version_uniq UNIQUE (research_programme_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.research_programme_source_binding (
  research_programme_source_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_programme_id uuid NOT NULL REFERENCES public.research_programme(research_programme_id) ON DELETE RESTRICT,
  source_key text NOT NULL,
  family text NOT NULL,
  adapter text NOT NULL,
  adapter_version text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_reference_id uuid REFERENCES public.connection_account(connection_account_id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT false,
  required boolean NOT NULL DEFAULT false,
  capability_state text NOT NULL DEFAULT 'unverified'
    CHECK (capability_state IN ('candidate', 'unverified', 'blocked', 'manual', 'verified')),
  connection_state text NOT NULL DEFAULT 'unverified'
    CHECK (connection_state IN ('not_required', 'unverified', 'needs_connection', 'connected', 'error')),
  credential_generation integer NOT NULL DEFAULT 0 CHECK (credential_generation >= 0),
  capability_test_receipt_id uuid REFERENCES public.integration_inbox(integration_inbox_id) ON DELETE RESTRICT,
  capability_tested_at timestamptz,
  checkpoint_version integer NOT NULL DEFAULT 0 CHECK (checkpoint_version >= 0),
  cursor jsonb,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_programme_source_uniq UNIQUE (research_programme_id, source_key)
);

CREATE INDEX IF NOT EXISTS research_programme_source_attention_idx
  ON public.research_programme_source_binding (capability_state, connection_state, updated_at);

CREATE OR REPLACE FUNCTION public.research_programme_source_connection_removed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.account_reference_id IS NOT NULL AND NEW.account_reference_id IS NULL THEN
    NEW.capability_state := 'unverified';
    NEW.connection_state := 'needs_connection';
    NEW.credential_generation := OLD.credential_generation + 1;
    NEW.capability_test_receipt_id := NULL;
    NEW.capability_tested_at := NULL;
    NEW.checkpoint_version := OLD.checkpoint_version + 1;
    NEW.cursor := NULL;
    NEW.last_attempt_at := NULL;
    NEW.last_success_at := NULL;
    NEW.last_error := 'Connection disconnected';
    NEW.coverage := '{}'::jsonb;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL
  ON FUNCTION public.research_programme_source_connection_removed()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS research_programme_source_connection_removed_trg
  ON public.research_programme_source_binding;

CREATE TRIGGER research_programme_source_connection_removed_trg
BEFORE UPDATE OF account_reference_id
ON public.research_programme_source_binding
FOR EACH ROW
EXECUTE FUNCTION public.research_programme_source_connection_removed();

CREATE OR REPLACE FUNCTION public.research_programme_version_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Discovery programme versions are immutable';
END;
$$;

REVOKE ALL
  ON FUNCTION public.research_programme_version_immutable()
  FROM PUBLIC;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'research_programme_version_immutable_trg'
      AND tgrelid = 'public.research_programme_version'::regclass
  ) THEN
    CREATE TRIGGER research_programme_version_immutable_trg
    BEFORE UPDATE OR DELETE ON public.research_programme_version
    FOR EACH ROW EXECUTE FUNCTION public.research_programme_version_immutable();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'research_programme_version_no_truncate_trg'
      AND tgrelid = 'public.research_programme_version'::regclass
  ) THEN
    CREATE TRIGGER research_programme_version_no_truncate_trg
    BEFORE TRUNCATE ON public.research_programme_version
    FOR EACH STATEMENT EXECUTE FUNCTION public.research_programme_version_immutable();
  END IF;
END $$;

DO $$
DECLARE app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'research_programme',
    'research_programme_version',
    'research_programme_source_binding'
  ]::text[] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', app_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM service_role', app_table);
      IF app_table = 'research_programme_version' THEN
        EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO service_role', app_table);
      ELSE
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role', app_table);
      END IF;
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.research_programme IS
  'Server-only Discovery programme identity and optimistic lifecycle state.';
COMMENT ON TABLE public.research_programme_version IS
  'Append-only validated programme and source configuration snapshots.';
COMMENT ON TABLE public.research_programme_source_binding IS
  'Stable source identity and operational health; draft saves cannot replace cursor/checkpoint state.';
