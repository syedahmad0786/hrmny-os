import { pgEnum } from "drizzle-orm/pg-core";

/** Collision enums — never merge Review/Status/Owner/Approval across entities. */

export const dealStageEnum = pgEnum("deal_stage_enum", [
  "discover",
  "qualify",
  "engage",
  "scope",
  "propose",
  "price_cost",
  "close",
  "handover_pack",
]);

export const taskStatusEnum = pgEnum("task_status_enum", [
  "backlog",
  "briefing",
  "brief_ready",
  "in_production",
  "internal_review",
  "qc",
  "client_review",
  "revisions",
  "approved",
  "delivered",
  "archived",
]);

export const employeeLifecycleEnum = pgEnum("employee_lifecycle_enum", [
  "requisition",
  "sourcing",
  "interview",
  "offer",
  "hire_packet",
  "onboarding",
  "probation",
  "active",
  "offboarding",
]);

export const clientLifecycleEnum = pgEnum("client_lifecycle_enum", [
  "onboarding",
  "active",
  "renewing",
  "at_risk",
  "churned",
  "closed",
]);

export const marketEnum = pgEnum("market_enum", [
  "UAE",
  "KSA",
  "Both",
  "Oman",
  "Qatar",
  "Kuwait",
  "Bahrain",
  "GCC",
]);

export const engagementTypeEnum = pgEnum("engagement_type_enum", [
  "retainer",
  "project",
]);

export const closeOutcomeEnum = pgEnum("close_outcome_enum", [
  "won",
  "lost",
  "postponed_on_hold",
]);

export const leadSourceLaneEnum = pgEnum("lead_source_lane_enum", [
  "industry_scanning",
  "apollo_intent",
  "relationship_led",
  "tejari",
  "inbound",
]);

export const buafTemperatureEnum = pgEnum("buaf_temperature_enum", [
  "hot",
  "warm",
  "cool",
  "cold",
]);

export const discountApprovalTierEnum = pgEnum("discount_approval_tier_enum", [
  "am",
  "md",
  "partner",
]);

export const scopeStatusEnum = pgEnum("scope_status_enum", [
  "draft",
  "active",
  "renewing",
  "closed",
]);

export const invoiceStatusEnum = pgEnum("invoice_status_enum", [
  "draft",
  "proposed",
  "approved",
  "issued",
  "paid",
  "void",
]);

/** CRM activity types (timeline) */
export const activityTypeEnum = pgEnum("activity_type_enum", [
  "note",
  "call",
  "meeting",
  "email",
  "stage_change",
  "task",
  "outreach",
  "system",
]);

/** CRM / sales task status (distinct from delivery task_status_enum) */
export const crmTaskStatusEnum = pgEnum("crm_task_status_enum", [
  "open",
  "in_progress",
  "done",
  "cancelled",
]);

/** Support / ops tickets (distinct from delivery + CRM tasks) */
export const ticketStatusEnum = pgEnum("ticket_status_enum", [
  "new",
  "triaged",
  "open",
  "pending_requester",
  "pending_internal",
  "resolved",
  "closed",
]);

export const ticketPriorityEnum = pgEnum("ticket_priority_enum", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const ticketRequesterTypeEnum = pgEnum("ticket_requester_type_enum", [
  "employee",
  "portal_user",
]);
