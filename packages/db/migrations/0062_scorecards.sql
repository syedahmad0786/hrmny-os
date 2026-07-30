-- Explainable ratings v1: versioned 0–100 scorecards for leads, deals, clients,
-- campaigns, vendors, and system health. A definition owns the weighted factors;
-- a snapshot is one computed score with a per-factor breakdown (weight, evidence
-- refs, freshness, confidence); an override is a justified human correction.
-- Plan rule: AI never rates employee/person performance — enforced in the
-- scoring service (no entity_kind CHECK here because kinds evolve additively).

CREATE TABLE IF NOT EXISTS public.scorecard_definitions (
  scorecard_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  entity_kind text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  weights jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scorecard_definitions_key_version_unique UNIQUE (key, version)
);

CREATE INDEX IF NOT EXISTS scorecard_definitions_key_active_idx
  ON public.scorecard_definitions (key, active);

CREATE TABLE IF NOT EXISTS public.scorecard_snapshots (
  scorecard_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL,
  definition_key text NOT NULL,
  version integer NOT NULL,
  entity_kind text NOT NULL,
  -- text (not uuid): system_health and campaign entities key off slugs, not uuids.
  entity_id text NOT NULL,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  -- per-factor: { factors: [{ factor, weight, value, contribution, evidence[],
  -- freshness, confidence }], freshness, confidence }.
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scorecard_snapshots_entity_idx
  ON public.scorecard_snapshots (entity_kind, entity_id, created_at);
CREATE INDEX IF NOT EXISTS scorecard_snapshots_definition_idx
  ON public.scorecard_snapshots (definition_id);

CREATE TABLE IF NOT EXISTS public.scorecard_overrides (
  scorecard_override_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL,
  actor text NOT NULL,
  -- Justification is mandatory: an override with no reason is rejected in the
  -- service AND cannot be stored blank here.
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  new_score integer NOT NULL CHECK (new_score >= 0 AND new_score <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scorecard_overrides_snapshot_idx
  ON public.scorecard_overrides (snapshot_id, created_at);

-- Lock away from the browser Data API (anon/authenticated); server role only.
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'scorecard_definitions',
    'scorecard_snapshots',
    'scorecard_overrides'
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
