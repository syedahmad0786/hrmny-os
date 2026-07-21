-- Ticketing module: team support + portal requester seam
-- Distinct from delivery `task` and CRM `crm_task`.
-- Apply via Supabase SQL editor or: psql "$DIRECT_URL" -f packages/db/migrations/0004_tickets.sql

DO $$ BEGIN
  CREATE TYPE ticket_status_enum AS ENUM (
    'new', 'triaged', 'open', 'pending_requester', 'pending_internal', 'resolved', 'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_priority_enum AS ENUM (
    'low', 'medium', 'high', 'urgent'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_requester_type_enum AS ENUM (
    'employee', 'portal_user'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ticket (
  ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body text,
  status ticket_status_enum NOT NULL DEFAULT 'new',
  priority ticket_priority_enum NOT NULL DEFAULT 'medium',
  requester_type ticket_requester_type_enum NOT NULL,
  requester_employee_id uuid REFERENCES employee(employee_id),
  requester_portal_user_id uuid REFERENCES client_portal_user(client_portal_user_id),
  assignee_employee_id uuid REFERENCES employee(employee_id),
  company_id uuid REFERENCES company(company_id),
  deal_id uuid REFERENCES deal(deal_id),
  client_id uuid REFERENCES client(client_id),
  ai_classification text,
  ai_suggested_assignee_id uuid REFERENCES employee(employee_id),
  ai_draft_reply text,
  ai_draft_approved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_status_idx ON ticket(status);
CREATE INDEX IF NOT EXISTS ticket_assignee_idx ON ticket(assignee_employee_id);
CREATE INDEX IF NOT EXISTS ticket_company_idx ON ticket(company_id);
CREATE INDEX IF NOT EXISTS ticket_client_idx ON ticket(client_id);
CREATE INDEX IF NOT EXISTS ticket_deal_idx ON ticket(deal_id);

CREATE TABLE IF NOT EXISTS ticket_comment (
  ticket_comment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES ticket(ticket_id) ON DELETE CASCADE,
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  is_ai_draft boolean NOT NULL DEFAULT false,
  author_employee_id uuid REFERENCES employee(employee_id),
  author_portal_user_id uuid REFERENCES client_portal_user(client_portal_user_id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_comment_ticket_idx ON ticket_comment(ticket_id);
