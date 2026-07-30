CREATE TABLE IF NOT EXISTS public.outreach_items (
  outreach_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid,
  channel text NOT NULL DEFAULT 'gmail',
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'approved', 'sent', 'discarded')),
  recipient text NOT NULL DEFAULT '',
  subject text,
  body text NOT NULL DEFAULT '',
  approved_by uuid,
  sent_at timestamptz,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_items_deal_idx
  ON public.outreach_items (deal_id, state);
CREATE INDEX IF NOT EXISTS outreach_items_state_idx
  ON public.outreach_items (state, created_at);

-- Lock away from the browser Data API (anon/authenticated); server role only.
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'outreach_items'
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
