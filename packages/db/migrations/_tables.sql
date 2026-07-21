CREATE TABLE "account_team_member" (
	"account_team_member_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"account_role" text NOT NULL,
	"is_account_lead" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "airtable_task_mirror" (
	"airtable_task_mirror_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "airtable_task_mirror_external_id_unique" UNIQUE("external_id")
);

CREATE TABLE "asset" (
	"asset_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"client_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "asset_version" (
	"asset_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"version_number" numeric(6, 0) NOT NULL,
	"is_client_revision" boolean DEFAULT false NOT NULL,
	"uploaded_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_event" (
	"audit_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_employee_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "bayzat_employee_mirror" (
	"bayzat_employee_mirror_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bayzat_employee_mirror_external_id_unique" UNIQUE("external_id")
);

CREATE TABLE "brief" (
	"brief_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb,
	"dor_complete" boolean DEFAULT false NOT NULL,
	"missing_required_count" numeric(4, 0) DEFAULT '0',
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brief_task_id_unique" UNIQUE("task_id")
);

CREATE TABLE "calendar" (
	"calendar_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"month" text NOT NULL,
	"focus_points" jsonb DEFAULT '[]'::jsonb,
	"ref_approval_state" text,
	"final_approval_state" text,
	"shoot_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "calendar_slot" (
	"calendar_slot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"slot_date" date NOT NULL,
	"slot_label" text,
	"task_id" uuid,
	"position" numeric(6, 0) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "client" (
	"client_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"market" "market_enum" NOT NULL,
	"engagement_type" "engagement_type_enum" NOT NULL,
	"contract_value" numeric(12, 2),
	"currency" text DEFAULT 'AED' NOT NULL,
	"start_date" date,
	"renewal_date" date,
	"fee" numeric(12, 2),
	"lifecycle_status" "client_lifecycle_enum" DEFAULT 'onboarding' NOT NULL,
	"contacts" jsonb DEFAULT '{}'::jsonb,
	"approvers" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_deal_id_unique" UNIQUE("deal_id")
);

CREATE TABLE "client_portal_user" (
	"client_portal_user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "connection_account" (
	"connection_account_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_employee_id" uuid,
	"owner_portal_user_id" uuid,
	"toolkit" text NOT NULL,
	"scope" text NOT NULL,
	"external_connection_id" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "convention" (
	"convention_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" text NOT NULL,
	"version" numeric(6, 0) NOT NULL,
	"payload" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "deal" (
	"deal_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"sector" text,
	"stage" "deal_stage_enum" DEFAULT 'discover' NOT NULL,
	"close_outcome" "close_outcome_enum",
	"lost_reason" text,
	"lead_source_lane" "lead_source_lane_enum" NOT NULL,
	"buaf_budget" boolean,
	"buaf_urgency" boolean,
	"buaf_access" boolean,
	"buaf_fit" boolean,
	"buaf_temperature" "buaf_temperature_enum",
	"email_verified" boolean DEFAULT false NOT NULL,
	"quote_value" numeric(12, 2),
	"internal_cost" numeric(12, 2),
	"margin_pct" numeric(5, 2),
	"discount_pct" numeric(5, 2),
	"discount_approval_tier" "discount_approval_tier_enum",
	"vendor_handling_fee_pct" numeric(5, 2) DEFAULT '20.00' NOT NULL,
	"owner_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "employee" (
	"employee_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"lifecycle_status" "employee_lifecycle_enum" DEFAULT 'active' NOT NULL,
	"capacity_hours_per_week" numeric(5, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_email_unique" UNIQUE("email")
);

CREATE TABLE "employee_auth" (
	"employee_auth_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_auth_employee_id_unique" UNIQUE("employee_id"),
	CONSTRAINT "employee_auth_auth_user_id_unique" UNIQUE("auth_user_id")
);

CREATE TABLE "employee_role" (
	"employee_role_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "health_signal" (
	"health_signal_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_key" text NOT NULL,
	"severity" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "immersion" (
	"immersion_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"swot" jsonb,
	"usp" text,
	"audience" text,
	"social_accounts" jsonb,
	"competitors" jsonb,
	"objective_priority" text,
	"brand_assets" jsonb,
	"approvers" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "invoice" (
	"invoice_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"invoice_type" text NOT NULL,
	"status" "invoice_status_enum" DEFAULT 'draft' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"vat_amount" numeric(12, 2),
	"currency" text DEFAULT 'AED' NOT NULL,
	"xero_invoice_id" text,
	"period" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "permission_policy" (
	"permission_policy_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"effect" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "role" (
	"role_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_key_unique" UNIQUE("key")
);

CREATE TABLE "scope" (
	"scope_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deal_id" uuid,
	"title" text NOT NULL,
	"value" numeric(12, 2),
	"terms" text,
	"period_start" date,
	"period_end" date,
	"status" "scope_status_enum" DEFAULT 'draft' NOT NULL,
	"lanes" jsonb DEFAULT '[]'::jsonb,
	"margin_at_sale_pct" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "scope_deliverable_line" (
	"scope_deliverable_line_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"label" text NOT NULL,
	"quantity" numeric(10, 2),
	"unit_price" numeric(12, 2),
	"internal_cost" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "task" (
	"task_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"calendar_id" uuid,
	"month" text,
	"task_type" text NOT NULL,
	"status" "task_status_enum" DEFAULT 'backlog' NOT NULL,
	"situational_state" text,
	"owner_employee_id" uuid,
	"deadline" date,
	"priority" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "xero_invoice_mirror" (
	"xero_invoice_mirror_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xero_invoice_mirror_external_id_unique" UNIQUE("external_id")
);
