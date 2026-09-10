CREATE SCHEMA IF NOT EXISTS qm_internal;

REVOKE ALL PRIVILEGES ON SCHEMA qm_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS qm_internal.work_authority_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

INSERT INTO qm_internal.work_authority_revision (singleton, revision)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL PRIVILEGES
  ON TABLE qm_internal.work_authority_revision
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION qm_internal.acquire_work_authority_fence(
  expected_revision bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qm_internal
AS $$
DECLARE
  current_revision bigint;
BEGIN
  -- ponytail: one global fence fits current Work volume; use per-project keys
  -- only if measured authority-update contention requires it.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(916500114200820001::bigint);

  SELECT authority.revision
  INTO current_revision
  FROM qm_internal.work_authority_revision authority
  WHERE authority.singleton = true;

  IF current_revision IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WORK_AUTHORITY_FENCE_STATE_MISSING';
  END IF;
  IF expected_revision IS NOT NULL AND expected_revision <> current_revision THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'WORK_AUTHORITY_REVISION_STALE';
  END IF;
  RETURN current_revision;
END;
$$;

CREATE OR REPLACE FUNCTION qm_internal.lock_work_authority_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qm_internal
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(916500114200820001::bigint);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION qm_internal.advance_work_authority_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qm_internal
AS $$
DECLARE
  authority_changed boolean := TG_OP <> 'UPDATE';
  column_index integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR column_index IN 0..TG_NARGS - 1 LOOP
      IF (pg_catalog.to_jsonb(OLD) -> TG_ARGV[column_index])
          IS DISTINCT FROM
          (pg_catalog.to_jsonb(NEW) -> TG_ARGV[column_index]) THEN
        authority_changed := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  IF NOT authority_changed THEN RETURN NULL; END IF;

  UPDATE qm_internal.work_authority_revision
  SET revision = revision + 1
  WHERE singleton = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'WORK_AUTHORITY_FENCE_STATE_MISSING';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION qm_internal.acquire_work_authority_fence(bigint)
  FROM PUBLIC;
REVOKE ALL PRIVILEGES
  ON FUNCTION qm_internal.lock_work_authority_mutation()
  FROM PUBLIC;
REVOKE ALL PRIVILEGES
  ON FUNCTION qm_internal.advance_work_authority_revision()
  FROM PUBLIC;

DO $$
DECLARE
  authority_table text;
  authority_columns text[];
  blocked_role text;
BEGIN
  -- work_team is intentionally absent: project access ignores its archive state;
  -- deletes cascade through the fenced member and project mapping tables.
  FOR authority_table, authority_columns IN
    SELECT source.table_name, source.authority_columns
    FROM (VALUES
      ('employee', ARRAY['employee_id', 'email', 'is_active']),
      ('employee_role', ARRAY['employee_id', 'role_id']),
      ('role', ARRAY['role_id', 'key']),
      ('permission_policy', ARRAY[
        'role_id', 'resource', 'action', 'effect'
      ]),
      ('feature_override', ARRAY[
        'feature_key', 'scope_type', 'scope_key', 'enabled'
      ]),
      ('work_member_license', ARRAY['employee_id', 'license_type']),
      ('work_project', ARRAY[
        'work_project_id', 'client_id', 'privacy', 'owner_employee_id',
        'created_by_employee_id', 'archived_at', 'project_kind'
      ]),
      ('work_project_member', ARRAY[
        'work_project_id', 'employee_id', 'access_level'
      ]),
      ('work_team_project', ARRAY[
        'work_team_id', 'work_project_id', 'access_level'
      ]),
      ('work_team_member', ARRAY['work_team_id', 'employee_id'])
    ) AS source(table_name, authority_columns)
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS work_authority_lock_fence_trg ON public.%I',
      authority_table
    );
    EXECUTE format(
      'DROP TRIGGER IF EXISTS work_authority_revision_fence_trg ON public.%I',
      authority_table
    );
    EXECUTE format(
      'DROP TRIGGER IF EXISTS work_authority_truncate_revision_trg '
      'ON public.%I',
      authority_table
    );
    EXECUTE format(
      'CREATE TRIGGER work_authority_lock_fence_trg '
      'BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION '
      'qm_internal.lock_work_authority_mutation()',
      authority_table
    );
    EXECUTE format(
      'CREATE TRIGGER work_authority_revision_fence_trg '
      'AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION '
      'qm_internal.advance_work_authority_revision(%s)',
      authority_table,
      (
        SELECT pg_catalog.string_agg(
          pg_catalog.quote_literal(column_name),
          ', '
        )
        FROM pg_catalog.unnest(authority_columns) column_name
      )
    );
    EXECUTE format(
      'CREATE TRIGGER work_authority_truncate_revision_trg '
      'AFTER TRUNCATE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION '
      'qm_internal.advance_work_authority_revision()',
      authority_table
    );
  END LOOP;

  -- PostgreSQL takes TRUNCATE's ACCESS EXCLUSIVE table lock before this fence.
  -- Fence holders must therefore use short, fail-closed transaction timeouts.

  FOR blocked_role IN
    SELECT rolname
    FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'authenticator', 'service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON SCHEMA qm_internal FROM %I',
      blocked_role
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE '
      'qm_internal.work_authority_revision FROM %I',
      blocked_role
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION '
      'qm_internal.acquire_work_authority_fence(bigint) FROM %I',
      blocked_role
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION '
      'qm_internal.lock_work_authority_mutation() FROM %I',
      blocked_role
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION '
      'qm_internal.advance_work_authority_revision() FROM %I',
      blocked_role
    );
  END LOOP;
END $$;

COMMENT ON SCHEMA qm_internal IS
  'Server-only coordination primitives for native QM; contains no Work rows.';
COMMENT ON TABLE qm_internal.work_authority_revision IS
  'Global revision advanced transactionally by every current Work project authority source.';
COMMENT ON FUNCTION qm_internal.acquire_work_authority_fence(bigint) IS
  'Call inside a dedicated transaction to hold Work project authority stable; returns the current global revision and rejects a stale expected revision.';
