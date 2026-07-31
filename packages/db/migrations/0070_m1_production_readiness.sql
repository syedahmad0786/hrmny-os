ALTER TABLE public.asset
  ADD COLUMN IF NOT EXISTS work_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_work_item_id_work_item_fk'
      AND conrelid = 'public.asset'::regclass
  ) THEN
    ALTER TABLE public.asset
      ADD CONSTRAINT asset_work_item_id_work_item_fk
      FOREIGN KEY (work_item_id)
      REFERENCES public.work_item(work_item_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS asset_work_item_idx
  ON public.asset (work_item_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.employee_role
    GROUP BY employee_id, role_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'employee_role contains duplicate memberships; reconcile before 0070';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS employee_role_employee_role_uniq
  ON public.employee_role (employee_id, role_id);

ALTER TABLE public.health_signal
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS notification_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

UPDATE public.health_signal
SET delivery_status = CASE
  WHEN notified_at IS NOT NULL THEN 'delivered'
  ELSE 'not_configured'
END
WHERE delivery_status = 'not_configured';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'health_signal_delivery_status_check'
      AND conrelid = 'public.health_signal'::regclass
  ) THEN
    ALTER TABLE public.health_signal
      ADD CONSTRAINT health_signal_delivery_status_check
      CHECK (delivery_status IN ('not_configured', 'pending', 'delivered', 'failed'));
  END IF;
END $$;

ALTER TABLE public.health_signal
  DROP CONSTRAINT IF EXISTS health_signal_notification_attempts_check;
ALTER TABLE public.health_signal
  ADD CONSTRAINT health_signal_notification_attempts_check
  CHECK (notification_attempts >= 0 AND notification_attempts <= 3);

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role.role_id, permission.resource, permission.action, 'allow'
FROM public.role role
CROSS JOIN (
  VALUES
    ('role', 'view'),
    ('role', 'manage'),
    ('health', 'view'),
    ('health', 'manage')
) AS permission(resource, action)
WHERE role.key IN ('partner', 'director')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy existing
    WHERE existing.role_id = role.role_id
      AND existing.resource = permission.resource
      AND existing.action = permission.action
      AND existing.effect = 'allow'
  );

ALTER TABLE public.asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_signal ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.asset, public.employee_role, public.health_signal FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.asset, public.employee_role, public.health_signal FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.asset, public.employee_role, public.health_signal FROM authenticated;
