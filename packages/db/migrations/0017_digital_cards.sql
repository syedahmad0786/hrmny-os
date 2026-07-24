CREATE TABLE IF NOT EXISTS public.digital_card_template (
  digital_card_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company_name text NOT NULL DEFAULT 'Creative Harmony',
  accent_color text NOT NULL DEFAULT '#C7702E'
    CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS digital_card_template_one_default_idx
  ON public.digital_card_template (is_default)
  WHERE is_default;

CREATE TABLE IF NOT EXISTS public.employee_digital_card (
  employee_digital_card_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  digital_card_template_id uuid
    REFERENCES public.digital_card_template(digital_card_template_id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text,
  job_title text,
  work_email text,
  phone text,
  website text,
  location text,
  bio text,
  photo_url text,
  linkedin_url text,
  public_fields text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (public_fields <@ ARRAY[
      'displayName', 'jobTitle', 'workEmail', 'phone', 'website',
      'location', 'bio', 'photoUrl', 'linkedinUrl'
    ]::text[]),
  is_active boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  admin_disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_active OR revoked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS employee_digital_card_public_idx
  ON public.employee_digital_card (slug)
  WHERE is_active AND admin_disabled_at IS NULL;

INSERT INTO public.digital_card_template (
  name, company_name, accent_color, is_default
)
SELECT 'hrmny default', 'Creative Harmony', '#C7702E', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.digital_card_template WHERE is_default
);

DO $$
DECLARE
  app_table text;
  has_anon boolean;
  has_authenticated boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    INTO has_authenticated;

  FOREACH app_table IN ARRAY ARRAY[
    'digital_card_template',
    'employee_digital_card'
  ]::text[]
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
SELECT role_id, 'digital_card', 'manage', 'allow'
FROM public.role
WHERE role.key IN ('partner', 'director', 'hr')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = 'digital_card'
      AND existing.action = 'manage'
      AND existing.effect = 'allow'
  );
