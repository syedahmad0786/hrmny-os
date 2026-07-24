CREATE TABLE IF NOT EXISTS public.feature_override (
  feature_override_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key text NOT NULL,
  scope_type text NOT NULL
    CHECK (scope_type IN ('global', 'client', 'role', 'user')),
  scope_key text NOT NULL,
  enabled boolean NOT NULL,
  reason text,
  updated_by_employee_id uuid
    REFERENCES public.employee(employee_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope_type = 'global' AND scope_key = 'global') OR
    (scope_type <> 'global' AND length(trim(scope_key)) > 0)
  ),
  UNIQUE (feature_key, scope_type, scope_key)
);

CREATE INDEX IF NOT EXISTS feature_override_scope_idx
  ON public.feature_override (scope_type, scope_key);

DO $$
DECLARE
  app_table text;
  has_anon boolean;
  has_authenticated boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    INTO has_authenticated;

  FOREACH app_table IN ARRAY ARRAY['feature_override']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    IF has_anon THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
    END IF;
    IF has_authenticated THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated',
        app_table
      );
    END IF;
  END LOOP;
END $$;

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role_id, 'admin', 'features', 'allow'
FROM public.role
WHERE role.key IN ('partner', 'director')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = 'admin'
      AND existing.action = 'features'
      AND existing.effect = 'allow'
  );
