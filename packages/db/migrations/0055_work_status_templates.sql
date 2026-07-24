ALTER TABLE public.work_template
  DROP CONSTRAINT IF EXISTS work_template_template_type_check;

ALTER TABLE public.work_template
  ADD CONSTRAINT work_template_template_type_check
  CHECK (template_type IN ('task', 'project', 'status'));

ALTER TABLE public.work_template ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.work_template FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_template FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.work_template FROM authenticated;
  END IF;
END $$;
