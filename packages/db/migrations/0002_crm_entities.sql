-- CRM entities: company, contact, activity, crm_note, crm_task
-- Plus deal.company_id / deal.primary_contact_id FKs.
-- Apply via Supabase SQL editor or: psql "$DIRECT_URL" -f packages/db/migrations/0002_crm_entities.sql

DO $$ BEGIN
  CREATE TYPE activity_type_enum AS ENUM (
    'note', 'call', 'meeting', 'email', 'stage_change', 'task', 'outreach', 'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE crm_task_status_enum AS ENUM (
    'open', 'in_progress', 'done', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS company (
  company_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sector text,
  market market_enum DEFAULT 'UAE',
  website text,
  linkedin_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact (
  contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES company(company_id),
  first_name text NOT NULL,
  last_name text,
  email text,
  phone text,
  title text,
  linkedin_url text,
  email_verified boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deal ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES company(company_id);
ALTER TABLE deal ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES contact(contact_id);

CREATE TABLE IF NOT EXISTS activity (
  activity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type activity_type_enum NOT NULL,
  subject text,
  body text,
  company_id uuid REFERENCES company(company_id),
  contact_id uuid REFERENCES contact(contact_id),
  deal_id uuid REFERENCES deal(deal_id),
  actor_employee_id uuid REFERENCES employee(employee_id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_note (
  crm_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  company_id uuid REFERENCES company(company_id),
  contact_id uuid REFERENCES contact(contact_id),
  deal_id uuid REFERENCES deal(deal_id),
  author_employee_id uuid REFERENCES employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_task (
  crm_task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  status crm_task_status_enum NOT NULL DEFAULT 'open',
  due_date date,
  company_id uuid REFERENCES company(company_id),
  contact_id uuid REFERENCES contact(contact_id),
  deal_id uuid REFERENCES deal(deal_id),
  owner_employee_id uuid REFERENCES employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_name_idx ON company (name);
CREATE INDEX IF NOT EXISTS contact_company_idx ON contact (company_id);
CREATE INDEX IF NOT EXISTS contact_email_idx ON contact (email);
CREATE INDEX IF NOT EXISTS deal_company_idx ON deal (company_id);
CREATE INDEX IF NOT EXISTS deal_stage_idx ON deal (stage);
CREATE INDEX IF NOT EXISTS activity_deal_idx ON activity (deal_id);
CREATE INDEX IF NOT EXISTS activity_company_idx ON activity (company_id);
CREATE INDEX IF NOT EXISTS activity_occurred_idx ON activity (occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_task_deal_idx ON crm_task (deal_id);
CREATE INDEX IF NOT EXISTS crm_task_status_idx ON crm_task (status);
