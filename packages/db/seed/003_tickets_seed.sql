-- Optional demo tickets (safe to re-run: inserts only if none exist)
-- Requires employee + company rows from earlier seeds.

DO $$
DECLARE
  emp uuid;
  co uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM ticket LIMIT 1) THEN
    RETURN;
  END IF;

  SELECT employee_id INTO emp FROM employee LIMIT 1;
  SELECT company_id INTO co FROM company LIMIT 1;

  IF emp IS NULL THEN
    RAISE NOTICE '003_tickets_seed: no employee — skip';
    RETURN;
  END IF;

  INSERT INTO ticket (
    subject, body, status, priority, requester_type,
    requester_employee_id, assignee_employee_id, company_id,
    ai_classification
  ) VALUES
  (
    'Portal access for new client contact',
    'Please enable magic-link access for the new approver.',
    'triaged',
    'medium',
    'employee',
    emp,
    emp,
    co,
    'access_request'
  ),
  (
    'Invoice copy request (internal)',
    'Client asked for a PDF of last month invoice — route to finance.',
    'new',
    'high',
    'employee',
    emp,
    NULL,
    co,
    'finance_routing'
  );
END $$;
