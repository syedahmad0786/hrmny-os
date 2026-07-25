ALTER TABLE public.work_team
  ADD COLUMN IF NOT EXISTS message_send_permission text NOT NULL DEFAULT 'members'
    CHECK (message_send_permission IN ('admins', 'members'));

CREATE TABLE IF NOT EXISTS public.work_message (
  work_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_project_id uuid REFERENCES public.work_project(work_project_id) ON DELETE CASCADE,
  work_team_id uuid REFERENCES public.work_team(work_team_id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 300),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 50000),
  is_announcement boolean NOT NULL DEFAULT false,
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(work_project_id, work_team_id) = 1)
);

CREATE INDEX IF NOT EXISTS work_message_project_created_idx
  ON public.work_message (work_project_id, created_at DESC)
  WHERE work_project_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS work_message_team_created_idx
  ON public.work_message (work_team_id, created_at DESC)
  WHERE work_team_id IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.work_message_comment (
  work_message_comment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_message_id uuid NOT NULL
    REFERENCES public.work_message(work_message_id) ON DELETE CASCADE,
  author_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_message_comment_message_created_idx
  ON public.work_message_comment (work_message_id, created_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.work_message_follower (
  work_message_id uuid NOT NULL
    REFERENCES public.work_message(work_message_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_message_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.work_like (
  work_like_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  work_comment_id uuid REFERENCES public.work_comment(work_comment_id) ON DELETE CASCADE,
  work_attachment_id uuid REFERENCES public.work_attachment(work_attachment_id) ON DELETE CASCADE,
  work_status_update_id uuid
    REFERENCES public.work_status_update(work_status_update_id) ON DELETE CASCADE,
  work_message_id uuid REFERENCES public.work_message(work_message_id) ON DELETE CASCADE,
  work_message_comment_id uuid
    REFERENCES public.work_message_comment(work_message_comment_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(
    work_item_id, work_comment_id, work_attachment_id, work_status_update_id,
    work_message_id, work_message_comment_id
  ) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_like_item_employee_uniq
  ON public.work_like (work_item_id, employee_id) WHERE work_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_like_comment_employee_uniq
  ON public.work_like (work_comment_id, employee_id) WHERE work_comment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_like_attachment_employee_uniq
  ON public.work_like (work_attachment_id, employee_id) WHERE work_attachment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_like_status_employee_uniq
  ON public.work_like (work_status_update_id, employee_id)
  WHERE work_status_update_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_like_message_employee_uniq
  ON public.work_like (work_message_id, employee_id) WHERE work_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_like_message_comment_employee_uniq
  ON public.work_like (work_message_comment_id, employee_id)
  WHERE work_message_comment_id IS NOT NULL;

ALTER TABLE public.work_notification
  ADD COLUMN IF NOT EXISTS work_message_id uuid
    REFERENCES public.work_message(work_message_id) ON DELETE CASCADE;
ALTER TABLE public.work_notification
  DROP CONSTRAINT IF EXISTS work_notification_event_type_check,
  ADD CONSTRAINT work_notification_event_type_check CHECK (event_type IN (
    'assigned', 'updated', 'completed', 'commented', 'followed', 'due_soon',
    'message', 'status_update', 'liked'
  ));

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_team', 'work_message', 'work_message_comment',
    'work_message_follower', 'work_like', 'work_notification'
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
