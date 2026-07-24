import {
  boolean,
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
    jobKey: text("job_key").notNull().unique(),
    kind: text("kind").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [index("scheduled_job_due_idx").on(table.status, table.runAt)],
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
