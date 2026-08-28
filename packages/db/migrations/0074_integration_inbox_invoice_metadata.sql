-- Replay-safe provider ingress plus durable invoice gate metadata.
-- Additive only: no existing rows are rewritten and no external system is touched.

CREATE TABLE IF NOT EXISTS public.integration_inbox (
  integration_inbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_event_id text NOT NULL,
  operation text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received',
  attempts integer NOT NULL DEFAULT 0,
  result jsonb,
  last_error text,
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_inbox_status_check
    CHECK (status IN ('received', 'processing', 'completed', 'failed')),
  CONSTRAINT integration_inbox_attempts_check CHECK (attempts >= 0),
  CONSTRAINT integration_inbox_provider_event_uniq
    UNIQUE (provider, external_event_id)
);

CREATE INDEX IF NOT EXISTS integration_inbox_status_received_idx
  ON public.integration_inbox (status, received_at);

COMMENT ON TABLE public.integration_inbox IS
  'Minimal durable callback ledger for replay detection, processing outcome, and reconciliation.';

ALTER TABLE public.invoice
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS billing_kind text,
  ADD COLUMN IF NOT EXISTS trn text,
  ADD COLUMN IF NOT EXISTS trn_status text,
  ADD COLUMN IF NOT EXISTS rule_cited text,
  ADD COLUMN IF NOT EXISTS source_attached jsonb,
  ADD COLUMN IF NOT EXISTS proposed_by_employee_id uuid,
  ADD COLUMN IF NOT EXISTS approved_by_employee_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_proposed_by_employee_id_employee_employee_id_fk'
  ) THEN
    ALTER TABLE public.invoice
      ADD CONSTRAINT invoice_proposed_by_employee_id_employee_employee_id_fk
      FOREIGN KEY (proposed_by_employee_id)
      REFERENCES public.employee(employee_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_approved_by_employee_id_employee_employee_id_fk'
  ) THEN
    ALTER TABLE public.invoice
      ADD CONSTRAINT invoice_approved_by_employee_id_employee_employee_id_fk
      FOREIGN KEY (approved_by_employee_id)
      REFERENCES public.employee(employee_id);
  END IF;
END $$;

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY['integration_inbox']::text[] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated',
        app_table
      );
    END IF;
  END LOOP;
END $$;
