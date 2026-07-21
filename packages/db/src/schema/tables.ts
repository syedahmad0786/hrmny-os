import {
  boolean,
  customType,
  date,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** pgvector column — requires `CREATE EXTENSION vector` (see migrations/0003). */
const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    if (Array.isArray(value)) return value as number[];
    if (typeof value === "string") {
      const inner = value.replace(/^\[/, "").replace(/\]$/, "");
      if (!inner.trim()) return [];
      return inner.split(",").map((n) => Number(n));
    }
    return [];
  },
});

import {
  activityTypeEnum,
  buafTemperatureEnum,
  clientLifecycleEnum,
  closeOutcomeEnum,
  crmTaskStatusEnum,
  dealStageEnum,
  discountApprovalTierEnum,
  employeeLifecycleEnum,
  engagementTypeEnum,
  invoiceStatusEnum,
  leadSourceLaneEnum,
  marketEnum,
  scopeStatusEnum,
  taskStatusEnum,
  ticketPriorityEnum,
  ticketRequesterTypeEnum,
  ticketStatusEnum,
} from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/** 22. role */
export const role = pgTable("role", {
  roleId: uuid("role_id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  displayName: text("display_name").notNull(),
  ...timestamps,
});

/** 11. employee */
export const employee = pgTable("employee", {
  employeeId: uuid("employee_id").defaultRandom().primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  lifecycleStatus: employeeLifecycleEnum("lifecycle_status")
    .default("active")
    .notNull(),
  capacityHoursPerWeek: numeric("capacity_hours_per_week", {
    precision: 5,
    scale: 2,
  }),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

/** M1 addition: employee ↔ role N:M */
export const employeeRole = pgTable(
  "employee_role",
  {
    employeeRoleId: uuid("employee_role_id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.roleId),
    ...timestamps,
  },
  (t) => [uniqueIndex("employee_role_uniq").on(t.employeeId, t.roleId)],
);

/** 23. permission_policy */
export const permissionPolicy = pgTable("permission_policy", {
  permissionPolicyId: uuid("permission_policy_id").defaultRandom().primaryKey(),
  roleId: uuid("role_id")
    .notNull()
    .references(() => role.roleId),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  effect: text("effect").notNull(), // allow | deny — explicit deny wins
  ...timestamps,
});

/** CRM: company / account (pre-win and post-win directory) */
export const company = pgTable("company", {
  companyId: uuid("company_id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  sector: text("sector"),
  market: marketEnum("market").default("UAE"),
  website: text("website"),
  linkedinUrl: text("linkedin_url"),
  notes: text("notes"),
  ...timestamps,
});

/** CRM: contact person */
export const contact = pgTable("contact", {
  contactId: uuid("contact_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => company.companyId),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  linkedinUrl: text("linkedin_url"),
  emailVerified: boolean("email_verified").default(false).notNull(),
  isPrimary: boolean("is_primary").default(false).notNull(),
  ...timestamps,
});

/** 4. deal */
export const deal = pgTable("deal", {
  dealId: uuid("deal_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").references(() => company.companyId),
  primaryContactId: uuid("primary_contact_id").references(() => contact.contactId),
  companyName: text("company_name").notNull(),
  sector: text("sector"),
  stage: dealStageEnum("stage").default("discover").notNull(),
  closeOutcome: closeOutcomeEnum("close_outcome"),
  lostReason: text("lost_reason"),
  leadSourceLane: leadSourceLaneEnum("lead_source_lane").notNull(),
  buafBudget: boolean("buaf_budget"),
  buafUrgency: boolean("buaf_urgency"),
  buafAccess: boolean("buaf_access"),
  buafFit: boolean("buaf_fit"),
  buafTemperature: buafTemperatureEnum("buaf_temperature"),
  emailVerified: boolean("email_verified").default(false).notNull(),
  quoteValue: numeric("quote_value", { precision: 12, scale: 2 }),
  internalCost: numeric("internal_cost", { precision: 12, scale: 2 }),
  marginPct: numeric("margin_pct", { precision: 5, scale: 2 }),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 }),
  discountApprovalTier: discountApprovalTierEnum("discount_approval_tier"),
  vendorHandlingFeePct: numeric("vendor_handling_fee_pct", {
    precision: 5,
    scale: 2,
  })
    .default("20.00")
    .notNull(),
  ownerEmployeeId: uuid("owner_employee_id").references(() => employee.employeeId),
  ...timestamps,
});

/** CRM: activity timeline row */
export const activity = pgTable("activity", {
  activityId: uuid("activity_id").defaultRandom().primaryKey(),
  type: activityTypeEnum("type").notNull(),
  subject: text("subject"),
  body: text("body"),
  companyId: uuid("company_id").references(() => company.companyId),
  contactId: uuid("contact_id").references(() => contact.contactId),
  dealId: uuid("deal_id").references(() => deal.dealId),
  actorEmployeeId: uuid("actor_employee_id").references(() => employee.employeeId),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  ...timestamps,
});

/** CRM: freeform note on company / contact / deal */
export const crmNote = pgTable("crm_note", {
  crmNoteId: uuid("crm_note_id").defaultRandom().primaryKey(),
  body: text("body").notNull(),
  companyId: uuid("company_id").references(() => company.companyId),
  contactId: uuid("contact_id").references(() => contact.contactId),
  dealId: uuid("deal_id").references(() => deal.dealId),
  authorEmployeeId: uuid("author_employee_id").references(() => employee.employeeId),
  ...timestamps,
});

/** CRM: sales follow-up task (not delivery production task) */
export const crmTask = pgTable("crm_task", {
  crmTaskId: uuid("crm_task_id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  status: crmTaskStatusEnum("status").default("open").notNull(),
  dueDate: date("due_date"),
  companyId: uuid("company_id").references(() => company.companyId),
  contactId: uuid("contact_id").references(() => contact.contactId),
  dealId: uuid("deal_id").references(() => deal.dealId),
  ownerEmployeeId: uuid("owner_employee_id").references(() => employee.employeeId),
  ...timestamps,
});

/** 1. client */
export const client = pgTable("client", {
  clientId: uuid("client_id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => deal.dealId)
    .unique(),
  name: text("name").notNull(),
  market: marketEnum("market").notNull(),
  engagementType: engagementTypeEnum("engagement_type").notNull(),
  contractValue: numeric("contract_value", { precision: 12, scale: 2 }),
  currency: text("currency").default("AED").notNull(),
  startDate: date("start_date"),
  renewalDate: date("renewal_date"),
  fee: numeric("fee", { precision: 12, scale: 2 }),
  lifecycleStatus: clientLifecycleEnum("lifecycle_status")
    .default("onboarding")
    .notNull(),
  contacts: jsonb("contacts").$type<Record<string, unknown>>().default({}),
  approvers: jsonb("approvers").$type<Record<string, unknown>>().default({}),
  ...timestamps,
});

/** 2. account_team_member */
export const accountTeamMember = pgTable(
  "account_team_member",
  {
    accountTeamMemberId: uuid("account_team_member_id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.clientId),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    accountRole: text("account_role").notNull(),
    isAccountLead: boolean("is_account_lead").default(false).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("account_team_member_uniq").on(t.clientId, t.employeeId)],
);

/** 3. immersion */
export const immersion = pgTable("immersion", {
  immersionId: uuid("immersion_id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => client.clientId),
  swot: jsonb("swot").$type<Record<string, unknown>>(),
  usp: text("usp"),
  audience: text("audience"),
  socialAccounts: jsonb("social_accounts").$type<Record<string, unknown>>(),
  competitors: jsonb("competitors").$type<unknown[]>(),
  objectivePriority: text("objective_priority"),
  brandAssets: jsonb("brand_assets").$type<Record<string, unknown>>(),
  approvers: jsonb("approvers").$type<Record<string, unknown>>(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
});

/** 5. scope */
export const scope = pgTable("scope", {
  scopeId: uuid("scope_id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => client.clientId),
  dealId: uuid("deal_id").references(() => deal.dealId),
  title: text("title").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }),
  terms: text("terms"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  status: scopeStatusEnum("status").default("draft").notNull(),
  lanes: jsonb("lanes").$type<unknown[]>().default([]),
  marginAtSalePct: numeric("margin_at_sale_pct", { precision: 5, scale: 2 }),
  ...timestamps,
});

/** 6. scope_deliverable_line */
export const scopeDeliverableLine = pgTable("scope_deliverable_line", {
  scopeDeliverableLineId: uuid("scope_deliverable_line_id")
    .defaultRandom()
    .primaryKey(),
  scopeId: uuid("scope_id")
    .notNull()
    .references(() => scope.scopeId),
  label: text("label").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
  internalCost: numeric("internal_cost", { precision: 12, scale: 2 }),
  ...timestamps,
});

/** 9. calendar */
export const calendar = pgTable("calendar", {
  calendarId: uuid("calendar_id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => client.clientId),
  month: text("month").notNull(), // YYYY-MM
  focusPoints: jsonb("focus_points").$type<unknown[]>().default([]),
  refApprovalState: text("ref_approval_state"),
  finalApprovalState: text("final_approval_state"),
  shootDate: date("shoot_date"),
  ...timestamps,
});

/** 8. task */
export const task = pgTable("task", {
  taskId: uuid("task_id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => client.clientId),
  calendarId: uuid("calendar_id").references(() => calendar.calendarId),
  month: text("month"),
  taskType: text("task_type").notNull(),
  status: taskStatusEnum("status").default("backlog").notNull(),
  situationalState: text("situational_state"),
  ownerEmployeeId: uuid("owner_employee_id").references(() => employee.employeeId),
  deadline: date("deadline"),
  priority: text("priority"),
  ...timestamps,
});

/** 10. calendar_slot */
export const calendarSlot = pgTable("calendar_slot", {
  calendarSlotId: uuid("calendar_slot_id").defaultRandom().primaryKey(),
  calendarId: uuid("calendar_id")
    .notNull()
    .references(() => calendar.calendarId),
  slotDate: date("slot_date").notNull(),
  slotLabel: text("slot_label"),
  taskId: uuid("task_id").references(() => task.taskId),
  position: numeric("position", { precision: 6, scale: 0 }).default("0"),
  ...timestamps,
});

/** 7. brief */
export const brief = pgTable("brief", {
  briefId: uuid("brief_id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.taskId)
    .unique(),
  body: jsonb("body").$type<Record<string, unknown>>().default({}),
  dorComplete: boolean("dor_complete").default(false).notNull(),
  missingRequiredCount: numeric("missing_required_count", {
    precision: 4,
    scale: 0,
  }).default("0"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  ...timestamps,
});

/** 12. bayzat_employee_mirror (read-only from app) */
export const bayzatEmployeeMirror = pgTable("bayzat_employee_mirror", {
  bayzatEmployeeMirrorId: uuid("bayzat_employee_mirror_id")
    .defaultRandom()
    .primaryKey(),
  employeeId: uuid("employee_id").references(() => employee.employeeId),
  externalId: text("external_id").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  ...timestamps,
});

/** 13. invoice */
export const invoice = pgTable("invoice", {
  invoiceId: uuid("invoice_id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").references(() => client.clientId),
  invoiceType: text("invoice_type").notNull(),
  status: invoiceStatusEnum("status").default("draft").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }),
  currency: text("currency").default("AED").notNull(),
  xeroInvoiceId: text("xero_invoice_id"),
  period: text("period"),
  ...timestamps,
});

/** 14. xero_invoice_mirror */
export const xeroInvoiceMirror = pgTable("xero_invoice_mirror", {
  xeroInvoiceMirrorId: uuid("xero_invoice_mirror_id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").references(() => invoice.invoiceId),
  externalId: text("external_id").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  ...timestamps,
});

/** 15. airtable_task_mirror */
export const airtableTaskMirror = pgTable("airtable_task_mirror", {
  airtableTaskMirrorId: uuid("airtable_task_mirror_id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").references(() => task.taskId),
  externalId: text("external_id").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  ...timestamps,
});

/** 16. convention (versioned rules-as-data) */
export const convention = pgTable("convention", {
  conventionId: uuid("convention_id").defaultRandom().primaryKey(),
  ruleKey: text("rule_key").notNull(),
  version: numeric("version", { precision: 6, scale: 0 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

/** 17. audit_event — append-only */
export const auditEvent = pgTable("audit_event", {
  auditEventId: uuid("audit_event_id").defaultRandom().primaryKey(),
  actorEmployeeId: uuid("actor_employee_id").references(() => employee.employeeId),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  before: jsonb("before").$type<Record<string, unknown> | null>(),
  after: jsonb("after").$type<Record<string, unknown> | null>(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** 18. client_portal_user */
export const clientPortalUser = pgTable("client_portal_user", {
  clientPortalUserId: uuid("client_portal_user_id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => client.clientId),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

/** 20. asset */
export const asset = pgTable("asset", {
  assetId: uuid("asset_id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").references(() => task.taskId),
  clientId: uuid("client_id").references(() => client.clientId),
  title: text("title").notNull(),
  status: text("status").default("draft").notNull(),
  approvedVersionId: uuid("approved_version_id"),
  ...timestamps,
});

/** 21. asset_version — append-only versions */
export const assetVersion = pgTable("asset_version", {
  assetVersionId: uuid("asset_version_id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => asset.assetId),
  storagePath: text("storage_path").notNull(),
  versionNumber: numeric("version_number", { precision: 6, scale: 0 }).notNull(),
  isClientRevision: boolean("is_client_revision").default(false).notNull(),
  uploadedByEmployeeId: uuid("uploaded_by_employee_id").references(
    () => employee.employeeId,
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** M1: Composio / direct connection metadata */
export const connectionAccount = pgTable("connection_account", {
  connectionAccountId: uuid("connection_account_id").defaultRandom().primaryKey(),
  ownerEmployeeId: uuid("owner_employee_id").references(() => employee.employeeId),
  ownerPortalUserId: uuid("owner_portal_user_id").references(
    () => clientPortalUser.clientPortalUserId,
  ),
  toolkit: text("toolkit").notNull(),
  scope: text("scope").notNull(), // staff | portal
  externalConnectionId: text("external_connection_id"),
  status: text("status").default("disconnected").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  ...timestamps,
});

/** M1: health signal path (Chat webhook stubbed until wired) */
export const healthSignal = pgTable("health_signal", {
  healthSignalId: uuid("health_signal_id").defaultRandom().primaryKey(),
  signalKey: text("signal_key").notNull(),
  severity: text("severity").notNull(), // info | warn | critical
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Optional link: Supabase auth.users.id → employee */
export const employeeAuth = pgTable(
  "employee_auth",
  {
    employeeAuthId: uuid("employee_auth_id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId)
      .unique(),
    authUserId: uuid("auth_user_id").notNull().unique(),
    ...timestamps,
  },
);

/**
 * Semantic memory chunks (pgvector). CRM tables remain SoT.
 * Apply SQL: migrations/0003_pgvector_memory.sql
 */
export const memoryChunk = pgTable("memory_chunk", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id"),
  content: text("content").notNull(),
  embedding: vector1536("embedding"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Support / ops ticketing (team + portal).
 * Apply SQL: migrations/0004_tickets.sql
 * Distinct from delivery `task` and CRM `crm_task`. Over time can absorb light Asana ticket flows.
 */
export const ticket = pgTable("ticket", {
  ticketId: uuid("ticket_id").defaultRandom().primaryKey(),
  subject: text("subject").notNull(),
  body: text("body"),
  status: ticketStatusEnum("status").default("new").notNull(),
  priority: ticketPriorityEnum("priority").default("medium").notNull(),
  requesterType: ticketRequesterTypeEnum("requester_type").notNull(),
  requesterEmployeeId: uuid("requester_employee_id").references(
    () => employee.employeeId,
  ),
  requesterPortalUserId: uuid("requester_portal_user_id").references(
    () => clientPortalUser.clientPortalUserId,
  ),
  assigneeEmployeeId: uuid("assignee_employee_id").references(
    () => employee.employeeId,
  ),
  companyId: uuid("company_id").references(() => company.companyId),
  dealId: uuid("deal_id").references(() => deal.dealId),
  clientId: uuid("client_id").references(() => client.clientId),
  /** AI triage stubs — never auto-applied to client-visible without HITL */
  aiClassification: text("ai_classification"),
  aiSuggestedAssigneeId: uuid("ai_suggested_assignee_id").references(
    () => employee.employeeId,
  ),
  aiDraftReply: text("ai_draft_reply"),
  aiDraftApprovedAt: timestamp("ai_draft_approved_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps,
});

export const ticketComment = pgTable("ticket_comment", {
  ticketCommentId: uuid("ticket_comment_id").defaultRandom().primaryKey(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => ticket.ticketId),
  body: text("body").notNull(),
  /** Internal notes never surface in portal */
  isInternal: boolean("is_internal").default(false).notNull(),
  /** AI-authored draft awaiting human approve before client-visible */
  isAiDraft: boolean("is_ai_draft").default(false).notNull(),
  authorEmployeeId: uuid("author_employee_id").references(() => employee.employeeId),
  authorPortalUserId: uuid("author_portal_user_id").references(
    () => clientPortalUser.clientPortalUserId,
  ),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  ...timestamps,
});

