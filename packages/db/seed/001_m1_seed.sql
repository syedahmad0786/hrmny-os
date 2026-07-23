-- M1 seed: roles, permission_policy (AM deny margin), demo employees, sample deal
-- Safe to re-run with ON CONFLICT where unique keys exist.

INSERT INTO role (role_id, key, display_name)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'partner', 'Partner'),
  ('a0000000-0000-4000-8000-000000000002', 'finance', 'Finance'),
  ('a0000000-0000-4000-8000-000000000003', 'am', 'Account Manager'),
  ('a0000000-0000-4000-8000-000000000004', 'director', 'Director'),
  ('a0000000-0000-4000-8000-000000000005', 'creative', 'Creative'),
  ('a0000000-0000-4000-8000-000000000006', 'developer', 'Developer')
ON CONFLICT (key) DO NOTHING;

-- permission_policy: explicit deny margin for AM; allow for partner/finance
INSERT INTO permission_policy (permission_policy_id, role_id, resource, action, effect)
SELECT 'b0000000-0000-4000-8000-000000000001', role_id, 'margin', 'view', 'deny'
FROM role WHERE key = 'am'
ON CONFLICT DO NOTHING;

INSERT INTO permission_policy (permission_policy_id, role_id, resource, action, effect)
SELECT 'b0000000-0000-4000-8000-000000000002', role_id, 'margin', 'view', 'allow'
FROM role WHERE key = 'partner'
ON CONFLICT DO NOTHING;

INSERT INTO permission_policy (permission_policy_id, role_id, resource, action, effect)
SELECT 'b0000000-0000-4000-8000-000000000003', role_id, 'margin', 'view', 'allow'
FROM role WHERE key = 'finance'
ON CONFLICT DO NOTHING;

INSERT INTO permission_policy (permission_policy_id, role_id, resource, action, effect)
SELECT v.permission_policy_id::uuid, r.role_id, 'deal', 'transition', 'allow'
FROM (
  VALUES
    ('b0000000-0000-4000-8000-000000000004', 'partner'),
    ('b0000000-0000-4000-8000-000000000005', 'am'),
    ('b0000000-0000-4000-8000-000000000006', 'finance'),
    ('b0000000-0000-4000-8000-000000000007', 'director')
) AS v(permission_policy_id, role_key)
JOIN role r ON r.key = v.role_key
ON CONFLICT DO NOTHING;

INSERT INTO permission_policy (permission_policy_id, role_id, resource, action, effect)
SELECT v.permission_policy_id::uuid, r.role_id, 'audit', 'view', 'allow'
FROM (
  VALUES
    ('b0000000-0000-4000-8000-000000000010', 'partner'),
    ('b0000000-0000-4000-8000-000000000011', 'finance'),
    ('b0000000-0000-4000-8000-000000000012', 'director'),
    ('b0000000-0000-4000-8000-000000000013', 'developer')
) AS v(permission_policy_id, role_key)
JOIN role r ON r.key = v.role_key
ON CONFLICT DO NOTHING;

-- Demo employees (dev auth uses these emails)
INSERT INTO employee (employee_id, display_name, email, lifecycle_status, is_active)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Dev Partner', 'partner@hrmny.local', 'active', true),
  ('c0000000-0000-4000-8000-000000000002', 'Dev AM', 'am@hrmny.local', 'active', true),
  ('c0000000-0000-4000-8000-000000000003', 'Dev Finance', 'finance@hrmny.local', 'active', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO employee_role (employee_role_id, employee_id, role_id)
SELECT 'd0000000-0000-4000-8000-000000000001', e.employee_id, r.role_id
FROM employee e, role r
WHERE e.email = 'partner@hrmny.local' AND r.key = 'partner'
ON CONFLICT DO NOTHING;

INSERT INTO employee_role (employee_role_id, employee_id, role_id)
SELECT 'd0000000-0000-4000-8000-000000000002', e.employee_id, r.role_id
FROM employee e, role r
WHERE e.email = 'am@hrmny.local' AND r.key = 'am'
ON CONFLICT DO NOTHING;

INSERT INTO employee_role (employee_role_id, employee_id, role_id)
SELECT 'd0000000-0000-4000-8000-000000000003', e.employee_id, r.role_id
FROM employee e, role r
WHERE e.email = 'finance@hrmny.local' AND r.key = 'finance'
ON CONFLICT DO NOTHING;

-- Sample deal for gate demo
INSERT INTO deal (
  deal_id, company_name, sector, stage, lead_source_lane,
  quote_value, internal_cost, margin_pct, vendor_handling_fee_pct, owner_employee_id
)
VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'Demo Co LLC',
  'Hospitality',
  'discover',
  'relationship_led',
  '50000.00',
  '30000.00',
  '40.00',
  '20.00',
  'c0000000-0000-4000-8000-000000000002'
)
ON CONFLICT (deal_id) DO NOTHING;

-- Convention placeholder for health signals
INSERT INTO convention (convention_id, rule_key, version, payload, is_active)
VALUES (
  'f0000000-0000-4000-8000-000000000001',
  'health.signals',
  1,
  '{"signals":["gate_blocked","auth_denied","dam_upload","spend_cap","job_lag"]}'::jsonb,
  true
)
ON CONFLICT DO NOTHING;
