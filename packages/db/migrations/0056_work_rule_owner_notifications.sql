ALTER TABLE public.work_notification
  DROP CONSTRAINT IF EXISTS work_notification_event_type_check,
  ADD CONSTRAINT work_notification_event_type_check CHECK (event_type IN (
    'assigned', 'updated', 'completed', 'commented', 'followed', 'due_soon',
    'message', 'status_update', 'liked', 'rule_owner'
  ));

ALTER TABLE public.work_notification ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.work_notification FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_notification FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_notification FROM authenticated;
  END IF;
END $$;
