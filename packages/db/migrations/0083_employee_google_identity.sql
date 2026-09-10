CREATE TABLE IF NOT EXISTS public.employee_google_identity (
  employee_google_identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  qm_principal text NOT NULL UNIQUE,
  google_issuer text NOT NULL,
  google_subject text NOT NULL UNIQUE,
  claim_method text NOT NULL,
  claim_evidence_digest text NOT NULL,
  claimed_by_employee_id uuid NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_employee_id uuid REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason text,
  CONSTRAINT employee_google_identity_principal_chk CHECK (
    qm_principal = lower(trim(qm_principal))
    AND length(qm_principal) BETWEEN 3 AND 320
    AND qm_principal ~ '^[^@[:space:]]+@hrmny\.co$'
  ),
  CONSTRAINT employee_google_identity_issuer_chk CHECK (
    google_issuer = 'https://accounts.google.com'
  ),
  CONSTRAINT employee_google_identity_subject_chk CHECK (
    google_subject ~ '^[0-9]{1,255}$'
  ),
  CONSTRAINT employee_google_identity_claim_method_chk CHECK (
    claim_method = 'admin-reviewed-google-proof'
  ),
  CONSTRAINT employee_google_identity_claim_evidence_chk CHECK (
    claim_evidence_digest ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT employee_google_identity_revocation_chk CHECK (
    (revoked_at IS NULL AND revoked_by_employee_id IS NULL AND revocation_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoked_by_employee_id IS NOT NULL AND length(trim(revocation_reason)) BETWEEN 1 AND 500)
  )
);

DO $$
DECLARE app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY['employee_google_identity']::text[] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', app_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', app_table);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.employee_google_identity IS
  'Server-only reviewed Google identity binding for an existing active employee and QM email principal.';
