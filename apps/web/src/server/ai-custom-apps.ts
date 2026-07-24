import { z } from "zod";

const ADMIN_ROLES = new Set(["partner", "director", "admin"]);

const fieldBase = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  required: z.boolean().default(false),
});

export const customFieldDefinitionSchema = z.discriminatedUnion("type", [
  fieldBase.extend({ type: z.literal("text") }),
  fieldBase.extend({ type: z.literal("number") }),
  fieldBase.extend({ type: z.literal("boolean") }),
  fieldBase.extend({ type: z.literal("date") }),
  fieldBase.extend({ type: z.literal("email") }),
  fieldBase.extend({
    type: z.literal("enum"),
    options: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  }),
]);

export const customFieldDefinitionsSchema = z
  .array(customFieldDefinitionSchema)
  .min(1)
  .max(40)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: "Field keys must be unique",
        });
      }
      seen.add(field.key);
      if (
        field.type === "enum" &&
        new Set(field.options).size !== field.options.length
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "options"],
          message: "Enum options must be unique",
        });
      }
    });
  });

export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

export type CustomAppAccess = {
  accessScope: "admin_only" | "all_staff" | "roles";
  allowedRoles: readonly string[];
};

export function isCustomAppsAdmin(roles: readonly string[]): boolean {
  return roles.some((role) => ADMIN_ROLES.has(role.toLowerCase()));
}

export function canAccessCustomApp(
  roles: readonly string[],
  app: CustomAppAccess,
): boolean {
  if (isCustomAppsAdmin(roles)) return true;
  if (app.accessScope === "all_staff") return true;
  if (app.accessScope === "admin_only") return false;
  const actorRoles = new Set(roles.map((role) => role.toLowerCase()));
  return app.allowedRoles.some((role) => actorRoles.has(role.toLowerCase()));
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function schemaForField(field: CustomFieldDefinition): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  switch (field.type) {
    case "text":
      schema = z.string().trim().min(1).max(20_000);
      break;
    case "number":
      schema = z.number().finite();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "date":
      schema = z.string().refine(validDate, "Invalid date");
      break;
    case "email":
      schema = z.string().trim().email().max(320);
      break;
    case "enum":
      schema = z
        .string()
        .refine((value) => field.options.includes(value), "Invalid option");
      break;
  }
  return field.required ? schema : schema.optional();
}

/** Validates data only; definitions never become executable code or SQL. */
export function validateCustomAppRecord(
  rawFields: unknown,
  value: unknown,
): Record<string, unknown> {
  const fields = customFieldDefinitionsSchema.parse(rawFields);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) shape[field.key] = schemaForField(field);
  return z.object(shape).strict().parse(value);
}

export type ReportMetric = {
  key: string;
  label: string;
  description: string;
  unit: "count" | "hours" | "AED";
  roles: readonly string[];
  keywords: readonly string[];
};

export const REPORT_METRICS: readonly ReportMetric[] = [
  {
    key: "workforce.headcount",
    label: "Active headcount",
    description: "Current active employee count",
    unit: "count",
    roles: ["partner", "director", "hr", "finance", "manager"],
    keywords: ["headcount", "employee", "workforce", "staff"],
  },
  {
    key: "leave.requests",
    label: "Leave requests",
    description: "Leave requests in the selected period",
    unit: "count",
    roles: ["partner", "director", "hr", "manager"],
    keywords: ["leave", "time off", "holiday"],
  },
  {
    key: "attendance.worked_hours",
    label: "Worked hours",
    description: "Completed attendance hours in the selected period",
    unit: "hours",
    roles: ["partner", "director", "hr", "manager"],
    keywords: ["attendance", "worked hours", "clock", "late"],
  },
  {
    key: "payroll.total_gross",
    label: "Gross payroll",
    description: "Gross payroll for non-cancelled runs in the selected period",
    unit: "AED",
    roles: ["partner", "director", "hr", "finance"],
    keywords: ["payroll", "salary", "gross", "wages"],
  },
  {
    key: "expenses.approved_total",
    label: "Approved expenses",
    description: "Approved or reimbursed expenses in the selected period",
    unit: "AED",
    roles: ["partner", "director", "finance"],
    keywords: ["expense", "reimbursement", "spend"],
  },
  {
    key: "recruitment.open_requisitions",
    label: "Open requisitions",
    description: "Current open job requisitions",
    unit: "count",
    roles: ["partner", "director", "hr"],
    keywords: ["recruitment", "hiring", "requisition", "vacancy"],
  },
  {
    key: "benefits.active_enrolments",
    label: "Active benefit enrolments",
    description: "Current active benefit enrolments",
    unit: "count",
    roles: ["partner", "director", "hr", "finance"],
    keywords: ["benefit", "insurance", "enrolment", "enrollment"],
  },
  {
    key: "timesheets.billable_hours",
    label: "Billable hours",
    description: "Approved billable time in the selected period",
    unit: "hours",
    roles: ["partner", "director", "finance", "manager"],
    keywords: ["timesheet", "billable", "utilisation", "utilization"],
  },
];

export function availableReportMetrics(
  roles: readonly string[],
): readonly ReportMetric[] {
  const actorRoles = new Set(roles.map((role) => role.toLowerCase()));
  return REPORT_METRICS.filter((metric) =>
    metric.roles.some((role) => actorRoles.has(role)),
  );
}

export function canUseReportMetrics(
  roles: readonly string[],
  metricKeys: readonly string[],
): boolean {
  const allowed = new Set(
    availableReportMetrics(roles).map((metric) => metric.key),
  );
  return metricKeys.length > 0 && metricKeys.every((key) => allowed.has(key));
}

export type ProposedReport = {
  name: string;
  metrics: string[];
  filters: Record<string, never>;
};

/** A deterministic, permission-aware proposal. It never produces or accepts SQL. */
export function proposeReport(
  requestText: string,
  roles: readonly string[],
): ProposedReport {
  const request = requestText.trim();
  const lower = request.toLowerCase();
  const available = availableReportMetrics(roles);
  const matched = available.filter((metric) =>
    metric.keywords.some((keyword) => lower.includes(keyword)),
  );
  const metrics = (matched.length > 0 ? matched : available.slice(0, 1)).map(
    (metric) => metric.key,
  );
  return {
    name: request.length > 80 ? `${request.slice(0, 77)}...` : request,
    metrics,
    filters: {},
  };
}
