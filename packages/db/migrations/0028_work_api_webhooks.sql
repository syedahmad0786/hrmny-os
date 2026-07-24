CREATE TABLE IF NOT EXISTS public.work_api_token (
  work_api_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text NOT NULL CHECK (token_prefix ~ '^hrmny_work_[A-Za-z0-9_-]{6}$'),
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) > 0 AND scopes <@ ARRAY[
      'projects:read', 'projects:write', 'tasks:read', 'tasks:write',
      'comments:read', 'comments:write'
    ]::text[]
  ),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_api_token_owner_idx
  ON public.work_api_token (created_by_employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.work_webhook_subscription (
  work_webhook_subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL
    REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  target_url text NOT NULL CHECK (target_url ~ '^https://'),
  event_types text[] NOT NULL CHECK (
    cardinality(event_types) > 0 AND event_types <@ ARRAY[
      'project.created', 'project.updated', 'task.created', 'task.updated',
      'task.moved', 'task.removed', 'comment.created'
    ]::text[]
  ),
  secret_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_webhook_subscription_project_idx
  ON public.work_webhook_subscription (project_id, status);

CREATE TABLE IF NOT EXISTS public.work_webhook_delivery (
  work_webhook_delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_webhook_subscription_id uuid NOT NULL
    REFERENCES public.work_webhook_subscription(work_webhook_subscription_id)
    ON DELETE CASCADE,
  event_type text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('project', 'task', 'comment')),
  resource_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'retry', 'delivered', 'failed', 'suppressed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  response_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_webhook_delivery_due_idx
  ON public.work_webhook_delivery (status, next_attempt_at);

CREATE OR REPLACE FUNCTION public.enqueue_work_webhook_event(
  event_project_id uuid,
  event_type text,
  event_resource_type text,
  event_resource_id uuid,
  event_payload jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.work_webhook_delivery (
    work_webhook_subscription_id, event_type, resource_type, resource_id, payload
  )
  SELECT subscription.work_webhook_subscription_id, event_type,
    event_resource_type, event_resource_id,
    event_payload || jsonb_build_object(
      'projectId', event_project_id,
      'eventType', event_type,
      'resourceType', event_resource_type,
      'resourceId', event_resource_id,
      'occurredAt', now()
    )
  FROM public.work_webhook_subscription subscription
  WHERE subscription.project_id = event_project_id
    AND subscription.status = 'active'
    AND event_type = ANY(subscription.event_types);
$$;

CREATE OR REPLACE FUNCTION public.queue_work_webhook_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  membership record;
  project_id uuid;
  resource_id uuid;
  event_name text;
  resource_name text;
BEGIN
  IF TG_TABLE_NAME = 'work_project' THEN
    project_id := COALESCE(NEW.work_project_id, OLD.work_project_id);
    resource_id := project_id;
    event_name := CASE WHEN TG_OP = 'INSERT' THEN 'project.created' ELSE 'project.updated' END;
    resource_name := 'project';
    PERFORM public.enqueue_work_webhook_event(
      project_id, event_name, resource_name, resource_id, '{}'::jsonb
    );
  ELSIF TG_TABLE_NAME = 'work_project_item' THEN
    project_id := COALESCE(NEW.work_project_id, OLD.work_project_id);
    resource_id := COALESCE(NEW.work_item_id, OLD.work_item_id);
    event_name := CASE TG_OP
      WHEN 'INSERT' THEN 'task.created'
      WHEN 'DELETE' THEN 'task.removed'
      ELSE 'task.moved'
    END;
    PERFORM public.enqueue_work_webhook_event(
      project_id, event_name, 'task', resource_id, '{}'::jsonb
    );
  ELSIF TG_TABLE_NAME = 'work_item' THEN
    FOR membership IN
      SELECT work_project_id FROM public.work_project_item
      WHERE work_item_id = COALESCE(NEW.work_item_id, OLD.work_item_id)
    LOOP
      PERFORM public.enqueue_work_webhook_event(
        membership.work_project_id, 'task.updated', 'task',
        COALESCE(NEW.work_item_id, OLD.work_item_id), '{}'::jsonb
      );
    END LOOP;
  ELSIF TG_TABLE_NAME = 'work_comment' THEN
    FOR membership IN
      SELECT work_project_id FROM public.work_project_item
      WHERE work_item_id = NEW.work_item_id
    LOOP
      PERFORM public.enqueue_work_webhook_event(
        membership.work_project_id, 'comment.created', 'comment',
        NEW.work_comment_id, jsonb_build_object('taskId', NEW.work_item_id)
      );
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_work_webhook_event(uuid, text, text, uuid, jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_work_webhook_event() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.enqueue_work_webhook_event(uuid, text, text, uuid, jsonb)
      FROM anon;
    REVOKE ALL ON FUNCTION public.queue_work_webhook_event() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.enqueue_work_webhook_event(uuid, text, text, uuid, jsonb)
      FROM authenticated;
    REVOKE ALL ON FUNCTION public.queue_work_webhook_event() FROM authenticated;
  END IF;
END $$;

DROP TRIGGER IF EXISTS work_project_webhook_event ON public.work_project;
CREATE TRIGGER work_project_webhook_event
  AFTER INSERT OR UPDATE ON public.work_project
  FOR EACH ROW EXECUTE FUNCTION public.queue_work_webhook_event();

DROP TRIGGER IF EXISTS work_project_item_webhook_event ON public.work_project_item;
CREATE TRIGGER work_project_item_webhook_event
  AFTER INSERT OR UPDATE OR DELETE ON public.work_project_item
  FOR EACH ROW EXECUTE FUNCTION public.queue_work_webhook_event();

DROP TRIGGER IF EXISTS work_item_webhook_event ON public.work_item;
CREATE TRIGGER work_item_webhook_event
  AFTER UPDATE ON public.work_item
  FOR EACH ROW EXECUTE FUNCTION public.queue_work_webhook_event();

DROP TRIGGER IF EXISTS work_comment_webhook_event ON public.work_comment;
CREATE TRIGGER work_comment_webhook_event
  AFTER INSERT ON public.work_comment
  FOR EACH ROW EXECUTE FUNCTION public.queue_work_webhook_event();

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_api_token',
    'work_webhook_subscription',
    'work_webhook_delivery'
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
