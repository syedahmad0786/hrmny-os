-- Additive operational provenance and commercial dates. No business records deleted.
ALTER TABLE public.deal
  ADD COLUMN IF NOT EXISTS record_class text NOT NULL DEFAULT 'operational'
    CHECK (record_class IN ('operational', 'synthetic', 'quarantined')),
  ADD COLUMN IF NOT EXISTS classification_reason text,
  ADD COLUMN IF NOT EXISTS opportunity_name text,
  ADD COLUMN IF NOT EXISTS expected_close_date date,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz;
--> statement-breakpoint
-- Only exact identities from the committed CRM seed are classified here.
UPDATE public.deal SET record_class = 'synthetic',
  classification_reason = 'Retained fixture from packages/db/seed/002_crm_seed.sql'
WHERE deal_id IN (
  'e0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000003',
  'e0000000-0000-4000-8000-000000000004',
  'e0000000-0000-4000-8000-000000000005'
);
--> statement-breakpoint
-- Use actual stage history, never a generic edit timestamp. Unknown legacy close dates stay null.
UPDATE public.deal d SET stage_entered_at = COALESCE(
  (SELECT max(a.occurred_at) FROM public.activity a
   WHERE a.deal_id = d.deal_id AND a.type::text = 'stage_change'
     AND a.metadata->>'to' = d.stage::text),
  d.created_at
)
WHERE d.stage_entered_at IS NULL;
ALTER TABLE public.deal ALTER COLUMN stage_entered_at SET DEFAULT now();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.track_deal_commercial_dates() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN NEW.stage_entered_at := now(); END IF;
  IF NEW.close_outcome IS DISTINCT FROM OLD.close_outcome THEN
    NEW.closed_at := CASE WHEN NEW.close_outcome IN ('won', 'lost') THEN now() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'track_deal_commercial_dates'
    AND tgrelid = 'public.deal'::regclass) THEN
    CREATE TRIGGER track_deal_commercial_dates BEFORE UPDATE ON public.deal
    FOR EACH ROW EXECUTE FUNCTION public.track_deal_commercial_dates();
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS deal_operational_owner_idx ON public.deal (record_class, owner_employee_id, stage);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.invalidate_changed_outreach_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.body, NEW.subject, NEW.recipient, NEW.channel, NEW.contact_id)
      IS DISTINCT FROM (OLD.body, OLD.subject, OLD.recipient, OLD.channel, OLD.contact_id) THEN
    IF OLD.state = 'sent' THEN RAISE EXCEPTION 'Sent outreach content is immutable'; END IF;
    IF OLD.state = 'approved' THEN NEW.state := 'draft'; NEW.approved_by := NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'invalidate_changed_outreach_approval'
    AND tgrelid = 'public.outreach_items'::regclass) THEN
    CREATE TRIGGER invalidate_changed_outreach_approval BEFORE UPDATE ON public.outreach_items
    FOR EACH ROW EXECUTE FUNCTION public.invalidate_changed_outreach_approval();
  END IF;
END $$;
