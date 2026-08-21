-- Multi-use portal session grants issued after magic-link verify (demo + OTP stub).
CREATE TABLE IF NOT EXISTS public.portal_session_grant (
  portal_session_grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  client_id uuid NOT NULL REFERENCES public.client(client_id),
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_session_grant_hash_uniq UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS portal_session_grant_client_idx
  ON public.portal_session_grant (client_id);

ALTER TABLE public.portal_session_grant ENABLE ROW LEVEL SECURITY;
