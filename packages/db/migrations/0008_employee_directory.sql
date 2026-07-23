ALTER TABLE public.employee
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS reports_to_email text;

INSERT INTO public.role (key, display_name)
VALUES
  ('creative_director', 'Creative Director'),
  ('hr', 'HR'),
  ('staff', 'Staff'),
  ('traffic', 'Traffic')
ON CONFLICT (key) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role_id, 'convention', 'edit', 'allow'
FROM public.role
WHERE key IN ('partner', 'director', 'developer')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy policy
    WHERE policy.role_id = role.role_id
      AND policy.resource = 'convention'
      AND policy.action = 'edit'
      AND policy.effect = 'allow'
  );

INSERT INTO public.permission_policy (role_id, resource, action, effect)
SELECT role_id, 'audit', 'view', 'allow'
FROM public.role
WHERE key IN ('creative_director', 'hr', 'traffic')
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_policy policy
    WHERE policy.role_id = role.role_id
      AND policy.resource = 'audit'
      AND policy.action = 'view'
      AND policy.effect = 'allow'
  );
