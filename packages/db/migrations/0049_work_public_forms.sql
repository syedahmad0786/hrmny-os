ALTER TABLE public.work_form
  ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'organization';

ALTER TABLE public.work_form
  DROP CONSTRAINT IF EXISTS work_form_access_level_check,
  ADD CONSTRAINT work_form_access_level_check
    CHECK (access_level IN ('organization', 'anyone', 'deactivated'));

UPDATE public.work_form
SET access_level = 'deactivated'
WHERE is_active = false AND access_level = 'organization';

CREATE TABLE IF NOT EXISTS public.work_form_public_rate_limit (
  work_form_id uuid PRIMARY KEY
    REFERENCES public.work_form(work_form_id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_form',
    'work_form_public_rate_limit'
  ]::text[] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', app_table
      );
    END IF;
  END LOOP;
END $$;
