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