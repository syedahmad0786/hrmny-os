ALTER TABLE public.audit_event
  ADD COLUMN IF NOT EXISTS actor_portal_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_event_actor_portal_user_fk'
  ) THEN
    ALTER TABLE public.audit_event
      ADD CONSTRAINT audit_event_actor_portal_user_fk
      FOREIGN KEY (actor_portal_user_id)
      REFERENCES public.client_portal_user(client_portal_user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_event_single_actor_check'
  ) THEN
    ALTER TABLE public.audit_event
      ADD CONSTRAINT audit_event_single_actor_check
      CHECK (NOT (actor_employee_id IS NOT NULL AND actor_portal_user_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_event_actor_portal_user_idx
  ON public.audit_event (actor_portal_user_id, created_at DESC)
  WHERE actor_portal_user_id IS NOT NULL;

ALTER TABLE public.audit_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_event FROM PUBLIC;
REVOKE ALL ON TABLE public.audit_event FROM anon;
REVOKE ALL ON TABLE public.audit_event FROM authenticated;

-- The presentation account keeps its developer role and gains partner access.
INSERT INTO public.employee_role (employee_role_id, employee_id, role_id)
SELECT
  'd0000000-0000-4000-8000-000000000020'::uuid,
  e.employee_id,
  r.role_id
FROM public.employee e
JOIN public.role r ON r.key = 'partner'
WHERE lower(e.email) = 'developer@hrmny.co'
ON CONFLICT DO NOTHING;
