CREATE TABLE IF NOT EXISTS public.work_proof_annotation (
  work_proof_annotation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_attachment_id uuid NOT NULL
    REFERENCES public.work_attachment(work_attachment_id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL UNIQUE
    REFERENCES public.work_item(work_item_id) ON DELETE CASCADE,
  x_position numeric(8, 6) NOT NULL
    CHECK (x_position >= 0 AND x_position <= 1),
  y_position numeric(8, 6) NOT NULL
    CHECK (y_position >= 0 AND y_position <= 1),
  page_number integer CHECK (page_number IS NULL OR page_number > 0),
  created_by_employee_id uuid NOT NULL
    REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_proof_annotation_attachment_idx
  ON public.work_proof_annotation (work_attachment_id, page_number, created_at);

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY['work_proof_annotation']::text[] LOOP
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
