-- OS modules: notifications, custom agents, chat, creative generations
-- Apply: psql "$DATABASE_URL" -f packages/db/migrations/0068_os_modules.sql

CREATE TABLE IF NOT EXISTS public.os_notification (
  os_notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employee(employee_id),
  title text NOT NULL,
  body text,
  kind text NOT NULL DEFAULT 'info',
  href text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS os_notification_employee_idx
  ON public.os_notification (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS os_notification_unread_idx
  ON public.os_notification (employee_id)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.custom_agent (
  custom_agent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  responsibility text NOT NULL DEFAULT '',
  system_prompt text NOT NULL DEFAULT '',
  model text,
  enabled boolean NOT NULL DEFAULT true,
  produces_drafts boolean NOT NULL DEFAULT true,
  allowed_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_employee_id uuid REFERENCES public.employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_thread (
  chat_thread_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employee(employee_id),
  title text NOT NULL DEFAULT 'Chat',
  agent_slug text,
  client_id uuid REFERENCES public.client(client_id),
  harness text NOT NULL DEFAULT 'react',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_thread_employee_idx
  ON public.chat_thread (employee_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_message (
  chat_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_thread_id uuid NOT NULL REFERENCES public.chat_thread(chat_thread_id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  tool_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_message_thread_idx
  ON public.chat_message (chat_thread_id, created_at);

CREATE TABLE IF NOT EXISTS public.creative_generation (
  creative_generation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employee(employee_id),
  client_id uuid REFERENCES public.client(client_id),
  task_id uuid,
  prompt text NOT NULL,
  model text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  image_url text,
  image_b64 text,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creative_generation_employee_idx
  ON public.creative_generation (employee_id, created_at DESC);

-- Lock away from the browser Data API (anon/authenticated); server role only.
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'os_notification',
    'custom_agent',
    'chat_thread',
    'chat_message',
    'creative_generation'
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
