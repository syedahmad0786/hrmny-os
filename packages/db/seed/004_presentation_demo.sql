-- Presentation-only data. Safe to re-run; existing approval decisions are preserved.

INSERT INTO public.company (company_id, name, sector, market, website, notes)
VALUES (
  '11000000-0000-4000-8000-000000000020',
  'Demo Co',
  'Consumer',
  'UAE',
  'https://example.com',
  'Non-sensitive presentation account'
)
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO public.contact (
  contact_id, company_id, first_name, last_name, email, title,
  email_verified, is_primary
)
VALUES (
  '12000000-0000-4000-8000-000000000020',
  '11000000-0000-4000-8000-000000000020',
  'Alex',
  'Morgan',
  'presenter@democo.example',
  'Marketing Lead',
  true,
  true
)
ON CONFLICT (contact_id) DO NOTHING;

INSERT INTO public.deal (
  deal_id, company_id, primary_contact_id, company_name, sector, stage,
  close_outcome, lead_source_lane, buaf_budget, buaf_urgency,
  buaf_access, buaf_fit, buaf_temperature, email_verified
)
VALUES (
  'e0000000-0000-4000-8000-000000000020',
  '11000000-0000-4000-8000-000000000020',
  '12000000-0000-4000-8000-000000000020',
  'Demo Co',
  'Consumer',
  'handover_pack',
  'won',
  'relationship_led',
  true,
  true,
  true,
  true,
  'hot',
  true
)
ON CONFLICT (deal_id) DO NOTHING;

INSERT INTO public.client (
  client_id, deal_id, name, market, engagement_type,
  lifecycle_status, contacts, approvers
)
VALUES (
  'c1000000-0000-4000-8000-0000000000a4',
  'e0000000-0000-4000-8000-000000000020',
  'Demo Co',
  'UAE',
  'project',
  'active',
  '{"primary":"presenter@democo.example"}'::jsonb,
  '{"marketing":"Alex Morgan"}'::jsonb
)
ON CONFLICT (client_id) DO NOTHING;

INSERT INTO public.client_portal_user (
  client_portal_user_id, client_id, email, display_name, is_active
)
VALUES (
  'c2000000-0000-4000-8000-0000000000a1',
  'c1000000-0000-4000-8000-0000000000a4',
  'presenter@democo.example',
  'Alex Morgan',
  true
)
ON CONFLICT (client_portal_user_id) DO NOTHING;

INSERT INTO public.task (
  task_id, client_id, month, task_type, status, deadline, priority
)
VALUES
  (
    '71000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-0000000000a4',
    to_char(current_date, 'YYYY-MM'),
    'launch_film',
    'client_review',
    current_date + 2,
    'P1'
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-0000000000a4',
    to_char(current_date, 'YYYY-MM'),
    'social_cutdowns',
    'in_production',
    current_date + 5,
    'P2'
  ),
  (
    '71000000-0000-4000-8000-000000000003',
    'c1000000-0000-4000-8000-0000000000a4',
    to_char(current_date, 'YYYY-MM'),
    'campaign_brief',
    'delivered',
    current_date - 2,
    'P2'
  )
ON CONFLICT (task_id) DO NOTHING;

INSERT INTO public.brief (
  brief_id, task_id, body, dor_complete, missing_required_count, locked_at
)
VALUES
  (
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    '{"title":"Launch film — final cut","objective":"Introduce the campaign","audience":"UAE customers","channels":["Web","Instagram"]}'::jsonb,
    true,
    0,
    now() - interval '4 days'
  ),
  (
    '72000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000002',
    '{"title":"Social cutdowns","objective":"Extend campaign reach","deliverables":["9:16 reel","1:1 post"]}'::jsonb,
    true,
    0,
    now() - interval '2 days'
  ),
  (
    '72000000-0000-4000-8000-000000000003',
    '71000000-0000-4000-8000-000000000003',
    '{"title":"Campaign brief","objective":"Align launch stakeholders"}'::jsonb,
    true,
    0,
    now() - interval '8 days'
  )
ON CONFLICT (brief_id) DO NOTHING;

INSERT INTO public.asset (
  asset_id, task_id, client_id, title, status
)
VALUES (
  '73000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-0000000000a4',
  'Launch film — final cut',
  'client_review'
)
ON CONFLICT (asset_id) DO NOTHING;

INSERT INTO public.asset_version (
  asset_version_id, asset_id, storage_path, version_number,
  is_client_revision, uploaded_by_employee_id
)
SELECT
  '74000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  'presentation/demo-co/launch-film-v1.mp4',
  1,
  false,
  e.employee_id
FROM public.employee e
WHERE lower(e.email) = 'developer@hrmny.co'
ON CONFLICT (asset_version_id) DO NOTHING;

INSERT INTO public.audit_event (
  audit_event_id, actor_employee_id, action, entity_type, entity_id, after
)
SELECT
  '75000000-0000-4000-8000-000000000001',
  e.employee_id,
  'presentation.seed',
  'client',
  'c1000000-0000-4000-8000-0000000000a4',
  '{"client":"Demo Co","sensitive":false}'::jsonb
FROM public.employee e
WHERE lower(e.email) = 'developer@hrmny.co'
ON CONFLICT (audit_event_id) DO NOTHING;
