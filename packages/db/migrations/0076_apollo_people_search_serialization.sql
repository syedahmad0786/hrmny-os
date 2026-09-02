-- SHARE ROW EXCLUSIVE conflicts with the ROW EXCLUSIVE lock taken by
-- INSERT/UPDATE, closing the gap between the external preflight and backfill.
LOCK TABLE public.scheduled_job IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.scheduled_job
    WHERE kind = 'apollo_people_search'
      AND status = 'running'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55006',
      MESSAGE = 'Migration 0076 requires zero running Apollo People Search jobs';
  END IF;
END $$;

ALTER TABLE public.scheduled_job
  ADD COLUMN IF NOT EXISTS concurrency_key text;

CREATE OR REPLACE FUNCTION public.scheduled_job_assign_apollo_concurrency_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kind = 'apollo_people_search' THEN
    NEW.concurrency_key := 'provider:apollo';
  ELSIF NEW.concurrency_key = 'provider:apollo' THEN
    NEW.concurrency_key := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL
  ON FUNCTION public.scheduled_job_assign_apollo_concurrency_key()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS scheduled_job_assign_apollo_concurrency_key_trg
  ON public.scheduled_job;

CREATE TRIGGER scheduled_job_assign_apollo_concurrency_key_trg
BEFORE INSERT OR UPDATE OF kind, concurrency_key
ON public.scheduled_job
FOR EACH ROW
EXECUTE FUNCTION public.scheduled_job_assign_apollo_concurrency_key();

UPDATE public.scheduled_job
SET concurrency_key = 'provider:apollo'
WHERE kind = 'apollo_people_search'
  AND concurrency_key IS DISTINCT FROM 'provider:apollo';

DO $$
BEGIN
  ALTER TABLE public.scheduled_job
    ADD CONSTRAINT scheduled_job_apollo_concurrency_key_chk
    CHECK (
      (
        kind = 'apollo_people_search'
        AND concurrency_key IS NOT NULL
        AND concurrency_key = 'provider:apollo'
      )
      OR (
        kind <> 'apollo_people_search'
        AND concurrency_key IS DISTINCT FROM 'provider:apollo'
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_job_running_concurrency_uniq
  ON public.scheduled_job (concurrency_key)
  WHERE status = 'running'
    AND concurrency_key IS NOT NULL;

COMMENT ON COLUMN public.scheduled_job.concurrency_key IS
  'Reserved execution slot key. Migration 0076 enrolls only apollo_people_search as provider:apollo; paid Match, auth probes, and legacy paths do not participate.';

ALTER TABLE public.scheduled_job ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scheduled_job FROM PUBLIC;
REVOKE ALL ON TABLE public.scheduled_job FROM anon;
REVOKE ALL ON TABLE public.scheduled_job FROM authenticated;
