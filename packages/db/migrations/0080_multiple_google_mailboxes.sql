-- Preserve one connection per employee/provider except personal Google mailboxes.
-- Create both replacement guarantees before removing the former broader index.
CREATE UNIQUE INDEX IF NOT EXISTS connection_account_staff_provider_uniq
  ON public.connection_account (owner_employee_id, toolkit, scope)
  WHERE owner_employee_id IS NOT NULL AND NOT (toolkit = 'google_workspace' AND scope = 'staff');
CREATE UNIQUE INDEX IF NOT EXISTS connection_account_google_mailbox_uniq
  ON public.connection_account (owner_employee_id, lower(btrim(coalesce(external_connection_id, ''))))
  WHERE owner_employee_id IS NOT NULL AND toolkit = 'google_workspace' AND scope = 'staff';
DROP INDEX IF EXISTS public.connection_account_staff_toolkit_uniq;
