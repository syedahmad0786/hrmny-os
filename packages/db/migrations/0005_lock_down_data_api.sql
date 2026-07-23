-- The browser uses Supabase Auth only. Business data is served through the
-- authenticated tRPC API, so anon/authenticated must not access app tables
-- directly through PostgREST or GraphQL.

DO $$
DECLARE
  app_table text;
  sequence_name text;
  policy_record record;
  has_anon boolean;
  has_authenticated boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    INTO has_authenticated;

  FOREACH app_table IN ARRAY ARRAY[
    -- BEGIN APP TABLES
    'account_team_member',
    'activity',
    'airtable_task_mirror',
    'asset',
    'asset_version',
    'audit_event',
    'bayzat_employee_mirror',
    'brief',
    'calendar',
    'calendar_slot',
    'client',
    'client_portal_user',
    'company',
    'connection_account',
    'contact',
    'convention',
    'crm_note',
    'crm_task',
    'deal',
    'employee',
    'employee_auth',
    'employee_role',
    'health_signal',
    'immersion',
    'invoice',
    'memory_chunk',
    'permission_policy',
    'role',
    'scope',
    'scope_deliverable_line',
    'task',
    'ticket',
    'ticket_comment',
    'xero_invoice_mirror'
    -- END APP TABLES
  ]::text[]
  LOOP
    IF to_regclass(format('public.%I', app_table)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);

      FOR policy_record IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = app_table
      LOOP
        EXECUTE format(
          'DROP POLICY %I ON public.%I',
          policy_record.policyname,
          app_table
        );
      END LOOP;

      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC',
        app_table
      );
      IF has_anon THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon',
          app_table
        );
      END IF;
      IF has_authenticated THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated',
          app_table
        );
      END IF;
    END IF;
  END LOOP;

  FOR sequence_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM PUBLIC',
      sequence_name
    );
    IF has_anon THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM anon',
        sequence_name
      );
    END IF;
    IF has_authenticated THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM authenticated',
        sequence_name
      );
    END IF;
  END LOOP;

  IF to_regclass('public.v_client_margin') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.v_client_margin SET (security_invoker = true)';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.v_client_margin FROM PUBLIC';
    IF has_anon THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.v_client_margin FROM anon';
    END IF;
    IF has_authenticated THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.v_client_margin FROM authenticated';
    END IF;
  END IF;

  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC';
  IF has_anon THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon';
  END IF;
  IF has_authenticated THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated';
  END IF;
END $$;

-- Remove helpers from the superseded claim-based RLS draft if it was applied
-- manually to an earlier environment.
DROP FUNCTION IF EXISTS public.can_view_margin();
DROP FUNCTION IF EXISTS public.portal_client_id();
DROP FUNCTION IF EXISTS public.has_any_role(text[]);
DROP FUNCTION IF EXISTS public.jwt_roles();
DROP FUNCTION IF EXISTS public.jwt_claim(text);
