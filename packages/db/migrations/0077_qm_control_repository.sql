CREATE TABLE IF NOT EXISTS public.qm_session_binding (
  session_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  scope_id text NOT NULL,
  lifecycle text NOT NULL,
  workspace_read_enabled boolean NOT NULL DEFAULT false,
  effect_propose_enabled boolean NOT NULL DEFAULT false,
  runtime_kind text NOT NULL,
  local_fixture_id text,
  provider text,
  provider_resource_ref text,
  provider_readback_receipt text,
  upstream_version text NOT NULL,
  upstream_commit text NOT NULL,
  state_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qm_session_owner_uniq
    UNIQUE (organization_id, owner_employee_id),
  CONSTRAINT qm_session_scope_uniq UNIQUE (scope_id),
  CONSTRAINT qm_session_lifecycle_chk
    CHECK (lifecycle IN ('active', 'suspended', 'revoked')),
  CONSTRAINT qm_session_scope_chk
    CHECK (
      scope_id =
        'qm:organization:' || organization_id::text ||
        ':employee:' || owner_employee_id::text
    ),
  CONSTRAINT qm_session_runtime_chk
    CHECK (
      (
        runtime_kind = 'local-synthetic'
        AND local_fixture_id IS NOT NULL
        AND provider IS NULL
        AND provider_resource_ref IS NULL
        AND provider_readback_receipt IS NULL
      )
      OR
      (
        runtime_kind = 'provider'
        AND local_fixture_id IS NULL
        AND provider = 'flyio'
        AND provider_resource_ref IS NOT NULL
        AND provider_readback_receipt IS NOT NULL
      )
    ),
  CONSTRAINT qm_session_upstream_pin_chk
    CHECK (
      upstream_version = 'v0.1.5'
      AND upstream_commit =
        'd931fe963de3ac20b9a7526ea9a4873c0d8ed18e'
    ),
  CONSTRAINT qm_session_state_version_chk CHECK (state_version >= 0)
);

CREATE INDEX IF NOT EXISTS qm_session_owner_idx
  ON public.qm_session_binding (
    organization_id,
    owner_employee_id,
    lifecycle
  );

CREATE TABLE IF NOT EXISTS public.qm_command_decision (
  receipt_id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  input_digest text NOT NULL,
  organization_id uuid NOT NULL,
  actor_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  scope_id text,
  outcome text NOT NULL,
  reason_code text NOT NULL,
  required_capability text NOT NULL,
  session_state_version integer,
  session_policy_digest text,
  upstream_commit text,
  runtime_kind text,
  provider_readback_receipt text,
  proposal_id uuid,
  precheck_id uuid,
  proposal jsonb,
  read_precheck jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qm_decision_request_uniq
    UNIQUE (organization_id, actor_employee_id, request_id),
  CONSTRAINT qm_decision_input_digest_chk
    CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT qm_decision_outcome_chk
    CHECK (
      outcome IN (
        'workspace_read_precheck_recorded',
        'effect_proposal_recorded',
        'denied',
        'idempotency_conflict'
      )
    ),
  CONSTRAINT qm_decision_reason_chk
    CHECK (
      reason_code IN (
        'WORKSPACE_READ_PRECHECK_RECORDED',
        'EFFECT_PROPOSAL_RECORDED',
        'AUTHORIZATION_DENIED',
        'REQUEST_ID_PAYLOAD_CONFLICT',
        'SESSION_POLICY_CHANGED'
      )
    ),
  CONSTRAINT qm_decision_capability_chk
    CHECK (required_capability IN ('workspace.read', 'effect.propose')),
  CONSTRAINT qm_decision_reason_outcome_chk
    CHECK (
      (
        outcome = 'workspace_read_precheck_recorded'
        AND reason_code = 'WORKSPACE_READ_PRECHECK_RECORDED'
        AND required_capability = 'workspace.read'
      )
      OR
      (
        outcome = 'effect_proposal_recorded'
        AND reason_code = 'EFFECT_PROPOSAL_RECORDED'
        AND required_capability = 'effect.propose'
      )
      OR
      (
        outcome = 'denied'
        AND reason_code = 'AUTHORIZATION_DENIED'
      )
      OR
      (
        outcome = 'idempotency_conflict'
        AND reason_code IN (
          'REQUEST_ID_PAYLOAD_CONFLICT',
          'SESSION_POLICY_CHANGED'
        )
      )
    ),
  CONSTRAINT qm_decision_session_metadata_chk
    CHECK (
      (
        outcome = 'denied'
        AND scope_id IS NULL
        AND session_state_version IS NULL
        AND session_policy_digest IS NULL
        AND upstream_commit IS NULL
        AND runtime_kind IS NULL
        AND provider_readback_receipt IS NULL
      )
      OR
      (
        outcome <> 'denied'
        AND scope_id IS NOT NULL
        AND session_state_version >= 0
        AND session_policy_digest ~ '^[a-f0-9]{64}$'
        AND upstream_commit ~ '^[a-f0-9]{40}$'
        AND (
          (
            runtime_kind = 'provider'
            AND provider_readback_receipt IS NOT NULL
          )
          OR
          (
            runtime_kind = 'local-synthetic'
            AND provider_readback_receipt IS NULL
          )
        )
      )
    ),
  CONSTRAINT qm_decision_work_record_chk
    CHECK (
      (
        outcome = 'workspace_read_precheck_recorded'
        AND precheck_id IS NOT NULL
        AND proposal_id IS NULL
        AND jsonb_typeof(read_precheck) = 'object'
        AND proposal IS NULL
        AND read_precheck->>'precheckId' = precheck_id::text
        AND read_precheck->>'organizationId' = organization_id::text
        AND read_precheck->>'scopeId' = scope_id
        AND read_precheck->>'sessionId' = session_id::text
        AND read_precheck->>'requestedByEmployeeId' = actor_employee_id::text
        AND (read_precheck->>'createdAt')::timestamptz = recorded_at
      ) IS TRUE
      OR
      (
        outcome = 'effect_proposal_recorded'
        AND proposal_id IS NOT NULL
        AND precheck_id IS NULL
        AND jsonb_typeof(proposal) = 'object'
        AND read_precheck IS NULL
        AND proposal->>'proposalId' = proposal_id::text
        AND proposal->>'organizationId' = organization_id::text
        AND proposal->>'scopeId' = scope_id
        AND proposal->>'sessionId' = session_id::text
        AND proposal->>'proposedByEmployeeId' = actor_employee_id::text
        AND (proposal->>'createdAt')::timestamptz = recorded_at
      ) IS TRUE
      OR
      (
        outcome IN ('denied', 'idempotency_conflict')
        AND proposal_id IS NULL
        AND precheck_id IS NULL
        AND proposal IS NULL
        AND read_precheck IS NULL
      ) IS TRUE
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS qm_decision_proposal_uniq
  ON public.qm_command_decision (proposal_id)
  WHERE proposal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS qm_decision_precheck_uniq
  ON public.qm_command_decision (precheck_id)
  WHERE precheck_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS qm_decision_session_recorded_idx
  ON public.qm_command_decision (session_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION public.reject_qm_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'QM_DECISION_IMMUTABLE';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_qm_decision_mutation() FROM PUBLIC;

DROP TRIGGER IF EXISTS qm_command_decision_immutable_trg
  ON public.qm_command_decision;
CREATE TRIGGER qm_command_decision_immutable_trg
BEFORE UPDATE OR DELETE ON public.qm_command_decision
FOR EACH ROW EXECUTE FUNCTION public.reject_qm_decision_mutation();

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'qm_session_binding',
    'qm_command_decision'
  ]::text[] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      app_table
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC',
      app_table
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon',
        app_table
      );
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated',
        app_table
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.qm_session_binding IS
  'Server-only HRMNY personal QM runtime binding; never an identity or approval authority.';
COMMENT ON TABLE public.qm_command_decision IS
  'Immutable HRMNY authorization and idempotency receipt with sanitized digest-only work artifacts.';
