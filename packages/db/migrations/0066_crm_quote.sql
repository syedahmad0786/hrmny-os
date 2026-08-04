CREATE TABLE IF NOT EXISTS public.crm_quote (
  quote_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deal(deal_id),
  version integer NOT NULL,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  quote_value numeric(12,2),
  internal_cost numeric(12,2),
  margin_pct numeric(5,2),
  discount_pct numeric(5,2),
  discount_approval_tier text
    CHECK (discount_approval_tier IN ('am', 'md', 'partner')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_quote_deal_version_uniq UNIQUE (deal_id, version)
);

CREATE INDEX IF NOT EXISTS crm_quote_deal_idx
  ON public.crm_quote (deal_id);

-- Lock away from the browser Data API (anon/authenticated); server role only.
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'crm_quote'
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
