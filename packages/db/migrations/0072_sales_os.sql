-- Sales OS: Claude Sales & Growth replacement (research gates, suppression,
-- email events, intel signals, SOP settings, outreach channel metadata).

ALTER TABLE public.outreach_items
  ADD COLUMN IF NOT EXISTS contact_id uuid,
  ADD COLUMN IF NOT EXISTS rework_feedback text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS cadence_touch integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

CREATE INDEX IF NOT EXISTS outreach_items_contact_idx
  ON public.outreach_items (contact_id);

CREATE TABLE IF NOT EXISTS public.sales_os_settings (
  sales_os_settings_id text PRIMARY KEY DEFAULT 'default',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE IF NOT EXISTS public.sales_os_evolve_proposal (
  sales_os_evolve_proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  focus text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed', 'applied', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.company_research (
  company_research_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.company(company_id),
  name text NOT NULL,
  sector text,
  market text,
  website text,
  why_this text NOT NULL DEFAULT '',
  evidence text,
  lead_source_lane text NOT NULL DEFAULT 'industry_scanning',
  estimated_value_aed numeric(14, 2),
  suggested_services text,
  buaf_budget integer NOT NULL DEFAULT 0,
  buaf_urgency integer NOT NULL DEFAULT 0,
  buaf_access integer NOT NULL DEFAULT 0,
  buaf_fit integer NOT NULL DEFAULT 0,
  buaf_total integer NOT NULL DEFAULT 0,
  temperature text NOT NULL DEFAULT 'cool',
  approval_state text NOT NULL DEFAULT 'researched'
    CHECK (approval_state IN ('researched', 'approved', 'rejected', 'rework')),
  rework_feedback text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_research_state_idx
  ON public.company_research (approval_state, created_at);
CREATE INDEX IF NOT EXISTS company_research_company_idx
  ON public.company_research (company_id);

CREATE TABLE IF NOT EXISTS public.contact_research (
  contact_research_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_research_id uuid NOT NULL REFERENCES public.company_research(company_research_id),
  company_id uuid REFERENCES public.company(company_id),
  contact_id uuid REFERENCES public.contact(contact_id),
  deal_id uuid REFERENCES public.deal(deal_id),
  full_name text NOT NULL,
  title text,
  seniority text,
  email text,
  linkedin_url text,
  email_verified boolean NOT NULL DEFAULT false,
  email_verdict text,
  enrich_source text NOT NULL DEFAULT 'apollo',
  enrich_external_id text,
  enrich_provider text,
  approval_state text NOT NULL DEFAULT 'found'
    CHECK (approval_state IN ('found', 'approved', 'rejected', 'rework')),
  rework_feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_research_company_idx
  ON public.contact_research (company_research_id, approval_state);
CREATE UNIQUE INDEX IF NOT EXISTS contact_research_external_uniq
  ON public.contact_research (enrich_source, enrich_external_id)
  WHERE enrich_external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.suppression_entry (
  suppression_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  domain text,
  reason text NOT NULL
    CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'dnc', 'no_go')),
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppression_entry_target CHECK (email IS NOT NULL OR domain IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS suppression_entry_email_idx
  ON public.suppression_entry (lower(email));
CREATE INDEX IF NOT EXISTS suppression_entry_domain_idx
  ON public.suppression_entry (lower(domain));

CREATE TABLE IF NOT EXISTS public.email_event (
  email_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outreach_item_id uuid,
  contact_id uuid,
  kind text NOT NULL
    CHECK (kind IN ('sent', 'delivered', 'bounced', 'complained', 'replied', 'unsubscribed')),
  provider text NOT NULL DEFAULT 'gmail',
  external_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_event_outreach_idx
  ON public.email_event (outreach_item_id, occurred_at);
CREATE INDEX IF NOT EXISTS email_event_kind_idx
  ON public.email_event (kind, occurred_at);

CREATE TABLE IF NOT EXISTS public.intel_signal (
  intel_signal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.company(company_id),
  contact_id uuid REFERENCES public.contact(contact_id),
  signal_type text NOT NULL DEFAULT 'other',
  source text,
  signal_date date,
  summary text NOT NULL DEFAULT '',
  evidence_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intel_signal_company_idx
  ON public.intel_signal (company_id, created_at);

CREATE TABLE IF NOT EXISTS public.sales_os_credit_ledger (
  sales_os_credit_ledger_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('apollo_contact', 'email_send', 'linkedin_assist')),
  count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_os_credit_ledger_month_idx
  ON public.sales_os_credit_ledger (month, kind);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'sales_os_settings',
    'sales_os_evolve_proposal',
    'company_research',
    'contact_research',
    'suppression_entry',
    'email_event',
    'intel_signal',
    'sales_os_credit_ledger'
  ]::text[] LOOP
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
