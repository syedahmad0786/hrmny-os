-- Slot 0063 (0062 + 0064-0065 belong to sibling branches; appended after the
-- current main tail 0061 — orchestrator adjudicates the final ordering on
-- rebase). Consolidated portal proofing feedback: one thread per campaign item,
-- shared between staff and the item's single client.
CREATE TABLE IF NOT EXISTS public.portal_feedback (
  portal_feedback_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_item_id uuid NOT NULL
    REFERENCES public.campaign_items(campaign_item_id) ON DELETE CASCADE,
  author_kind text NOT NULL CHECK (author_kind IN ('staff', 'client')),
  author_id uuid,
  -- Scoping spine: always the item's client_id, so a portal client sees only
  -- their own threads and every staff comment on them.
  client_id uuid,
  body text NOT NULL,
  -- Proofing position (page/coords/version), or null for a plain thread comment.
  anchor jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_feedback_item_idx
  ON public.portal_feedback (campaign_item_id, created_at);
CREATE INDEX IF NOT EXISTS portal_feedback_client_idx
  ON public.portal_feedback (client_id);

-- Lock away from the browser Data API (anon/authenticated); server role only.
DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'portal_feedback'
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
