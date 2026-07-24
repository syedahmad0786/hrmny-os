ALTER TABLE public.work_rule
  DROP CONSTRAINT IF EXISTS work_rule_trigger_type_check,
  ADD CONSTRAINT work_rule_trigger_type_check CHECK (trigger_type IN (
    'task_added', 'task_completed', 'task_moved', 'priority_changed',
    'due_date_set', 'approval_decided', 'custom_status_changed',
    'collaborator_added', 'scheduled'
  ));

ALTER TABLE public.work_ai_studio_workflow
  DROP CONSTRAINT IF EXISTS work_ai_studio_workflow_trigger_type_check,
  ADD CONSTRAINT work_ai_studio_workflow_trigger_type_check
    CHECK (trigger_type IN (
      'manual', 'task_added', 'task_completed', 'task_moved',
      'priority_changed', 'due_date_set', 'approval_decided',
      'custom_status_changed', 'scheduled'
    )),
  DROP CONSTRAINT IF EXISTS work_ai_studio_workflow_allowed_action_types_check,
  ADD CONSTRAINT work_ai_studio_workflow_allowed_action_types_check
    CHECK (allowed_action_types <@ ARRAY[
      'create_task',
      'update_task',
      'create_comment',
      'create_status',
      'create_goal',
      'create_custom_field',
      'create_rule',
      'create_project',
      'delete_task',
      'create_subtask',
      'set_custom_field',
      'set_custom_task_status',
      'add_to_project',
      'add_follower',
      'remove_follower',
      'create_section',
      'update_section',
      'bulk_update_tasks',
      'add_dependency',
      'create_milestone',
      'attach_file'
    ]::text[]);

ALTER TABLE public.work_ai_teammate
  DROP CONSTRAINT IF EXISTS work_ai_teammate_allowed_action_types_check,
  ADD CONSTRAINT work_ai_teammate_allowed_action_types_check
    CHECK (allowed_action_types <@ ARRAY[
      'create_task',
      'update_task',
      'create_comment',
      'create_project',
      'delete_task',
      'create_subtask',
      'set_custom_field',
      'set_custom_task_status',
      'add_to_project',
      'add_follower',
      'remove_follower',
      'create_section',
      'update_section',
      'bulk_update_tasks',
      'add_dependency',
      'create_milestone',
      'attach_file',
      'schedule_follow_up',
      'create_external_file'
    ]::text[]);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_rule',
    'work_ai_studio_workflow',
    'work_ai_teammate'
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
