CREATE TABLE "account_team_member" (
	"account_team_member_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"account_role" text NOT NULL,
	"is_account_lead" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);\n\nCREATE TABLE "airtable_task_mirror" (
	"airtable_task_mirror_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "airtable_task_mirror_external_id_unique" UNIQUE("external_id")
);\n\nCREATE TABLE "asset" (
	"asset_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"client_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);\n\nCREATE TABLE "asset_version" (
	"asset_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"version_number" numeric(6, 0) NOT NULL,
	"is_client_revision" boolean DEFAULT false NOT NULL,
	"uploaded_by_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);\n\nCREATE TABLE "audit_event" (
	"audit_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_employee_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);\n\nCREATE TABLE "bayzat_employee_mirror" (
	"bayzat_employee_mirror_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bayzat_employee_mirror_external_id_unique" UNIQUE("external_id")
);\n\nCREATE TABLE "brief" (
	"brief_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb,
	"dor_complete" boolean DEFAULT false NOT NULL,
	"missing_required_count" numeric(4, 0) DEFAULT '0',
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brief_task_id_unique" UNIQUE("task_id")
);\n\nCREATE TABLE "calendar" (
	"calendar_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"month" text NOT NULL,
	"focus_points" jsonb DEFAULT '[]'::jsonb,
	"ref_approval_state" text,
	"final_approval_state" text,
	"shoot_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);\n\nCREATE TABLE "calendar_slot" (
	"calendar_slot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"slot_date" date NOT NULL,
	"slot_label" text,
	"task_id" uuid,
	"position" numeric(6, 0) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);