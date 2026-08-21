-- Durable client onboarding phases (prospect → sales → onboarding SoT).
CREATE TABLE IF NOT EXISTS client_onboarding (
  client_id uuid PRIMARY KEY REFERENCES public.client (client_id) ON DELETE CASCADE,
  phases jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE client_onboarding IS 'Month-1 onboarding checklist per client; phases jsonb matches demo seed shape.';
