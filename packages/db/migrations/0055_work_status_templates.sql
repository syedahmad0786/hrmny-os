ALTER TABLE public.work_template
  DROP CONSTRAINT IF EXISTS work_template_template_type_check;

ALTER TABLE public.work_template
  ADD CONSTRAINT work_template_template_type_check
  CHECK (template_type IN ('task', 'project', 'status'));
