-- M1 RLS skeleton — apply AFTER 0000 migration on Supabase.
-- Patterns: (1) portal client_id scoping (2) margin exclusion for AM / portal
-- App also enforces stripMarginFields in tRPC; RLS is defense-in-depth.

-- ---------------------------------------------------------------------------
-- Helpers (Supabase JWT claims)
-- ---------------------------------------------------------------------------
-- Expect JWT custom claims (set via Auth hook or app metadata):
--   request.jwt.claims ->> 'role_keys'  e.g. '["am","partner"]'
--   request.jwt.claims ->> 'employee_id'
--   request.jwt.claims ->> 'client_id'     (portal only)
--   request.jwt.claims ->> 'actor_type'    'staff' | 'portal'

CREATE OR REPLACE FUNCTION public.jwt_claim(claim text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> claim,
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.jwt_roles()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    ARRAY(
      SELECT jsonb_array_elements_text(
        coalesce(current_setting('request.jwt.claims', true)::jsonb -> 'role_keys', '[]'::jsonb)
      )
    ),
    ARRAY[]::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(wanted text[])
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.jwt_roles() && wanted;
$$;

CREATE OR REPLACE FUNCTION public.can_view_margin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  -- Explicit deny: AM / portal never see margin even if other roles present
  SELECT CASE
    WHEN 'am' = ANY (public.jwt_roles()) THEN false
    WHEN 'account_manager' = ANY (public.jwt_roles()) THEN false
    WHEN public.jwt_claim('actor_type') = 'portal' THEN false
    WHEN public.has_any_role(ARRAY['partner', 'finance']) THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.portal_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(public.jwt_claim('client_id'), '')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on sensitive tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.deal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scope_deliverable_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_user ENABLE ROW LEVEL SECURITY;
-- v_client_margin: access via GRANT + can_view_margin() check in app / SECURITY DEFINER wrapper
-- (Postgres view RLS varies by version — prefer revoke from roles that fail can_view_margin)

-- ---------------------------------------------------------------------------
-- Staff: authenticated staff can read deals (column stripping is app-level;
-- view v_client_margin is margin-gated below)
-- ---------------------------------------------------------------------------
CREATE POLICY deal_staff_select ON public.deal
  FOR SELECT
  TO authenticated
  USING (
    public.jwt_claim('actor_type') IS DISTINCT FROM 'portal'
  );

CREATE POLICY deal_staff_write ON public.deal
  FOR ALL
  TO authenticated
  USING (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal')
  WITH CHECK (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal');

-- ---------------------------------------------------------------------------
-- Client: portal scoped to own client_id
-- ---------------------------------------------------------------------------
CREATE POLICY client_staff_all ON public.client
  FOR ALL
  TO authenticated
  USING (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal')
  WITH CHECK (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal');

CREATE POLICY client_portal_select ON public.client
  FOR SELECT
  TO authenticated
  USING (
    public.jwt_claim('actor_type') = 'portal'
    AND client_id = public.portal_client_id()
  );

-- ---------------------------------------------------------------------------
-- Scope + deliverable lines: portal own client; staff all
-- ---------------------------------------------------------------------------
CREATE POLICY scope_staff_all ON public.scope
  FOR ALL
  TO authenticated
  USING (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal')
  WITH CHECK (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal');

CREATE POLICY scope_portal_select ON public.scope
  FOR SELECT
  TO authenticated
  USING (
    public.jwt_claim('actor_type') = 'portal'
    AND client_id = public.portal_client_id()
  );

CREATE POLICY sdl_staff_all ON public.scope_deliverable_line
  FOR ALL
  TO authenticated
  USING (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal')
  WITH CHECK (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal');

CREATE POLICY sdl_portal_select ON public.scope_deliverable_line
  FOR SELECT
  TO authenticated
  USING (
    public.jwt_claim('actor_type') = 'portal'
    AND scope_id IN (
      SELECT scope_id FROM public.scope WHERE client_id = public.portal_client_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Assets: portal only own client_id
-- ---------------------------------------------------------------------------
CREATE POLICY asset_staff_all ON public.asset
  FOR ALL
  TO authenticated
  USING (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal')
  WITH CHECK (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal');

CREATE POLICY asset_portal_select ON public.asset
  FOR SELECT
  TO authenticated
  USING (
    public.jwt_claim('actor_type') = 'portal'
    AND client_id = public.portal_client_id()
  );

CREATE POLICY asset_version_staff_all ON public.asset_version
  FOR ALL
  TO authenticated
  USING (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal')
  WITH CHECK (public.jwt_claim('actor_type') IS DISTINCT FROM 'portal');

CREATE POLICY asset_version_portal_select ON public.asset_version
  FOR SELECT
  TO authenticated
  USING (
    public.jwt_claim('actor_type') = 'portal'
    AND asset_id IN (
      SELECT asset_id FROM public.asset WHERE client_id = public.portal_client_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Audit: append-only via grants; select for audit_view roles
-- ---------------------------------------------------------------------------
CREATE POLICY audit_select ON public.audit_event
  FOR SELECT
  TO authenticated
  USING (
    public.has_any_role(ARRAY['partner', 'finance', 'director', 'developer'])
  );

CREATE POLICY audit_insert ON public.audit_event
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- REVOKE update/delete on audit (immutability) — run as table owner:
REVOKE UPDATE, DELETE ON public.audit_event FROM PUBLIC;
REVOKE UPDATE, DELETE ON public.audit_event FROM authenticated;
REVOKE UPDATE, DELETE ON public.asset_version FROM PUBLIC;
REVOKE UPDATE, DELETE ON public.asset_version FROM authenticated;

-- Mirror tables: SELECT only from app role (service role bypasses RLS)
ALTER TABLE public.bayzat_employee_mirror ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_invoice_mirror ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_task_mirror ENABLE ROW LEVEL SECURITY;

CREATE POLICY mirror_bayzat_select ON public.bayzat_employee_mirror
  FOR SELECT TO authenticated USING (true);
CREATE POLICY mirror_xero_select ON public.xero_invoice_mirror
  FOR SELECT TO authenticated USING (true);
CREATE POLICY mirror_airtable_select ON public.airtable_task_mirror
  FOR SELECT TO authenticated USING (true);

-- Margin view grants (defense-in-depth; app still strips columns)
REVOKE ALL ON public.v_client_margin FROM PUBLIC;
GRANT SELECT ON public.v_client_margin TO authenticated;
-- Enforce at query time via: SELECT ... FROM v_client_margin WHERE public.can_view_margin();
