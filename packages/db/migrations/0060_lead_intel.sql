-- M8 intelligence graph v1 (Postgres + pgvector, no graph DB at 25-staff scale).
-- Slot 0060 carries three lead_intel tables: the who-knows-whom edge list, the
-- win/loss memory notes (embedding-ready text for the existing pgvector store),
-- and the competitor-scan findings (competitor-research job, added within 0060).

CREATE TABLE IF NOT EXISTS public.contact_edges (
  contact_edge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_contact uuid NOT NULL,
  to_contact uuid NOT NULL,
  relation text NOT NULL,
  weight numeric(5, 4) NOT NULL DEFAULT 0.5 CHECK (weight >= 0 AND weight <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_edges_not_self CHECK (from_contact <> to_contact)
);

CREATE INDEX IF NOT EXISTS contact_edges_from_idx
  ON public.contact_edges (from_contact);
CREATE INDEX IF NOT EXISTS contact_edges_to_idx
  ON public.contact_edges (to_contact);

CREATE TABLE IF NOT EXISTS public.win_loss_notes (
  win_loss_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('won', 'lost', 'postponed_on_hold')),
  -- Embedding-ready free text; the weekly self-evolution job embeds this into
  -- the existing pgvector memory for context injection (not instruction rewrite).
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS win_loss_notes_deal_idx
  ON public.win_loss_notes (deal_id);
CREATE INDEX IF NOT EXISTS win_loss_notes_outcome_idx
  ON public.win_loss_notes (outcome, created_at);

CREATE TABLE IF NOT EXISTS public.competitor_findings (
  competitor_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor text NOT NULL,
  source text NOT NULL
    CHECK (source IN ('site', 'social', 'ads_library', 'other')),
  headline text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  url text,
  -- Deal / client the scan was scoped to (weekly digest per active pitch).
  scope_id text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competitor_findings_competitor_idx
  ON public.competitor_findings (competitor, captured_at);
CREATE INDEX IF NOT EXISTS competitor_findings_scope_idx
  ON public.competitor_findings (scope_id);

-- Lock away from the browser Data API (anon/authenticated); server role only.
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'contact_edges',
    'win_loss_notes',
    'competitor_findings'
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
