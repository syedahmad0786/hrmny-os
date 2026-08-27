-- Re-open curated Work apps if the org connected-app kill-switch was left on.
-- First-party CRM apps (Google Workspace, Apollo, Hunter, n8n, Xero, …) are
-- also exempt in application code so Connect cannot be greyed out by this row.

UPDATE public.work_organization_policy
SET app_policy = 'approved_only',
    updated_at = now()
WHERE organization_key = 'default'
  AND app_policy = 'disabled';

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY['work_organization_policy']::text[] LOOP
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
