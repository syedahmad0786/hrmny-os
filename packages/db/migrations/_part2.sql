CREATE TABLE "employee_role" (
	"employee_role_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);\n\nCREATE TABLE "health_signal" (
	"health_signal_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_key" text NOT NULL,
	"severity" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);\n\nCREATE TABLE "immersion" (
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
);\n\nCREATE TABLE "invoice" (
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
);\n\nCREATE TABLE "permission_policy" (
	"permission_policy_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"effect" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);\n\nCREATE TABLE "role" (
	"role_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_key_unique" UNIQUE("key")
);\n\nCREATE TABLE "scope" (
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
);\n\nCREATE TABLE "scope_deliverable_line" (
	"scope_deliverable_line_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"label" text NOT NULL,
	"quantity" numeric(10, 2),
	"unit_price" numeric(12, 2),
	"internal_cost" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);\n\nCREATE TABLE "task" (
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