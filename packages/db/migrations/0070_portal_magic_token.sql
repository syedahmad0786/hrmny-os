-- Durable single-use portal magic-link tokens (dev/demo when Supabase OTP unused).
CREATE TABLE IF NOT EXISTS public.portal_magic_token (
  portal_magic_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  client_id uuid NOT NULL REFERENCES public.client(client_id),
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_magic_token_hash_uniq UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS portal_magic_token_client_idx
  ON public.portal_magic_token (client_id);

ALTER TABLE public.portal_magic_token ENABLE ROW LEVEL SECURITY;
