-- Additive CRM record ownership and personal/team view definitions. No record reclassification.
ALTER TABLE public.company ADD COLUMN IF NOT EXISTS owner_employee_id uuid REFERENCES public.employee(employee_id);
ALTER TABLE public.contact ADD COLUMN IF NOT EXISTS owner_employee_id uuid REFERENCES public.employee(employee_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.crm_saved_view (
  view_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  visibility text NOT NULL CHECK (visibility IN ('personal', 'team')),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_saved_view_owner_idx ON public.crm_saved_view(owner_employee_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_contact_interaction_idx ON public.activity(contact_id, occurred_at DESC)
  WHERE type IN ('call', 'meeting', 'email', 'outreach');
--> statement-breakpoint
CREATE TABLE public.client_source_project (
  project_id text PRIMARY KEY CHECK (project_id ~ '^[0-9]{6,30}$'),
  workspace_id text NOT NULL CHECK (workspace_id ~ '^[0-9]{6,30}$'),
  client_id uuid NOT NULL REFERENCES public.client(client_id),
  project_name text NOT NULL,
  observed_at timestamptz NOT NULL,
  imported_by uuid NOT NULL REFERENCES public.employee(employee_id)
);
CREATE INDEX client_source_project_client_idx ON public.client_source_project(client_id);
--> statement-breakpoint
DO $$
DECLARE app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY['crm_saved_view', 'client_source_project']::text[] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', app_table);
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', app_table);
  END LOOP;
END $$;
