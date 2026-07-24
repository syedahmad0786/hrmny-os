CREATE TABLE IF NOT EXISTS public.asana_webhook_subscription (
  asana_webhook_subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_external_id text NOT NULL,
  workspace_name text NOT NULL,
  resource_external_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('workspace', 'project')),
  resource_name text NOT NULL,
  connected_account_id text NOT NULL,
  webhook_external_id text UNIQUE,
  endpoint_token text NOT NULL UNIQUE
    CHECK (endpoint_token ~ '^[A-Za-z0-9_-]{32,}$'),
  target_url text NOT NULL CHECK (target_url ~ '^https://'),
  secret_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'error', 'deleted')),
  last_event_at timestamptz,
  last_event_count integer NOT NULL DEFAULT 0 CHECK (last_event_count >= 0),
  last_error text,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_external_id, connected_account_id)
);

CREATE INDEX IF NOT EXISTS asana_webhook_subscription_active_idx
  ON public.asana_webhook_subscription (status, workspace_external_id);

CREATE TABLE IF NOT EXISTS public.asana_webhook_receipt (
  asana_webhook_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asana_webhook_subscription_id uuid NOT NULL
    REFERENCES public.asana_webhook_subscription(asana_webhook_subscription_id)
    ON DELETE CASCADE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  event_count integer NOT NULL CHECK (event_count >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asana_webhook_subscription_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS asana_webhook_receipt_received_idx
  ON public.asana_webhook_receipt (received_at DESC);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'asana_webhook_subscription',
    'asana_webhook_receipt'
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
