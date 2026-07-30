CREATE TABLE IF NOT EXISTS public.agent_runs (
  agent_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent text NOT NULL,
  model text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_aed numeric(12, 4) NOT NULL DEFAULT 0 CHECK (cost_aed >= 0),
  gate_outcome text
    CHECK (gate_outcome IN (
      'authorized', 'denied', 'skipped', 'not_applicable', 'error'
    )),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_agent_created_idx
  ON public.agent_runs (agent, created_at);
CREATE INDEX IF NOT EXISTS agent_runs_created_idx
  ON public.agent_runs (created_at);

-- Lock away from the browser Data API (anon/authenticated); server role only.
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'agent_runs'
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
