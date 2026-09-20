-- Discovery Package E: review candidate store and observation relation.
-- Operator-submitted evidence can create candidates. Collectors stay off.

CREATE TABLE IF NOT EXISTS public.discovery_candidate (
  discovery_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  payload_hash text NOT NULL,
  opportunity_key text NOT NULL,
  company_name text NOT NULL,
  website text,
  sector text,
  market text NOT NULL DEFAULT 'UAE',
  strategic_lane text NOT NULL DEFAULT 'unresolved',
  discovery_channel text NOT NULL,
  opportunity_kind text NOT NULL,
  why_now text NOT NULL,
  relevant_service text,
  missing_facts text,
  known_relationship text,
  source_key text,
  source_item_id text,
  external_opportunity_id text,
  review_state text NOT NULL DEFAULT 'needs_review',
  decision_reason text,
  qualification_state text NOT NULL DEFAULT 'not_assessed',
  expected_version integer NOT NULL DEFAULT 1,
  owner_employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  reviewer_employee_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  research_programme_id uuid REFERENCES public.research_programme(research_programme_id) ON DELETE RESTRICT,
  scheduled_job_id uuid REFERENCES public.scheduled_job(scheduled_job_id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.company(company_id) ON DELETE RESTRICT,
  created_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  decided_by_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_candidate_request_chk CHECK (
    char_length(request_id) >= 8 AND char_length(request_id) <= 180
  ),
  CONSTRAINT discovery_candidate_hash_chk CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT discovery_candidate_lane_chk CHECK (
    strategic_lane IN ('industry_scanning', 'apollo_intent', 'relationship_led', 'unresolved')
  ),
  CONSTRAINT discovery_candidate_channel_chk CHECK (
    discovery_channel IN (
      'publication',
      'hiring',
      'leadership',
      'company_intelligence',
      'intent_import',
      'government',
      'watchlist',
      'submission',
      'focused_research'
    )
  ),
  CONSTRAINT discovery_candidate_kind_chk CHECK (
    opportunity_kind IN (
      'company_signal',
      'hiring',
      'leadership',
      'tender',
      'intent',
      'submission'
    )
  ),
  CONSTRAINT discovery_candidate_state_chk CHECK (
    review_state IN (
      'needs_review',
      'needs_evidence',
      'parked',
      'rejected',
      'accepted',
      'corrected'
    )
  ),
  CONSTRAINT discovery_candidate_qualification_chk CHECK (
    qualification_state = 'not_assessed'
  ),
  CONSTRAINT discovery_candidate_version_chk CHECK (expected_version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS discovery_candidate_request_uniq
  ON public.discovery_candidate (request_id);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_candidate_open_key_uniq
  ON public.discovery_candidate (opportunity_key)
  WHERE review_state IN (
    'needs_review',
    'needs_evidence',
    'parked',
    'corrected',
    'accepted'
  );
CREATE INDEX IF NOT EXISTS discovery_candidate_state_idx
  ON public.discovery_candidate (review_state, updated_at);
CREATE INDEX IF NOT EXISTS discovery_candidate_owner_idx
  ON public.discovery_candidate (owner_employee_id, updated_at);

CREATE TABLE IF NOT EXISTS public.discovery_observation (
  discovery_observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discovery_candidate_id uuid NOT NULL
    REFERENCES public.discovery_candidate(discovery_candidate_id) ON DELETE RESTRICT,
  visibility_scope text NOT NULL DEFAULT 'public',
  source_owner_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  source_url text NOT NULL,
  excerpt text,
  excerpt_hash text NOT NULL,
  published_or_event_date date,
  observed_at timestamptz NOT NULL DEFAULT now(),
  verification_state text NOT NULL DEFAULT 'unverified',
  redaction_state text NOT NULL DEFAULT 'none',
  source_key text,
  source_item_id text,
  content_hash text NOT NULL,
  supersedes_observation_id uuid,
  retention_deadline timestamptz,
  rights_policy_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_observation_visibility_chk CHECK (
    visibility_scope IN ('public', 'restricted', 'private')
  ),
  CONSTRAINT discovery_observation_verification_chk CHECK (
    verification_state IN ('unverified', 'dated', 'needs_evidence', 'corroborated')
  ),
  CONSTRAINT discovery_observation_redaction_chk CHECK (
    redaction_state IN ('none', 'redacted', 'tombstoned')
  ),
  CONSTRAINT discovery_observation_hash_chk CHECK (
    excerpt_hash ~ '^[a-f0-9]{64}$' AND content_hash ~ '^[a-f0-9]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS discovery_observation_candidate_idx
  ON public.discovery_observation (discovery_candidate_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_observation_content_uniq
  ON public.discovery_observation (discovery_candidate_id, content_hash);

DO $$ BEGIN
  ALTER TABLE public.discovery_observation
    ADD CONSTRAINT discovery_observation_supersedes_fk
    FOREIGN KEY (supersedes_observation_id)
    REFERENCES public.discovery_observation(discovery_observation_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.discovery_observation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Discovery observations are immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.discovery_candidate_id IS DISTINCT FROM OLD.discovery_candidate_id
      OR NEW.visibility_scope IS DISTINCT FROM OLD.visibility_scope
      OR NEW.source_owner_employee_id IS DISTINCT FROM OLD.source_owner_employee_id
      OR NEW.source_url IS DISTINCT FROM OLD.source_url
      OR NEW.excerpt_hash IS DISTINCT FROM OLD.excerpt_hash
      OR NEW.published_or_event_date IS DISTINCT FROM OLD.published_or_event_date
      OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
      OR NEW.verification_state IS DISTINCT FROM OLD.verification_state
      OR NEW.source_key IS DISTINCT FROM OLD.source_key
      OR NEW.source_item_id IS DISTINCT FROM OLD.source_item_id
      OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
      OR NEW.supersedes_observation_id IS DISTINCT FROM OLD.supersedes_observation_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Discovery observations are immutable except redaction';
    END IF;
    IF NEW.redaction_state = 'none' AND NEW.excerpt IS DISTINCT FROM OLD.excerpt THEN
      RAISE EXCEPTION 'Discovery observations are immutable except redaction';
    END IF;
    IF NEW.redaction_state IN ('redacted', 'tombstoned') AND NEW.excerpt IS NOT NULL THEN
      NEW.excerpt := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL
  ON FUNCTION public.discovery_observation_guard()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS discovery_observation_guard_trg
  ON public.discovery_observation;

CREATE TRIGGER discovery_observation_guard_trg
BEFORE UPDATE OR DELETE ON public.discovery_observation
FOR EACH ROW
EXECUTE FUNCTION public.discovery_observation_guard();

DO $$
DECLARE app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'discovery_candidate',
    'discovery_observation'
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
      IF app_table = 'discovery_observation' THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role', app_table);
      ELSE
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role', app_table);
      END IF;
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.discovery_candidate IS
  'Server-only Discovery review candidate. Acceptance links one company and never writes BUAF, contacts or deals.';
COMMENT ON TABLE public.discovery_observation IS
  'Direct observation-to-candidate evidence. Private excerpts stay out of logs and browser Data API roles.';
