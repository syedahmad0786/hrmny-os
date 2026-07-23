CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.connection_account
  ADD COLUMN IF NOT EXISTS auth_type text NOT NULL DEFAULT 'oauth',
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS secret_id uuid,
  ADD COLUMN IF NOT EXISTS last_tested_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE UNIQUE INDEX IF NOT EXISTS connection_account_staff_toolkit_uniq
  ON public.connection_account (owner_employee_id, toolkit, scope)
  WHERE owner_employee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.feature_request (
  feature_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  title text NOT NULL,
  raw_input text NOT NULL,
  voice_storage_path text,
  prd jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'building', 'shipped')),
  approval_note text,
  approved_by_employee_id uuid REFERENCES public.employee(employee_id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_request_status_created_idx
  ON public.feature_request (status, created_at DESC);

ALTER TABLE public.feature_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.feature_request FROM PUBLIC, anon, authenticated;
