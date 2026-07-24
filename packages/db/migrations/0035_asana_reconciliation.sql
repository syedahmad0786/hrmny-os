ALTER TABLE public.work_project
  ADD COLUMN IF NOT EXISTS source_workspace_external_id text,
  ADD COLUMN IF NOT EXISTS source_connection_external_id text;
ALTER TABLE public.work_item
  ADD COLUMN IF NOT EXISTS source_workspace_external_id text,
  ADD COLUMN IF NOT EXISTS source_connection_external_id text;
ALTER TABLE public.work_team
  ADD COLUMN IF NOT EXISTS source_workspace_external_id text,
  ADD COLUMN IF NOT EXISTS source_connection_external_id text;
ALTER TABLE public.work_goal
  ADD COLUMN IF NOT EXISTS source_workspace_external_id text,
  ADD COLUMN IF NOT EXISTS source_connection_external_id text;
ALTER TABLE public.work_portfolio
  ADD COLUMN IF NOT EXISTS source_workspace_external_id text,
  ADD COLUMN IF NOT EXISTS source_connection_external_id text;
ALTER TABLE public.work_template
  ADD COLUMN IF NOT EXISTS source_workspace_external_id text,
  ADD COLUMN IF NOT EXISTS source_connection_external_id text;

CREATE INDEX IF NOT EXISTS work_project_source_workspace_idx
  ON public.work_project (
    source_platform, source_workspace_external_id, source_connection_external_id
  )
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_item_source_workspace_idx
  ON public.work_item (
    source_platform, source_workspace_external_id, source_connection_external_id
  )
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_team_source_workspace_idx
  ON public.work_team (
    source_platform, source_workspace_external_id, source_connection_external_id
  )
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_goal_source_workspace_idx
  ON public.work_goal (
    source_platform, source_workspace_external_id, source_connection_external_id
  )
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_portfolio_source_workspace_idx
  ON public.work_portfolio (
    source_platform, source_workspace_external_id, source_connection_external_id
  )
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_template_source_workspace_idx
  ON public.work_template (
    source_platform, source_workspace_external_id, source_connection_external_id
  )
  WHERE external_id IS NOT NULL;

ALTER TABLE public.work_project_member
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_team_member
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_team_project
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_portfolio_project
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_project_item
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_item_dependency
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_item_follower
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_item_tag
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.work_custom_field_value
  ADD COLUMN IF NOT EXISTS source_platform text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_id text;

UPDATE public.work_project_member member
SET source_platform = 'asana',
  external_id = 'legacy:' || member.work_project_member_id::text
FROM public.work_project project
WHERE member.work_project_id = project.work_project_id
  AND project.source_platform = 'asana'
  AND member.external_id IS NULL;
UPDATE public.work_team_member member
SET source_platform = 'asana',
  external_id = 'legacy:' || member.work_team_member_id::text
FROM public.work_team team
WHERE member.work_team_id = team.work_team_id
  AND team.source_platform = 'asana'
  AND member.external_id IS NULL;
UPDATE public.work_team_project link
SET source_platform = 'asana',
  external_id = 'legacy:' || link.work_team_project_id::text
FROM public.work_team team, public.work_project project
WHERE link.work_team_id = team.work_team_id
  AND link.work_project_id = project.work_project_id
  AND (team.source_platform = 'asana' OR project.source_platform = 'asana')
  AND link.external_id IS NULL;
UPDATE public.work_portfolio_project link
SET source_platform = 'asana',
  external_id = 'legacy:' || link.work_portfolio_id::text || ':' || link.work_project_id::text
FROM public.work_portfolio portfolio
WHERE link.work_portfolio_id = portfolio.work_portfolio_id
  AND portfolio.source_platform = 'asana'
  AND link.external_id IS NULL;
UPDATE public.work_project_item link
SET source_platform = 'asana',
  external_id = 'legacy:' || link.work_project_item_id::text
FROM public.work_project project, public.work_item item
WHERE link.work_project_id = project.work_project_id
  AND link.work_item_id = item.work_item_id
  AND project.source_platform = 'asana'
  AND item.source_platform = 'asana'
  AND link.external_id IS NULL;
UPDATE public.work_item_dependency dependency
SET source_platform = 'asana',
  external_id = 'legacy:' || dependency.work_item_dependency_id::text
FROM public.work_item item
WHERE dependency.work_item_id = item.work_item_id
  AND item.source_platform = 'asana'
  AND dependency.external_id IS NULL;
UPDATE public.work_item_follower follower
SET source_platform = 'asana',
  external_id = 'legacy:' || follower.work_item_follower_id::text
FROM public.work_item item
WHERE follower.work_item_id = item.work_item_id
  AND item.source_platform = 'asana'
  AND follower.external_id IS NULL;
UPDATE public.work_item_tag link
SET source_platform = 'asana',
  external_id = 'legacy:' || link.work_item_tag_id::text
FROM public.work_item item
WHERE link.work_item_id = item.work_item_id
  AND item.source_platform = 'asana'
  AND link.external_id IS NULL;
UPDATE public.work_custom_field_value value
SET source_platform = 'asana',
  external_id = 'legacy:' || value.work_custom_field_value_id::text
FROM public.work_custom_field field
WHERE value.work_custom_field_id = field.work_custom_field_id
  AND field.source_platform = 'asana'
  AND value.external_id IS NULL;

DO $$
DECLARE
  app_table text;
  constraint_name text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_project_member', 'work_team_member', 'work_team_project',
    'work_portfolio_project', 'work_project_item', 'work_item_dependency',
    'work_item_follower', 'work_item_tag', 'work_custom_field_value'
  ]::text[] LOOP
    constraint_name := app_table || '_source_platform_check';
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      app_table, constraint_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (source_platform IN (''native'', ''asana''))',
      app_table, constraint_name
    );
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS work_project_member_source_external_uniq
  ON public.work_project_member (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_team_member_source_external_uniq
  ON public.work_team_member (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_team_project_source_external_uniq
  ON public.work_team_project (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_portfolio_project_source_external_uniq
  ON public.work_portfolio_project (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_project_item_source_external_uniq
  ON public.work_project_item (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_item_dependency_source_external_uniq
  ON public.work_item_dependency (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_item_follower_source_external_uniq
  ON public.work_item_follower (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_item_tag_source_external_uniq
  ON public.work_item_tag (source_platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_custom_field_value_source_external_uniq
  ON public.work_custom_field_value (source_platform, external_id)
  WHERE external_id IS NOT NULL;

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'work_project', 'work_item', 'work_team', 'work_goal', 'work_portfolio',
    'work_template', 'work_project_member', 'work_team_member',
    'work_team_project', 'work_portfolio_project', 'work_project_item',
    'work_item_dependency', 'work_item_follower', 'work_item_tag',
    'work_custom_field_value'
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
