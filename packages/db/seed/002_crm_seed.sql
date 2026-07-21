-- CRM demo seed: companies, contacts, deals across stages, activities, notes, tasks
-- Depends on 001_m1_seed.sql (employees) and 0002_crm_entities.sql

INSERT INTO company (company_id, name, sector, market, website, notes)
VALUES
  ('11000000-0000-4000-8000-000000000001', 'JW Marriott Marquis Dubai', 'Hospitality', 'UAE', 'https://www.marriott.com', 'Key hospitality account — brand film pipeline'),
  ('11000000-0000-4000-8000-000000000002', 'Emaar Hospitality Group', 'Real Estate / Hospitality', 'UAE', 'https://www.emaar.com', 'Relationship-led intro via partner network'),
  ('11000000-0000-4000-8000-000000000003', 'Al Baik Expansion Co', 'F&B', 'KSA', NULL, 'Apollo intent signal — KSA market'),
  ('11000000-0000-4000-8000-000000000004', 'Tejari Procurement Desk', 'Public / Procurement', 'UAE', NULL, 'Tejari RFP lane stub')
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO contact (contact_id, company_id, first_name, last_name, email, title, email_verified, is_primary)
VALUES
  ('12000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Layla', 'Hassan', 'layla.hassan@example-jwmm.ae', 'Brand Manager', true, true),
  ('12000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'Omar', 'Al Falasi', 'omar.alfalasi@example-emaar.ae', 'Marketing Director', false, true),
  ('12000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', 'Noura', 'Al Qahtani', 'noura@example-albaik.sa', 'Growth Lead', false, true),
  ('12000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000004', 'Procurement', 'Inbox', 'rfp@example-tejari.ae', 'RFP Desk', false, true)
ON CONFLICT (contact_id) DO NOTHING;

-- Link existing demo deal + add pipeline sample deals
UPDATE deal
SET company_id = '11000000-0000-4000-8000-000000000001',
    primary_contact_id = '12000000-0000-4000-8000-000000000001',
    company_name = 'JW Marriott Marquis Dubai',
    sector = 'Hospitality'
WHERE deal_id = 'e0000000-0000-4000-8000-000000000001';

INSERT INTO deal (
  deal_id, company_id, primary_contact_id, company_name, sector, stage,
  lead_source_lane, buaf_budget, buaf_urgency, buaf_access, buaf_fit, buaf_temperature,
  email_verified, quote_value, internal_cost, margin_pct, vendor_handling_fee_pct, owner_employee_id
)
VALUES
  (
    'e0000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000002',
    'Emaar Hospitality Group',
    'Real Estate / Hospitality',
    'engage',
    'relationship_led',
    true, true, true, true, 'hot',
    false, '120000.00', '72000.00', '40.00', '20.00',
    'c0000000-0000-4000-8000-000000000002'
  ),
  (
    'e0000000-0000-4000-8000-000000000003',
    '11000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000003',
    'Al Baik Expansion Co',
    'F&B',
    'qualify',
    'apollo_intent',
    true, false, true, true, 'warm',
    false, '45000.00', '28000.00', '37.78', '20.00',
    'c0000000-0000-4000-8000-000000000002'
  ),
  (
    'e0000000-0000-4000-8000-000000000004',
    '11000000-0000-4000-8000-000000000004',
    '12000000-0000-4000-8000-000000000004',
    'Tejari Procurement Desk',
    'Public / Procurement',
    'discover',
    'tejari',
    false, false, false, false, NULL,
    false, '0.00', '0.00', '0.00', '20.00',
    'c0000000-0000-4000-8000-000000000001'
  ),
  (
    'e0000000-0000-4000-8000-000000000005',
    '11000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'JW Marriott Marquis Dubai',
    'Hospitality',
    'propose',
    'relationship_led',
    true, true, true, true, 'hot',
    true, '85000.00', '48000.00', '43.53', '20.00',
    'c0000000-0000-4000-8000-000000000002'
  )
ON CONFLICT (deal_id) DO NOTHING;

INSERT INTO activity (activity_id, type, subject, body, company_id, contact_id, deal_id, actor_employee_id, occurred_at)
VALUES
  (
    '13000000-0000-4000-8000-000000000001',
    'call',
    'Discovery call — JWMM brand film',
    'Discussed enhancement program film scope and timeline.',
    '11000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000002',
    now() - interval '3 days'
  ),
  (
    '13000000-0000-4000-8000-000000000002',
    'email',
    'Intro email — Emaar',
    'Warm intro sent; waiting on brand guidelines.',
    '11000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000002',
    now() - interval '1 day'
  ),
  (
    '13000000-0000-4000-8000-000000000003',
    'stage_change',
    'Moved to engage',
    'BUAF hot; advancing to engage.',
    '11000000-0000-4000-8000-000000000002',
    NULL,
    'e0000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000002',
    now() - interval '12 hours'
  )
ON CONFLICT (activity_id) DO NOTHING;

INSERT INTO crm_note (crm_note_id, body, company_id, deal_id, author_employee_id)
VALUES
  (
    '14000000-0000-4000-8000-000000000001',
    'Client prefers Arabic subtitles on social cutdowns; confirm in scope.',
    '11000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000005',
    'c0000000-0000-4000-8000-000000000002'
  ),
  (
    '14000000-0000-4000-8000-000000000002',
    'Apollo list quality mixed — verify emails before outreach.',
    '11000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000003',
    'c0000000-0000-4000-8000-000000000001'
  )
ON CONFLICT (crm_note_id) DO NOTHING;

INSERT INTO crm_task (crm_task_id, title, status, due_date, company_id, deal_id, owner_employee_id)
VALUES
  (
    '15000000-0000-4000-8000-000000000001',
    'Send revised JWMM proposal deck',
    'open',
    (current_date + 2),
    '11000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000005',
    'c0000000-0000-4000-8000-000000000002'
  ),
  (
    '15000000-0000-4000-8000-000000000002',
    'Book discovery with Omar (Emaar)',
    'in_progress',
    (current_date + 5),
    '11000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000002'
  ),
  (
    '15000000-0000-4000-8000-000000000003',
    'Verify Noura email via Hunter stub',
    'open',
    (current_date + 1),
    '11000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000003',
    'c0000000-0000-4000-8000-000000000001'
  )
ON CONFLICT (crm_task_id) DO NOTHING;
