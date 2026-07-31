-- Expand invoice for ops fields currently carried only in demo-store,
-- and add durable invoice_proposal for HITL intake.

ALTER TABLE public.invoice
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS billing_kind text
    CHECK (billing_kind IS NULL OR billing_kind IN ('intake', 'retainer', 'progress', 'first')),
  ADD COLUMN IF NOT EXISTS trn text,
  ADD COLUMN IF NOT EXISTS trn_status text
    CHECK (trn_status IS NULL OR trn_status IN ('known', 'unknown_held')),
  ADD COLUMN IF NOT EXISTS rule_cited text,
  ADD COLUMN IF NOT EXISTS source_attached jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS proposed_by_employee_id uuid,
  ADD COLUMN IF NOT EXISTS approved_by_employee_id uuid;

CREATE TABLE IF NOT EXISTS public.invoice_proposal (
  proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_ref text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'edited')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  invoice_id uuid REFERENCES public.invoice (invoice_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_proposal_status_idx
  ON public.invoice_proposal (status, created_at DESC);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'invoice_proposal'
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
