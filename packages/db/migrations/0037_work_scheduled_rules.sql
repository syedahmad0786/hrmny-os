ALTER TABLE public.work_rule
  ADD COLUMN IF NOT EXISTS schedule_minutes integer;

ALTER TABLE public.work_rule
  DROP CONSTRAINT IF EXISTS work_rule_trigger_type_check,
  ADD CONSTRAINT work_rule_trigger_type_check CHECK (trigger_type IN (
    'task_added', 'task_completed', 'task_moved', 'priority_changed',
    'due_date_set', 'approval_decided', 'collaborator_added', 'scheduled'
  )),
  DROP CONSTRAINT IF EXISTS work_rule_schedule_check,
  ADD CONSTRAINT work_rule_schedule_check CHECK (
    (trigger_type = 'scheduled' AND schedule_minutes IS NOT NULL
      AND schedule_minutes BETWEEN 15 AND 525600)
    OR (trigger_type <> 'scheduled' AND schedule_minutes IS NULL)
  );

ALTER TABLE public.work_rule ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.work_rule FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_rule FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_rule FROM authenticated;
  END IF;
END $$;
