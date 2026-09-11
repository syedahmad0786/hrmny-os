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
    (revoked_at IS NOT NULL AND revoked_by_employee_id IS NOT NULL AND revocation_reason IS NOT NULL AND length(trim(revocation_reason)) BETWEEN 1 AND 500)
  )
);

CREATE OR REPLACE FUNCTION public.enforce_employee_google_identity_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Google identity history cannot be deleted';
  END IF;
  IF (NEW.employee_google_identity_id, NEW.employee_id, NEW.qm_principal,
      NEW.google_issuer, NEW.google_subject, NEW.claim_method,
      NEW.claim_evidence_digest, NEW.claimed_by_employee_id, NEW.claimed_at)
      IS DISTINCT FROM
     (OLD.employee_google_identity_id, OLD.employee_id, OLD.qm_principal,
      OLD.google_issuer, OLD.google_subject, OLD.claim_method,
      OLD.claim_evidence_digest, OLD.claimed_by_employee_id, OLD.claimed_at) THEN
    RAISE EXCEPTION 'Google identity binding and claim provenance are immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND
     (NEW.revoked_at, NEW.revoked_by_employee_id, NEW.revocation_reason)
       IS DISTINCT FROM
     (OLD.revoked_at, OLD.revoked_by_employee_id, OLD.revocation_reason) THEN
    RAISE EXCEPTION 'Google identity revocation is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_employee_google_identity_history'
      AND tgrelid = 'public.employee_google_identity'::regclass
  ) THEN
    CREATE TRIGGER enforce_employee_google_identity_history
    BEFORE UPDATE OR DELETE ON public.employee_google_identity
    FOR EACH ROW EXECUTE FUNCTION public.enforce_employee_google_identity_history();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_employee_google_identity_no_truncate'
      AND tgrelid = 'public.employee_google_identity'::regclass
  ) THEN
    CREATE TRIGGER enforce_employee_google_identity_no_truncate
    BEFORE TRUNCATE ON public.employee_google_identity
    FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_employee_google_identity_history();
  END IF;
END $$;

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
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM service_role', app_table);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role', app_table);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.employee_google_identity IS
  'Server-only reviewed Google identity binding for an existing active employee and QM email principal.';
