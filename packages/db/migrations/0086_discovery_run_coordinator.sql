-- Discovery Package B: programme-scoped durable run coordinator.
-- Transport remains disabled until the matching Inngest and n8n handlers ship.

ALTER TABLE public.research_programme
  ADD COLUMN IF NOT EXISTS next_due_at timestamptz;

ALTER TABLE public.scheduled_job
  ADD COLUMN IF NOT EXISTS research_programme_id uuid,
  ADD COLUMN IF NOT EXISTS research_programme_version_id uuid,
  ADD COLUMN IF NOT EXISTS overall_deadline_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.scheduled_job
    ADD CONSTRAINT scheduled_job_research_programme_fk
    FOREIGN KEY (research_programme_id)
    REFERENCES public.research_programme(research_programme_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.scheduled_job
    ADD CONSTRAINT scheduled_job_research_programme_version_fk
    FOREIGN KEY (research_programme_version_id)
    REFERENCES public.research_programme_version(research_programme_version_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.scheduled_job
  DROP CONSTRAINT IF EXISTS scheduled_job_status_check;
ALTER TABLE public.scheduled_job
  ADD CONSTRAINT scheduled_job_status_check CHECK (
    status IN (
      'pending',
      'running',
      'completed',
      'failed',
      'deferred',
      'cancel_requested',
      'cancelled',
      'coalesced',
      'partial',
      'dead_letter'
    )
  );

DO $$ BEGIN
  ALTER TABLE public.scheduled_job
    ADD CONSTRAINT scheduled_job_discovery_contract_chk CHECK (
      kind <> 'sales_research_run'
      OR (
        research_programme_id IS NOT NULL
        AND concurrency_key = 'discovery:programme:' || research_programme_id::text
        AND (
          status NOT IN ('running', 'cancel_requested', 'completed', 'partial')
          OR research_programme_version_id IS NOT NULL
        )
        AND (
          status NOT IN ('running', 'cancel_requested')
          OR overall_deadline_at IS NOT NULL
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_job_discovery_pending_uniq
  ON public.scheduled_job (research_programme_id)
  WHERE kind = 'sales_research_run' AND status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_job_discovery_deferred_uniq
  ON public.scheduled_job (research_programme_id)
  WHERE kind = 'sales_research_run' AND status = 'deferred';

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_job_discovery_active_uniq
  ON public.scheduled_job (research_programme_id)
  WHERE kind = 'sales_research_run'
    AND status IN ('running', 'cancel_requested');

CREATE INDEX IF NOT EXISTS scheduled_job_discovery_programme_history_idx
  ON public.scheduled_job (research_programme_id, created_at DESC)
  WHERE kind = 'sales_research_run';

COMMENT ON COLUMN public.research_programme.next_due_at IS
  'Next nominal published Discovery slot. Null means paused or unscheduled.';
COMMENT ON COLUMN public.scheduled_job.research_programme_id IS
  'Typed programme fence for sales_research_run jobs; other job kinds leave it null.';
COMMENT ON COLUMN public.scheduled_job.research_programme_version_id IS
  'Immutable effective programme version, assigned no later than run claim; deferred reservations remain null until claimed.';
COMMENT ON COLUMN public.scheduled_job.overall_deadline_at IS
  'Hard Discovery attempt deadline. Heartbeat leases must never extend beyond it.';
