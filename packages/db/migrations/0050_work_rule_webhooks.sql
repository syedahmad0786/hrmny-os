ALTER TABLE public.work_webhook_subscription
  DROP CONSTRAINT IF EXISTS work_webhook_subscription_event_types_check,
  ADD CONSTRAINT work_webhook_subscription_event_types_check CHECK (
    cardinality(event_types) > 0 AND event_types <@ ARRAY[
      'project.created', 'project.updated', 'task.created', 'task.updated',
      'task.moved', 'task.removed', 'comment.created', 'rule.triggered'
    ]::text[]
  );

ALTER TABLE public.work_webhook_subscription ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.work_webhook_subscription FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_webhook_subscription FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_webhook_subscription FROM authenticated;
  END IF;
END $$;
