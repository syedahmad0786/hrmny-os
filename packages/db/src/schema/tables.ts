import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

/** 22. role */
export const role = pgTable("role", {
  roleId: uuid("role_id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  displayName: text("display_name").notNull(),
  legacyTitles: jsonb("legacy_titles").$type<string[]>().default([]).notNull(),
  ...timestamps,
});

/** 11. employee */
export const employee = pgTable("employee", {
  employeeId: uuid("employee_id").defaultRandom().primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  jobTitle: text("job_title"),
  department: text("department"),
  reportsToEmail: text("reports_to_email"),
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

/** HR: leave rules configured by HR. */
export const leavePolicy = pgTable("leave_policy", {
  leavePolicyId: uuid("leave_policy_id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  leaveType: text("leave_type").notNull(),
  annualDays: numeric("annual_days", { precision: 5, scale: 2 })
    .default("0")
    .notNull(),
  maxCarryoverDays: numeric("max_carryover_days", { precision: 5, scale: 2 })
    .default("0")
    .notNull(),
  isPaid: boolean("is_paid").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

/** HR: annual entitlement; usage is derived from approved leave requests. */
export const leaveBalance = pgTable(
  "leave_balance",
  {
    leaveBalanceId: uuid("leave_balance_id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    leavePolicyId: uuid("leave_policy_id")
      .notNull()
      .references(() => leavePolicy.leavePolicyId),
    year: integer("year").notNull(),
    entitledDays: numeric("entitled_days", { precision: 5, scale: 2 })
      .default("0")
      .notNull(),
    carriedOverDays: numeric("carried_over_days", { precision: 5, scale: 2 })
      .default("0")
      .notNull(),
    adjustmentDays: numeric("adjustment_days", { precision: 5, scale: 2 })
      .default("0")
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("leave_balance_employee_policy_year_uniq").on(
      table.employeeId,
      table.leavePolicyId,
      table.year,
    ),
    index("leave_balance_employee_year_idx").on(table.employeeId, table.year),
  ],
);

/** HR: employee leave request with manager decision. */
export const leaveRequest = pgTable(
  "leave_request",
  {
    leaveRequestId: uuid("leave_request_id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    leavePolicyId: uuid("leave_policy_id")
      .notNull()
      .references(() => leavePolicy.leavePolicyId),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    portion: text("portion").default("full").notNull(),
    days: numeric("days", { precision: 5, scale: 2 }).notNull(),
    reason: text("reason"),
    status: text("status").default("pending").notNull(),
    decidedByEmployeeId: uuid("decided_by_employee_id").references(
      () => employee.employeeId,
    ),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("leave_request_employee_start_idx").on(
      table.employeeId,
      table.startDate,
    ),
    index("leave_request_status_start_idx").on(table.status, table.startDate),
    index("leave_request_policy_idx").on(table.leavePolicyId),
  ],
);

/** HR: one clock record per employee and Dubai work date. */
export const attendanceRecord = pgTable(
  "attendance_record",
  {
    attendanceRecordId: uuid("attendance_record_id")
      .defaultRandom()
      .primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    workDate: date("work_date").notNull(),
    clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull(),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    source: text("source").default("web").notNull(),
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("attendance_record_employee_date_uniq").on(
      table.employeeId,
      table.workDate,
    ),
    index("attendance_record_work_date_idx").on(table.workDate),
  ],
);

/** HR: employee-proposed attendance replacement awaiting approval. */
export const attendanceCorrectionRequest = pgTable(
  "attendance_correction_request",
  {
    attendanceCorrectionRequestId: uuid("attendance_correction_request_id")
      .defaultRandom()
      .primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    attendanceRecordId: uuid("attendance_record_id").references(
      () => attendanceRecord.attendanceRecordId,
    ),
    workDate: date("work_date").notNull(),
    requestedClockInAt: timestamp("requested_clock_in_at", {
      withTimezone: true,
    }).notNull(),
    requestedClockOutAt: timestamp("requested_clock_out_at", {
      withTimezone: true,
    }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").default("pending").notNull(),
    decidedByEmployeeId: uuid("decided_by_employee_id").references(
      () => employee.employeeId,
    ),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("attendance_correction_employee_date_idx").on(
      table.employeeId,
      table.workDate,
    ),
    index("attendance_correction_status_date_idx").on(
      table.status,
      table.workDate,
    ),
    index("attendance_correction_record_idx").on(table.attendanceRecordId),
  ],
);

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
  recordClass: text("record_class").default("operational").notNull(),
  classificationReason: text("classification_reason"),
  opportunityName: text("opportunity_name"),
  expectedCloseDate: date("expected_close_date"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  stageEnteredAt: timestamp("stage_entered_at", {
    withTimezone: true,
  }).defaultNow(),
  companyId: uuid("company_id").references(() => company.companyId),
  primaryContactId: uuid("primary_contact_id").references(
    () => contact.contactId,
  ),
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
  ownerEmployeeId: uuid("owner_employee_id").references(
    () => employee.employeeId,
  ),
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
  actorEmployeeId: uuid("actor_employee_id").references(
    () => employee.employeeId,
  ),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
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
  authorEmployeeId: uuid("author_employee_id").references(
    () => employee.employeeId,
  ),
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
  ownerEmployeeId: uuid("owner_employee_id").references(
    () => employee.employeeId,
  ),
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
    accountTeamMemberId: uuid("account_team_member_id")
      .defaultRandom()
      .primaryKey(),
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

/** Durable month-1 onboarding checklist (phases jsonb). */
export const clientOnboarding = pgTable("client_onboarding", {
  clientId: uuid("client_id")
    .primaryKey()
    .references(() => client.clientId, { onDelete: "cascade" }),
  phases: jsonb("phases").$type<unknown[]>().default([]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
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
  ownerEmployeeId: uuid("owner_employee_id").references(
    () => employee.employeeId,
  ),
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
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  ...timestamps,
});

/** 13. invoice */
export const invoice = pgTable("invoice", {
  invoiceId: uuid("invoice_id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").references(() => client.clientId),
  contactName: text("contact_name"),
  invoiceType: text("invoice_type").notNull(),
  billingKind: text("billing_kind"),
  status: invoiceStatusEnum("status").default("draft").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }),
  currency: text("currency").default("AED").notNull(),
  xeroInvoiceId: text("xero_invoice_id"),
  period: text("period"),
  trn: text("trn"),
  trnStatus: text("trn_status"),
  ruleCited: text("rule_cited"),
  sourceAttached: jsonb("source_attached").$type<Record<string, unknown>>(),
  proposedByEmployeeId: uuid("proposed_by_employee_id").references(
    () => employee.employeeId,
  ),
  approvedByEmployeeId: uuid("approved_by_employee_id").references(
    () => employee.employeeId,
  ),
  ...timestamps,
});

/** 14. xero_invoice_mirror */
export const xeroInvoiceMirror = pgTable("xero_invoice_mirror", {
  xeroInvoiceMirrorId: uuid("xero_invoice_mirror_id")
    .defaultRandom()
    .primaryKey(),
  invoiceId: uuid("invoice_id").references(() => invoice.invoiceId),
  externalId: text("external_id").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  ...timestamps,
});

/** 15. airtable_task_mirror */
export const airtableTaskMirror = pgTable("airtable_task_mirror", {
  airtableTaskMirrorId: uuid("airtable_task_mirror_id")
    .defaultRandom()
    .primaryKey(),
  taskId: uuid("task_id").references(() => task.taskId),
  externalId: text("external_id").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
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
  actorEmployeeId: uuid("actor_employee_id").references(
    () => employee.employeeId,
  ),
  actorPortalUserId: uuid("actor_portal_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  before: jsonb("before").$type<Record<string, unknown> | null>(),
  after: jsonb("after").$type<Record<string, unknown> | null>(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** 18. client_portal_user */
export const clientPortalUser = pgTable("client_portal_user", {
  clientPortalUserId: uuid("client_portal_user_id")
    .defaultRandom()
    .primaryKey(),
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
  versionNumber: numeric("version_number", {
    precision: 6,
    scale: 0,
  }).notNull(),
  isClientRevision: boolean("is_client_revision").default(false).notNull(),
  uploadedByEmployeeId: uuid("uploaded_by_employee_id").references(
    () => employee.employeeId,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** M1: Composio / direct connection metadata */
export const connectionAccount = pgTable("connection_account", {
  connectionAccountId: uuid("connection_account_id")
    .defaultRandom()
    .primaryKey(),
  ownerEmployeeId: uuid("owner_employee_id").references(
    () => employee.employeeId,
  ),
  ownerPortalUserId: uuid("owner_portal_user_id").references(
    () => clientPortalUser.clientPortalUserId,
  ),
  toolkit: text("toolkit").notNull(),
  scope: text("scope").notNull(), // staff | portal
  authType: text("auth_type").default("oauth").notNull(),
  label: text("label"),
  secretId: uuid("secret_id"), // Supabase Vault id; never return the secret
  externalConnectionId: text("external_connection_id"),
  status: text("status").default("disconnected").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastError: text("last_error"),
  ...timestamps,
});

/** Feature Lab: code-owned catalogue overrides by global/client/role/user scope. */
export const featureOverride = pgTable(
  "feature_override",
  {
    featureOverrideId: uuid("feature_override_id").defaultRandom().primaryKey(),
    featureKey: text("feature_key").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeKey: text("scope_key").notNull(),
    enabled: boolean("enabled").notNull(),
    reason: text("reason"),
    updatedByEmployeeId: uuid("updated_by_employee_id").references(
      () => employee.employeeId,
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("feature_override_scope_uniq").on(
      table.featureKey,
      table.scopeType,
      table.scopeKey,
    ),
    index("feature_override_scope_idx").on(table.scopeType, table.scopeKey),
  ],
);

/** Verified control-plane record for the separately deployed Work sandbox. */
export const workSandbox = pgTable(
  "work_sandbox",
  {
    workSandboxId: uuid("work_sandbox_id").defaultRandom().primaryKey(),
    organizationKey: text("organization_key").default("default").notNull(),
    name: text("name").notNull(),
    environmentId: text("environment_id").notNull().unique(),
    baseUrl: text("base_url").notNull(),
    databaseFingerprint: text("database_fingerprint").notNull(),
    authFingerprint: text("auth_fingerprint"),
    status: text("status").default("active").notNull(),
    settingsCopiedAt: timestamp("settings_copied_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdByEmployeeId: uuid("created_by_employee_id")
      .notNull()
      .references(() => employee.employeeId),
    deletedByEmployeeId: uuid("deleted_by_employee_id").references(
      () => employee.employeeId,
    ),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("work_sandbox_organization_uniq").on(table.organizationKey),
  ],
);

/** Product requests: idea/voice intake → editable PRD → approval → build. */
export const featureRequest = pgTable("feature_request", {
  featureRequestId: uuid("feature_request_id").defaultRandom().primaryKey(),
  submittedByEmployeeId: uuid("submitted_by_employee_id")
    .notNull()
    .references(() => employee.employeeId),
  title: text("title").notNull(),
  rawInput: text("raw_input").notNull(),
  voiceStoragePath: text("voice_storage_path"),
  prd: jsonb("prd").$type<Record<string, unknown>>().default({}).notNull(),
  status: text("status").default("draft").notNull(),
  approvalNote: text("approval_note"),
  approvedByEmployeeId: uuid("approved_by_employee_id").references(
    () => employee.employeeId,
  ),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  ...timestamps,
});

/** M1: health signal path (Chat webhook stubbed until wired) */
export const healthSignal = pgTable("health_signal", {
  healthSignalId: uuid("health_signal_id").defaultRandom().primaryKey(),
  signalKey: text("signal_key").notNull(),
  severity: text("severity").notNull(), // info | warn | critical
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** M1: durable timer/retry queue, claimed by the scheduled worker. */
export const scheduledJob = pgTable(
  "scheduled_job",
  {
    scheduledJobId: uuid("scheduled_job_id").defaultRandom().primaryKey(),
    integrationInboxId: uuid("integration_inbox_id").references(
      () => integrationInbox.integrationInboxId,
      { onDelete: "set null" },
    ),
    jobKey: text("job_key").notNull().unique(),
    kind: text("kind").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: text("status").default("pending").notNull(),
    concurrencyKey: text("concurrency_key"),
    attempts: integer("attempts").default(0).notNull(),
    stateVersion: integer("state_version").default(0).notNull(),
    attemptToken: uuid("attempt_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    index("scheduled_job_due_idx").on(table.status, table.runAt),
    uniqueIndex("scheduled_job_apollo_inbox_uniq")
      .on(table.integrationInboxId)
      .where(
        sql`${table.kind} = 'apollo_people_search' and ${table.integrationInboxId} is not null`,
      ),
    check(
      "scheduled_job_apollo_concurrency_key_chk",
      sql`(${table.kind} = 'apollo_people_search' and ${table.concurrencyKey} is not null and ${table.concurrencyKey} = 'provider:apollo') or (${table.kind} <> 'apollo_people_search' and ${table.concurrencyKey} is distinct from 'provider:apollo')`,
    ),
    uniqueIndex("scheduled_job_running_concurrency_uniq")
      .on(table.concurrencyKey)
      .where(
        sql`${table.status} = 'running' and ${table.concurrencyKey} is not null`,
      ),
  ],
);

/** Durable ingress ledger for replay-safe provider and automation callbacks. */
export const integrationInbox = pgTable(
  "integration_inbox",
  {
    integrationInboxId: uuid("integration_inbox_id")
      .defaultRandom()
      .primaryKey(),
    ownerEmployeeId: uuid("owner_employee_id").references(
      () => employee.employeeId,
      { onDelete: "set null" },
    ),
    credentialConnectionAccountId: uuid(
      "credential_connection_account_id",
    ).references(() => connectionAccount.connectionAccountId, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    operation: text("operation").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: text("status").default("received").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    stateVersion: integer("state_version").default(0).notNull(),
    attemptToken: uuid("attempt_token"),
    attemptLeaseExpiresAt: timestamp("attempt_lease_expires_at", {
      withTimezone: true,
    }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("integration_inbox_provider_event_uniq").on(
      table.provider,
      table.externalEventId,
    ),
    index("integration_inbox_status_received_idx").on(
      table.status,
      table.receivedAt,
    ),
    index("integration_inbox_owner_operation_idx").on(
      table.ownerEmployeeId,
      table.operation,
      table.receivedAt.desc(),
    ),
  ],
);

/** Optional link: Supabase auth.users.id → employee */
export const employeeAuth = pgTable("employee_auth", {
  employeeAuthId: uuid("employee_auth_id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employee.employeeId)
    .unique(),
  authUserId: uuid("auth_user_id").notNull().unique(),
  ...timestamps,
});

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
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
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
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
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
  authorEmployeeId: uuid("author_employee_id").references(
    () => employee.employeeId,
  ),
  authorPortalUserId: uuid("author_portal_user_id").references(
    () => clientPortalUser.clientPortalUserId,
  ),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  ...timestamps,
});

/** HR/payroll: effective-dated employee compensation source. */
export const salaryPackage = pgTable(
  "salary_package",
  {
    salaryPackageId: uuid("salary_package_id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    currency: text("currency").default("AED").notNull(),
    basicMonthly: numeric("basic_monthly", {
      precision: 14,
      scale: 2,
    }).notNull(),
    housingMonthly: numeric("housing_monthly", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    transportMonthly: numeric("transport_monthly", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    otherAllowanceMonthly: numeric("other_allowance_monthly", {
      precision: 14,
      scale: 2,
    })
      .default("0")
      .notNull(),
    bankIban: text("bank_iban"),
    bankRoutingCode: text("bank_routing_code"),
    mohrePersonId: text("mohre_person_id"),
    wpsAgentId: text("wps_agent_id"),
    createdByEmployeeId: uuid("created_by_employee_id")
      .notNull()
      .references(() => employee.employeeId),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("salary_package_employee_effective_uniq").on(
      table.employeeId,
      table.effectiveFrom,
    ),
    index("salary_package_employee_date_idx").on(
      table.employeeId,
      table.effectiveFrom,
    ),
  ],
);

/** HR/payroll: immutable run header after maker/checker approval. */
export const payrollRun = pgTable(
  "payroll_run",
  {
    payrollRunId: uuid("payroll_run_id").defaultRandom().primaryKey(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    runNumber: integer("run_number").default(1).notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").default("draft").notNull(),
    currency: text("currency").default("AED").notNull(),
    calculationRuleVersion: text("calculation_rule_version").notNull(),
    totalGross: numeric("total_gross", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    totalReimbursements: numeric("total_reimbursements", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    totalDeductions: numeric("total_deductions", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    totalNet: numeric("total_net", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    createdByEmployeeId: uuid("created_by_employee_id")
      .notNull()
      .references(() => employee.employeeId),
    confirmedByEmployeeId: uuid("confirmed_by_employee_id").references(
      () => employee.employeeId,
    ),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    approvedByEmployeeId: uuid("approved_by_employee_id").references(
      () => employee.employeeId,
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    postedByEmployeeId: uuid("posted_by_employee_id").references(
      () => employee.employeeId,
    ),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    xeroJournalId: text("xero_journal_id"),
    wpsStatus: text("wps_status").default("not_generated").notNull(),
    wpsPayload: jsonb("wps_payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("payroll_run_period_number_uniq").on(
      table.periodStart,
      table.periodEnd,
      table.runNumber,
    ),
    index("payroll_run_period_idx").on(table.periodStart, table.periodEnd),
  ],
);

/** HR/payroll: calculation snapshot used by payslips, WPS and reconciliation. */
export const payrollLine = pgTable(
  "payroll_line",
  {
    payrollLineId: uuid("payroll_line_id").defaultRandom().primaryKey(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRun.payrollRunId),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    salaryPackageId: uuid("salary_package_id")
      .notNull()
      .references(() => salaryPackage.salaryPackageId),
    paidDays: integer("paid_days").notNull(),
    calendarDays: integer("calendar_days").notNull(),
    basicAmount: numeric("basic_amount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    housingAmount: numeric("housing_amount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    transportAmount: numeric("transport_amount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    otherAllowanceAmount: numeric("other_allowance_amount", {
      precision: 14,
      scale: 2,
    })
      .default("0")
      .notNull(),
    overtimeAmount: numeric("overtime_amount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    bonusAmount: numeric("bonus_amount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    expenseReimbursement: numeric("expense_reimbursement", {
      precision: 14,
      scale: 2,
    })
      .default("0")
      .notNull(),
    deductionsAmount: numeric("deductions_amount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    loanDeduction: numeric("loan_deduction", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
    netAmount: numeric("net_amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").default("AED").notNull(),
    calculationSnapshot: jsonb("calculation_snapshot")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("payroll_line_run_employee_uniq").on(
      table.payrollRunId,
      table.employeeId,
    ),
    index("payroll_line_employee_idx").on(table.employeeId, table.payrollRunId),
  ],
);

export const employeeExpense = pgTable(
  "employee_expense",
  {
    employeeExpenseId: uuid("employee_expense_id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    submittedByEmployeeId: uuid("submitted_by_employee_id")
      .notNull()
      .references(() => employee.employeeId),
    expenseDate: date("expense_date").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").default("AED").notNull(),
    receiptAssetId: uuid("receipt_asset_id").references(() => asset.assetId),
    status: text("status").default("pending").notNull(),
    approvedByEmployeeId: uuid("approved_by_employee_id").references(
      () => employee.employeeId,
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    reimbursedPayrollRunId: uuid("reimbursed_payroll_run_id").references(
      () => payrollRun.payrollRunId,
    ),
    ...timestamps,
  },
  (table) => [
    index("employee_expense_employee_date_idx").on(
      table.employeeId,
      table.expenseDate,
    ),
    index("employee_expense_status_idx").on(table.status, table.expenseDate),
  ],
);

export const employeeLoan = pgTable(
  "employee_loan",
  {
    employeeLoanId: uuid("employee_loan_id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    requestedByEmployeeId: uuid("requested_by_employee_id")
      .notNull()
      .references(() => employee.employeeId),
    purpose: text("purpose").notNull(),
    principalAmount: numeric("principal_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    outstandingAmount: numeric("outstanding_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    instalmentAmount: numeric("instalment_amount", {
      precision: 14,
      scale: 2,
    }).notNull(),
    currency: text("currency").default("AED").notNull(),
    firstDeductionPeriod: date("first_deduction_period"),
    status: text("status").default("pending").notNull(),
    approvedByEmployeeId: uuid("approved_by_employee_id").references(
      () => employee.employeeId,
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (table) => [
    index("employee_loan_employee_status_idx").on(
      table.employeeId,
      table.status,
    ),
  ],
);

export const payslip = pgTable(
  "payslip",
  {
    payslipId: uuid("payslip_id").defaultRandom().primaryKey(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRun.payrollRunId),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.employeeId),
    language: text("language").default("en").notNull(),
    storagePath: text("storage_path").notNull(),
    checksum: text("checksum").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("payslip_run_employee_language_uniq").on(
      table.payrollRunId,
      table.employeeId,
      table.language,
    ),
  ],
);

/**
 * M7: append-only audit of every LLM agent run — input/output, tokens, cost in
 * AED, and the gate decision. Feeds the ai-admin cost panel and the monthly cap.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    agentRunId: uuid("agent_run_id").defaultRandom().primaryKey(),
    agent: text("agent").notNull(),
    model: text("model").notNull(),
    input: jsonb("input")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    output: jsonb("output")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    tokensIn: integer("tokens_in").default(0).notNull(),
    tokensOut: integer("tokens_out").default(0).notNull(),
    costAed: numeric("cost_aed", { precision: 12, scale: 4 })
      .default("0")
      .notNull(),
    gateOutcome: text("gate_outcome"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_runs_agent_created_idx").on(table.agent, table.createdAt),
    index("agent_runs_created_idx").on(table.createdAt),
  ],
);

export const campaignItems = pgTable(
  "campaign_items",
  {
    campaignItemId: uuid("campaign_item_id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    channel: text("channel").notNull(),
    status: text("status").default("draft").notNull(),
    scheduledFor: date("scheduled_for"),
    clientId: uuid("client_id"),
    body: jsonb("body").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("campaign_items_client_idx").on(table.clientId, table.status),
    index("campaign_items_scheduled_idx").on(table.scheduledFor),
  ],
);

/**
 * Explainable ratings v1 (migration 0062). A definition owns the weighted
 * factors; a snapshot is one computed 0–100 score with a per-factor breakdown;
 * an override is a justified human correction. Scoring/validation (including the
 * hard "no employee/person kind" rule) lives in apps/web scorecards service.
 */
export const scorecardDefinitions = pgTable(
  "scorecard_definitions",
  {
    scorecardDefinitionId: uuid("scorecard_definition_id")
      .defaultRandom()
      .primaryKey(),
    key: text("key").notNull(),
    entityKind: text("entity_kind").notNull(),
    version: integer("version").default(1).notNull(),
    weights: jsonb("weights")
      .$type<Array<{ key: string; label?: string; weight: number }>>()
      .default([])
      .notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("scorecard_definitions_key_version_unique").on(
      table.key,
      table.version,
    ),
    index("scorecard_definitions_key_active_idx").on(table.key, table.active),
  ],
);

export const scorecardSnapshots = pgTable(
  "scorecard_snapshots",
  {
    scorecardSnapshotId: uuid("scorecard_snapshot_id")
      .defaultRandom()
      .primaryKey(),
    definitionId: uuid("definition_id").notNull(),
    definitionKey: text("definition_key").notNull(),
    version: integer("version").notNull(),
    entityKind: text("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    score: integer("score").notNull(),
    breakdown: jsonb("breakdown")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("scorecard_snapshots_entity_idx").on(
      table.entityKind,
      table.entityId,
      table.createdAt,
    ),
    index("scorecard_snapshots_definition_idx").on(table.definitionId),
  ],
);

export const scorecardOverrides = pgTable(
  "scorecard_overrides",
  {
    scorecardOverrideId: uuid("scorecard_override_id")
      .defaultRandom()
      .primaryKey(),
    snapshotId: uuid("snapshot_id").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    newScore: integer("new_score").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("scorecard_overrides_snapshot_idx").on(
      table.snapshotId,
      table.createdAt,
    ),
  ],
);

export const portalFeedback = pgTable(
  "portal_feedback",
  {
    portalFeedbackId: uuid("portal_feedback_id").defaultRandom().primaryKey(),
    campaignItemId: uuid("campaign_item_id")
      .notNull()
      .references(() => campaignItems.campaignItemId, { onDelete: "cascade" }),
    authorKind: text("author_kind").notNull(),
    authorId: uuid("author_id"),
    clientId: uuid("client_id"),
    body: text("body").notNull(),
    anchor: jsonb("anchor").$type<Record<string, unknown>>(),
    resolved: boolean("resolved").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("portal_feedback_item_idx").on(table.campaignItemId, table.createdAt),
    index("portal_feedback_client_idx").on(table.clientId),
  ],
);

export const reportSchedules = pgTable(
  "report_schedules",
  {
    reportScheduleId: uuid("report_schedule_id").defaultRandom().primaryKey(),
    reportKey: text("report_key").notNull(),
    /** Interval cadence keyword ('daily' | 'weekly' | 'monthly'); see reports/store.ts. */
    cadence: text("cadence").default("weekly").notNull(),
    recipients: jsonb("recipients").$type<string[]>().default([]).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (table) => [
    index("report_schedules_due_idx").on(table.enabled, table.lastRunAt),
  ],
);

export const reportRuns = pgTable(
  "report_runs",
  {
    reportRunId: uuid("report_run_id").defaultRandom().primaryKey(),
    reportScheduleId: uuid("report_schedule_id").references(
      () => reportSchedules.reportScheduleId,
      { onDelete: "set null" },
    ),
    reportKey: text("report_key").notNull(),
    status: text("status").default("pending").notNull(),
    /** Assembled {title, sections, generatedAt, markdown} + delivery receipt. */
    artifact: jsonb("artifact")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("report_runs_schedule_idx").on(
      table.reportScheduleId,
      table.createdAt,
    ),
  ],
);

/**
 * Import lineage (slot 0065) — one row per source row consumed by an importer,
 * mapping it to the CRM row it produced. The unique (source_system, source_table,
 * source_id) is the idempotency key: a re-run finds the row and skips.
 */
export const importLineage = pgTable(
  "import_lineage",
  {
    importLineageId: uuid("import_lineage_id").defaultRandom().primaryKey(),
    sourceSystem: text("source_system").notNull(),
    sourceTable: text("source_table").notNull(),
    sourceId: text("source_id").notNull(),
    targetTable: text("target_table").notNull(),
    targetId: uuid("target_id").notNull(),
    checksum: text("checksum").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("import_lineage_source_uniq").on(
      table.sourceSystem,
      table.sourceTable,
      table.sourceId,
    ),
    index("import_lineage_target_idx").on(table.targetTable, table.targetId),
    index("import_lineage_system_idx").on(
      table.sourceSystem,
      table.sourceTable,
    ),
  ],
);

/**
 * M8 outreach HITL items (migration 0059). draft → approved → sent gate flow;
 * every state change routes through the outreach gate in leadgen-router.ts.
 */
export const outreachItems = pgTable(
  "outreach_items",
  {
    outreachItemId: uuid("outreach_item_id").defaultRandom().primaryKey(),
    dealId: uuid("deal_id"),
    channel: text("channel").default("gmail").notNull(),
    state: text("state").default("draft").notNull(),
    recipient: text("recipient").default("").notNull(),
    subject: text("subject"),
    body: text("body").default("").notNull(),
    approvedBy: uuid("approved_by"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    externalId: text("external_id"),
    contactId: uuid("contact_id"),
    reworkFeedback: text("rework_feedback"),
    linkedinUrl: text("linkedin_url"),
    cadenceTouch: integer("cadence_touch").default(1).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("outreach_items_deal_idx").on(table.dealId, table.state),
    index("outreach_items_state_idx").on(table.state, table.createdAt),
    index("outreach_items_contact_idx").on(table.contactId),
  ],
);

/** M8 lead_intel (migration 0060) — who-knows-whom edge list. */
export const contactEdges = pgTable(
  "contact_edges",
  {
    contactEdgeId: uuid("contact_edge_id").defaultRandom().primaryKey(),
    fromContact: uuid("from_contact").notNull(),
    toContact: uuid("to_contact").notNull(),
    relation: text("relation").notNull(),
    weight: numeric("weight", { precision: 5, scale: 4 })
      .default("0.5")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("contact_edges_from_idx").on(table.fromContact),
    index("contact_edges_to_idx").on(table.toContact),
  ],
);

/** M8 lead_intel (migration 0060) — win/loss memory notes (embedding-ready). */
export const winLossNotes = pgTable(
  "win_loss_notes",
  {
    winLossNoteId: uuid("win_loss_note_id").defaultRandom().primaryKey(),
    dealId: uuid("deal_id"),
    outcome: text("outcome").notNull(),
    note: text("note").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("win_loss_notes_deal_idx").on(table.dealId),
    index("win_loss_notes_outcome_idx").on(table.outcome, table.createdAt),
  ],
);

/** M8 lead_intel (migration 0060) — competitor-scan findings. */
export const competitorFindings = pgTable(
  "competitor_findings",
  {
    competitorFindingId: uuid("competitor_finding_id")
      .defaultRandom()
      .primaryKey(),
    competitor: text("competitor").notNull(),
    source: text("source").notNull(),
    headline: text("headline").default("").notNull(),
    detail: text("detail").default("").notNull(),
    url: text("url"),
    scopeId: text("scope_id"),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("competitor_findings_competitor_idx").on(
      table.competitor,
      table.capturedAt,
    ),
    index("competitor_findings_scope_idx").on(table.scopeId),
  ],
);

/**
 * Sales & Growth raw staging (slot 0065) — the JSON export intermediate kept
 * verbatim as reconciliation evidence. Upserted on (source_table, source_id).
 */
export const salesgrowthImportStaging = pgTable(
  "salesgrowth_import_staging",
  {
    salesgrowthImportStagingId: uuid("salesgrowth_import_staging_id")
      .defaultRandom()
      .primaryKey(),
    sourceTable: text("source_table").notNull(),
    sourceId: text("source_id").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().default({}).notNull(),
    checksum: text("checksum").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("salesgrowth_import_staging_source_uniq").on(
      table.sourceTable,
      table.sourceId,
    ),
    index("salesgrowth_import_staging_table_idx").on(table.sourceTable),
  ],
);

/**
 * CRM quote versions per deal (migration 0066). Each save appends a new
 * version; margin fields are redacted for non-margin roles at the API layer.
 */
export const crmQuote = pgTable(
  "crm_quote",
  {
    quoteId: uuid("quote_id").defaultRandom().primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deal.dealId),
    version: integer("version").notNull(),
    lineItems: jsonb("line_items").$type<unknown[]>().default([]).notNull(),
    quoteValue: numeric("quote_value", { precision: 12, scale: 2 }),
    internalCost: numeric("internal_cost", { precision: 12, scale: 2 }),
    marginPct: numeric("margin_pct", { precision: 5, scale: 2 }),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }),
    discountApprovalTier: text("discount_approval_tier"),
    status: text("status").default("draft").notNull(),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("crm_quote_deal_version_uniq").on(table.dealId, table.version),
    index("crm_quote_deal_idx").on(table.dealId),
  ],
);

/** Sales OS singleton SOP settings (migration 0072). */
export const salesOsSettings = pgTable("sales_os_settings", {
  salesOsSettingsId: text("sales_os_settings_id")
    .primaryKey()
    .default("default"),
  settings: jsonb("settings")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedBy: uuid("updated_by"),
});

export const salesOsEvolveProposal = pgTable("sales_os_evolve_proposal", {
  salesOsEvolveProposalId: uuid("sales_os_evolve_proposal_id")
    .defaultRandom()
    .primaryKey(),
  focus: text("focus").default("").notNull(),
  summary: text("summary").default("").notNull(),
  proposed: jsonb("proposed")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  state: text("state").default("proposed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const companyResearch = pgTable(
  "company_research",
  {
    companyResearchId: uuid("company_research_id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").references(() => company.companyId),
    name: text("name").notNull(),
    sector: text("sector"),
    market: text("market"),
    website: text("website"),
    whyThis: text("why_this").default("").notNull(),
    evidence: text("evidence"),
    leadSourceLane: text("lead_source_lane")
      .default("industry_scanning")
      .notNull(),
    estimatedValueAed: numeric("estimated_value_aed", {
      precision: 14,
      scale: 2,
    }),
    suggestedServices: text("suggested_services"),
    buafBudget: integer("buaf_budget").default(0).notNull(),
    buafUrgency: integer("buaf_urgency").default(0).notNull(),
    buafAccess: integer("buaf_access").default(0).notNull(),
    buafFit: integer("buaf_fit").default(0).notNull(),
    buafTotal: integer("buaf_total").default(0).notNull(),
    temperature: text("temperature").default("cool").notNull(),
    approvalState: text("approval_state").default("researched").notNull(),
    reworkFeedback: text("rework_feedback"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("company_research_state_idx").on(
      table.approvalState,
      table.createdAt,
    ),
    index("company_research_company_idx").on(table.companyId),
  ],
);

export const contactResearch = pgTable(
  "contact_research",
  {
    contactResearchId: uuid("contact_research_id").defaultRandom().primaryKey(),
    companyResearchId: uuid("company_research_id").notNull(),
    companyId: uuid("company_id").references(() => company.companyId),
    contactId: uuid("contact_id").references(() => contact.contactId),
    dealId: uuid("deal_id").references(() => deal.dealId),
    fullName: text("full_name").notNull(),
    title: text("title"),
    seniority: text("seniority"),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    emailVerified: boolean("email_verified").default(false).notNull(),
    emailVerdict: text("email_verdict"),
    enrichSource: text("enrich_source").default("apollo").notNull(),
    enrichExternalId: text("enrich_external_id"),
    enrichProvider: text("enrich_provider"),
    approvalState: text("approval_state").default("found").notNull(),
    reworkFeedback: text("rework_feedback"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("contact_research_company_idx").on(
      table.companyResearchId,
      table.approvalState,
    ),
  ],
);

export const suppressionEntry = pgTable(
  "suppression_entry",
  {
    suppressionEntryId: uuid("suppression_entry_id")
      .defaultRandom()
      .primaryKey(),
    email: text("email"),
    domain: text("domain"),
    reason: text("reason").notNull(),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("suppression_entry_email_idx").on(table.email),
    index("suppression_entry_domain_idx").on(table.domain),
  ],
);

export const emailEvent = pgTable(
  "email_event",
  {
    emailEventId: uuid("email_event_id").defaultRandom().primaryKey(),
    outreachItemId: uuid("outreach_item_id"),
    contactId: uuid("contact_id"),
    kind: text("kind").notNull(),
    provider: text("provider").default("gmail").notNull(),
    externalId: text("external_id"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("email_event_outreach_idx").on(
      table.outreachItemId,
      table.occurredAt,
    ),
    index("email_event_kind_idx").on(table.kind, table.occurredAt),
  ],
);

export const intelSignal = pgTable(
  "intel_signal",
  {
    intelSignalId: uuid("intel_signal_id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").references(() => company.companyId),
    contactId: uuid("contact_id").references(() => contact.contactId),
    signalType: text("signal_type").default("other").notNull(),
    source: text("source"),
    signalDate: date("signal_date"),
    summary: text("summary").default("").notNull(),
    evidenceUrl: text("evidence_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("intel_signal_company_idx").on(table.companyId, table.createdAt),
  ],
);

export const salesOsCreditLedger = pgTable(
  "sales_os_credit_ledger",
  {
    salesOsCreditLedgerId: uuid("sales_os_credit_ledger_id")
      .defaultRandom()
      .primaryKey(),
    month: text("month").notNull(),
    kind: text("kind").notNull(),
    count: integer("count").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("sales_os_credit_ledger_month_idx").on(table.month, table.kind),
  ],
);

/**
 * Personal QM runtime binding. HRMNY remains the identity, authorization, and
 * operational authority; provider/runtime details are metadata, not grants.
 */
export const qmSessionBinding = pgTable(
  "qm_session_binding",
  {
    sessionId: uuid("session_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    scopeId: text("scope_id").notNull(),
    ownerEmployeeId: uuid("owner_employee_id")
      .notNull()
      .references(() => employee.employeeId, { onDelete: "restrict" }),
    lifecycle: text("lifecycle").notNull(),
    workspaceReadEnabled: boolean("workspace_read_enabled")
      .default(false)
      .notNull(),
    effectProposeEnabled: boolean("effect_propose_enabled")
      .default(false)
      .notNull(),
    runtimeKind: text("runtime_kind").notNull(),
    localFixtureId: text("local_fixture_id"),
    provider: text("provider"),
    providerResourceRef: text("provider_resource_ref"),
    providerReadbackReceipt: text("provider_readback_receipt"),
    upstreamVersion: text("upstream_version").notNull(),
    upstreamCommit: text("upstream_commit").notNull(),
    stateVersion: integer("state_version").default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("qm_session_owner_uniq").on(
      table.organizationId,
      table.ownerEmployeeId,
    ),
    uniqueIndex("qm_session_scope_uniq").on(table.scopeId),
    index("qm_session_owner_idx").on(
      table.organizationId,
      table.ownerEmployeeId,
      table.lifecycle,
    ),
    check(
      "qm_session_lifecycle_chk",
      sql`${table.lifecycle} in ('active', 'suspended', 'revoked')`,
    ),
    check(
      "qm_session_scope_chk",
      sql`${table.scopeId} = 'qm:organization:' || ${table.organizationId}::text || ':employee:' || ${table.ownerEmployeeId}::text`,
    ),
    check(
      "qm_session_runtime_chk",
      sql`(
        ${table.runtimeKind} = 'local-synthetic'
        and ${table.localFixtureId} is not null
        and ${table.provider} is null
        and ${table.providerResourceRef} is null
        and ${table.providerReadbackReceipt} is null
      ) or (
        ${table.runtimeKind} = 'provider'
        and ${table.localFixtureId} is null
        and ${table.provider} = 'flyio'
        and ${table.providerResourceRef} is not null
        and ${table.providerReadbackReceipt} is not null
      )`,
    ),
    check(
      "qm_session_upstream_pin_chk",
      sql`${table.upstreamVersion} = 'v0.1.5' and ${table.upstreamCommit} = 'd931fe963de3ac20b9a7526ea9a4873c0d8ed18e'`,
    ),
    check("qm_session_state_version_chk", sql`${table.stateVersion} >= 0`),
  ],
);

/** Immutable idempotency and authorization receipt for one QM command. */
export const qmCommandDecision = pgTable(
  "qm_command_decision",
  {
    receiptId: uuid("receipt_id").primaryKey(),
    requestId: uuid("request_id").notNull(),
    inputDigest: text("input_digest").notNull(),
    organizationId: uuid("organization_id").notNull(),
    actorEmployeeId: uuid("actor_employee_id")
      .notNull()
      .references(() => employee.employeeId, { onDelete: "restrict" }),
    // Intentionally not an FK: a generic denial may name an unknown session.
    sessionId: uuid("session_id").notNull(),
    scopeId: text("scope_id"),
    outcome: text("outcome").notNull(),
    reasonCode: text("reason_code").notNull(),
    requiredCapability: text("required_capability").notNull(),
    sessionStateVersion: integer("session_state_version"),
    sessionPolicyDigest: text("session_policy_digest"),
    upstreamCommit: text("upstream_commit"),
    runtimeKind: text("runtime_kind"),
    providerReadbackReceipt: text("provider_readback_receipt"),
    proposalId: uuid("proposal_id"),
    precheckId: uuid("precheck_id"),
    proposal: jsonb("proposal").$type<unknown>(),
    readPrecheck: jsonb("read_precheck").$type<unknown>(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("qm_decision_request_uniq").on(
      table.organizationId,
      table.actorEmployeeId,
      table.requestId,
    ),
    uniqueIndex("qm_decision_proposal_uniq")
      .on(table.proposalId)
      .where(sql`${table.proposalId} is not null`),
    uniqueIndex("qm_decision_precheck_uniq")
      .on(table.precheckId)
      .where(sql`${table.precheckId} is not null`),
    index("qm_decision_session_recorded_idx").on(
      table.sessionId,
      table.recordedAt.desc(),
    ),
    check(
      "qm_decision_input_digest_chk",
      sql`${table.inputDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "qm_decision_outcome_chk",
      sql`${table.outcome} in ('workspace_read_precheck_recorded', 'effect_proposal_recorded', 'denied', 'idempotency_conflict')`,
    ),
    check(
      "qm_decision_reason_chk",
      sql`${table.reasonCode} in ('WORKSPACE_READ_PRECHECK_RECORDED', 'EFFECT_PROPOSAL_RECORDED', 'AUTHORIZATION_DENIED', 'REQUEST_ID_PAYLOAD_CONFLICT', 'SESSION_POLICY_CHANGED')`,
    ),
    check(
      "qm_decision_capability_chk",
      sql`${table.requiredCapability} in ('workspace.read', 'effect.propose')`,
    ),
    check(
      "qm_decision_reason_outcome_chk",
      sql`(
        ${table.outcome} = 'workspace_read_precheck_recorded'
        and ${table.reasonCode} = 'WORKSPACE_READ_PRECHECK_RECORDED'
        and ${table.requiredCapability} = 'workspace.read'
      ) or (
        ${table.outcome} = 'effect_proposal_recorded'
        and ${table.reasonCode} = 'EFFECT_PROPOSAL_RECORDED'
        and ${table.requiredCapability} = 'effect.propose'
      ) or (
        ${table.outcome} = 'denied'
        and ${table.reasonCode} = 'AUTHORIZATION_DENIED'
      ) or (
        ${table.outcome} = 'idempotency_conflict'
        and ${table.reasonCode} in ('REQUEST_ID_PAYLOAD_CONFLICT', 'SESSION_POLICY_CHANGED')
      )`,
    ),
    check(
      "qm_decision_session_metadata_chk",
      sql`(
        ${table.outcome} = 'denied'
        and ${table.reasonCode} = 'AUTHORIZATION_DENIED'
        and ${table.scopeId} is null
        and ${table.sessionStateVersion} is null
        and ${table.sessionPolicyDigest} is null
        and ${table.upstreamCommit} is null
        and ${table.runtimeKind} is null
        and ${table.providerReadbackReceipt} is null
      ) or (
        ${table.outcome} <> 'denied'
        and ${table.scopeId} is not null
        and ${table.sessionStateVersion} >= 0
        and ${table.sessionPolicyDigest} ~ '^[a-f0-9]{64}$'
        and ${table.upstreamCommit} ~ '^[a-f0-9]{40}$'
        and (
          (${table.runtimeKind} = 'provider' and ${table.providerReadbackReceipt} is not null)
          or (${table.runtimeKind} = 'local-synthetic' and ${table.providerReadbackReceipt} is null)
        )
      )`,
    ),
    check(
      "qm_decision_work_record_chk",
      sql`(
        (
          ${table.outcome} = 'workspace_read_precheck_recorded'
          and ${table.precheckId} is not null
          and ${table.proposalId} is null
          and jsonb_typeof(${table.readPrecheck}) = 'object'
          and ${table.proposal} is null
          and ${table.readPrecheck}->>'precheckId' = ${table.precheckId}::text
          and ${table.readPrecheck}->>'organizationId' = ${table.organizationId}::text
          and ${table.readPrecheck}->>'scopeId' = ${table.scopeId}
          and ${table.readPrecheck}->>'sessionId' = ${table.sessionId}::text
          and ${table.readPrecheck}->>'requestedByEmployeeId' = ${table.actorEmployeeId}::text
          and (${table.readPrecheck}->>'createdAt')::timestamptz = ${table.recordedAt}
        ) is true
        or (
          ${table.outcome} = 'effect_proposal_recorded'
          and ${table.proposalId} is not null
          and ${table.precheckId} is null
          and jsonb_typeof(${table.proposal}) = 'object'
          and ${table.readPrecheck} is null
          and ${table.proposal}->>'proposalId' = ${table.proposalId}::text
          and ${table.proposal}->>'organizationId' = ${table.organizationId}::text
          and ${table.proposal}->>'scopeId' = ${table.scopeId}
          and ${table.proposal}->>'sessionId' = ${table.sessionId}::text
          and ${table.proposal}->>'proposedByEmployeeId' = ${table.actorEmployeeId}::text
          and (${table.proposal}->>'createdAt')::timestamptz = ${table.recordedAt}
        ) is true
        or (
          ${table.outcome} in ('denied', 'idempotency_conflict')
          and ${table.proposalId} is null
          and ${table.precheckId} is null
          and ${table.proposal} is null
          and ${table.readPrecheck} is null
        ) is true
      )`,
    ),
  ],
);
