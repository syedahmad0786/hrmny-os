-- Allow several employee-owned Composio accounts for one toolkit while keeping
-- every remote account bound to at most one local owner row.
DROP INDEX IF EXISTS public.connection_account_staff_provider_uniq;
CREATE UNIQUE INDEX connection_account_staff_provider_uniq
  ON public.connection_account (owner_employee_id, toolkit, scope)
  WHERE owner_employee_id IS NOT NULL
    AND NOT (toolkit = 'google_workspace' AND scope = 'staff')
    AND NOT (toolkit LIKE 'composio:%' AND scope = 'staff');

CREATE UNIQUE INDEX connection_account_composio_remote_uniq
  ON public.connection_account (
    owner_employee_id,
    lower(btrim(external_connection_id))
  )
  WHERE owner_employee_id IS NOT NULL
    AND toolkit LIKE 'composio:%'
    AND scope = 'staff'
    AND btrim(coalesce(external_connection_id, '')) <> '';
