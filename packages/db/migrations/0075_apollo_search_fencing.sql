ALTER TABLE public.integration_inbox
  ADD COLUMN IF NOT EXISTS owner_employee_id uuid,
  ADD COLUMN IF NOT EXISTS credential_connection_account_id uuid,
  ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_token uuid,
  ADD COLUMN IF NOT EXISTS attempt_lease_expires_at timestamptz;

ALTER TABLE public.scheduled_job
  ADD COLUMN IF NOT EXISTS integration_inbox_id uuid,
  ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.integration_inbox
    ADD CONSTRAINT integration_inbox_owner_employee_id_employee_fk
    FOREIGN KEY (owner_employee_id)
    REFERENCES public.employee(employee_id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.integration_inbox
    ADD CONSTRAINT integration_inbox_credential_connection_account_fk
    FOREIGN KEY (credential_connection_account_id)
    REFERENCES public.connection_account(connection_account_id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.scheduled_job
    ADD CONSTRAINT scheduled_job_integration_inbox_fk
    FOREIGN KEY (integration_inbox_id)
    REFERENCES public.integration_inbox(integration_inbox_id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.scheduled_job job
SET integration_inbox_id = inbox.integration_inbox_id
FROM public.integration_inbox inbox
WHERE job.kind = 'apollo_people_search'
  AND job.integration_inbox_id IS NULL
  AND job.job_key = 'apollo-people-search:' || inbox.integration_inbox_id::text
  AND inbox.provider = 'apollo'
  AND inbox.operation = 'people.search.zero-credit';

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_job_apollo_inbox_uniq
  ON public.scheduled_job (integration_inbox_id)
  WHERE kind = 'apollo_people_search'
    AND integration_inbox_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS integration_inbox_owner_operation_idx
  ON public.integration_inbox (owner_employee_id, operation, received_at DESC);

COMMENT ON COLUMN public.integration_inbox.credential_connection_account_id IS
  'Non-secret owner-bound provider connection selected for delayed execution.';
COMMENT ON COLUMN public.integration_inbox.attempt_token IS
  'Current compare-and-set fence; cleared on every terminal or retry transition.';
COMMENT ON COLUMN public.scheduled_job.attempt_token IS
  'Current scheduled-worker lease fence shared with the linked integration receipt.';

ALTER TABLE public.integration_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_job ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integration_inbox FROM PUBLIC;
REVOKE ALL ON TABLE public.integration_inbox FROM anon;
REVOKE ALL ON TABLE public.integration_inbox FROM authenticated;
REVOKE ALL ON TABLE public.scheduled_job FROM PUBLIC;
REVOKE ALL ON TABLE public.scheduled_job FROM anon;
REVOKE ALL ON TABLE public.scheduled_job FROM authenticated;
