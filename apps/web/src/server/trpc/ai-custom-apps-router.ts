import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  REPORT_METRICS,
  availableReportMetrics,
  canAccessCustomApp,
  canUseReportMetrics,
  customFieldDefinitionsSchema,
  isCustomAppsAdmin,
  proposeReport,
  validateCustomAppRecord,
} from "../ai-custom-apps";
import { getDb } from "../db";
import { writeAudit } from "../m1-persistence";
import { router, staffProcedure, type TrpcContext } from "./trpc";

type CustomAppRow = {
  custom_app_id: string;
  fields: unknown;
  access_scope: "admin_only" | "all_staff" | "roles";
  allowed_roles: unknown;
  record_visibility: "own" | "all";
  is_active: boolean;
};

type GovernedReportRow = {
  governed_report_id: string;
  name: string;
  metrics: unknown;
  filters: unknown;
  status: "draft" | "active" | "archived";
  created_by_employee_id: string;
};

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for AI reports and custom apps",
    });
  }
  return db;
}

function actor(ctx: TrpcContext) {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return { employeeId: ctx.employeeId, roles: ctx.roles };
}

function requireAdmin(ctx: TrpcContext) {
  if (!isCustomAppsAdmin(ctx.roles)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return actor(ctx);
}

function requireReportUser(ctx: TrpcContext) {
  if (availableReportMetrics(ctx.roles).length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Report access required",
    });
  }
  return actor(ctx);
}

async function audit(
  ctx: TrpcContext,
  action: string,
  entityType: string,
  entityId: string,
  after: Record<string, unknown>,
) {
  await writeAudit({
    actorEmployeeId: actor(ctx).employeeId,
    action,
    entityType,
    entityId,
    before: null,
    after,
    reason: null,
  });
}

function stringArray(value: unknown): string[] {
  return z.array(z.string()).parse(value);
}

async function loadApp(appId: string): Promise<CustomAppRow> {
  const rows = await requireDb().execute(sql<CustomAppRow>`
    select custom_app_id, fields, access_scope, allowed_roles,
      record_visibility, is_active
    from public.custom_app
    where custom_app_id = ${appId}::uuid
    limit 1
  `);
  const app = rows[0] as unknown as CustomAppRow | undefined;
  if (!app) throw new TRPCError({ code: "NOT_FOUND" });
  return app;
}

function requireAppAccess(ctx: TrpcContext, app: CustomAppRow) {
  if (
    !app.is_active ||
    !canAccessCustomApp(ctx.roles, {
      accessScope: app.access_scope,
      allowedRoles: stringArray(app.allowed_roles),
    })
  ) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

async function loadReport(reportId: string): Promise<GovernedReportRow> {
  const rows = await requireDb().execute(sql<GovernedReportRow>`
    select governed_report_id, name, metrics, filters, status,
      created_by_employee_id
    from public.governed_report
    where governed_report_id = ${reportId}::uuid
    limit 1
  `);
  const report = rows[0] as unknown as GovernedReportRow | undefined;
  if (!report) throw new TRPCError({ code: "NOT_FOUND" });
  return report;
}

function requireReportAccess(ctx: TrpcContext, report: GovernedReportRow) {
  if (!canUseReportMetrics(ctx.roles, stringArray(report.metrics))) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

const uuid = z.string().uuid();
const roleKey = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);
const boundedObject = z.record(z.unknown()).superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 256_000) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Record is too large",
    });
  }
});
const reportFiltersSchema = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    department: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: "Invalid report date range",
  });
const proposedReportSchema = z.object({
  name: z.string().trim().min(1).max(80),
  metrics: z.array(z.string()).min(1).max(20),
  filters: reportFiltersSchema,
});

type ReportFilters = z.infer<typeof reportFiltersSchema>;

async function runMetric(key: string, filters: ReportFilters) {
  const from = filters.from ?? "1900-01-01";
  const to = filters.to ?? "2999-12-31";
  const department = filters.department ?? null;
  let rows: Array<{ value: unknown }>;

  switch (key) {
    case "workforce.headcount":
      rows = await requireDb().execute(sql<{ value: unknown }>`
        select count(*)::integer as value
        from public.employee
        where is_active = true
          and (${department}::text is null or lower(department) = lower(${department}))
      `);
      break;
    case "leave.requests":
      rows = await requireDb().execute(sql<{ value: unknown }>`
        select count(*)::integer as value
        from public.leave_request request
        join public.employee employee on employee.employee_id = request.employee_id
        where request.start_date <= ${to}::date and request.end_date >= ${from}::date
          and (${department}::text is null or lower(employee.department) = lower(${department}))
      `);
      break;
    case "attendance.worked_hours":
      rows = await requireDb().execute(sql<{ value: unknown }>`
        select coalesce(sum(extract(epoch from (record.clock_out_at - record.clock_in_at))) / 3600, 0) as value
        from public.attendance_record record
        join public.employee employee on employee.employee_id = record.employee_id
        where record.clock_out_at is not null
          and record.work_date between ${from}::date and ${to}::date
          and (${department}::text is null or lower(employee.department) = lower(${department}))
      `);
      break;
    case "payroll.total_gross":
      rows = await requireDb().execute(sql<{ value: unknown }>`
        select coalesce(sum(total_gross), 0) as value
        from public.payroll_run
        where status <> 'cancelled'
          and period_start <= ${to}::date and period_end >= ${from}::date
      `);
      break;
    case "expenses.approved_total":
      rows = await requireDb().execute(sql<{ value: unknown }>`
        select coalesce(sum(expense.amount), 0) as value
        from public.employee_expense expense
        join public.employee employee on employee.employee_id = expense.employee_id
        where expense.status in ('approved', 'reimbursed')
          and expense.expense_date between ${from}::date and ${to}::date
          and (${department}::text is null or lower(employee.department) = lower(${department}))
      `);
      break;
    case "recruitment.open_requisitions":
      rows = await requireDb().execute(sql<{ value: unknown }>`
        select count(*)::integer as value
        from public.job_requisition
        where status = 'open'
          and (${department}::text is null or lower(department) = lower(${department}))
      `);
      break;
    case "benefits.active_enrolments":
      rows = await requireDb().execute(sql<{ value: unknown }>`
        select count(*)::integer as value
        from public.benefit_enrolment enrolment
        join public.employee employee on employee.employee_id = enrolment.employee_id
        where enrolment.status = 'active'
          and (${department}::text is null or lower(employee.department) = lower(${department}))
      `);
      break;
    case "timesheets.billable_hours":
      rows = await requireDb().execute(sql<{ value: unknown }>`
        select coalesce(sum(entry.minutes) / 60.0, 0) as value
        from public.time_entry entry
        join public.employee employee on employee.employee_id = entry.employee_id
        where entry.status = 'approved' and entry.is_billable = true
          and entry.work_date between ${from}::date and ${to}::date
          and (${department}::text is null or lower(employee.department) = lower(${department}))
      `);
      break;
    default:
      throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown metric" });
  }

  const metric = REPORT_METRICS.find((item) => item.key === key)!;
  return { key, value: Number(rows[0]?.value ?? 0), unit: metric.unit };
}

export const aiCustomAppsRouter = router({
  customApps: router({
    list: staffProcedure.query(async ({ ctx }) => {
      actor(ctx);
      const rows = await requireDb().execute<CustomAppRow>(sql`
        select * from public.custom_app order by name
      `);
      return rows.filter((app) =>
        canAccessCustomApp(ctx.roles, {
          accessScope: app.access_scope,
          allowedRoles: stringArray(app.allowed_roles),
        }),
      );
    }),

    create: staffProcedure
      .input(
        z
          .object({
            key: z
              .string()
              .trim()
              .min(2)
              .max(64)
              .regex(/^[a-z][a-z0-9_]*$/),
            name: z.string().trim().min(2).max(160),
            description: z.string().trim().max(2_000).optional(),
            fields: customFieldDefinitionsSchema,
            accessScope: z.enum(["admin_only", "all_staff", "roles"]),
            allowedRoles: z.array(roleKey).max(30).default([]),
            recordVisibility: z.enum(["own", "all"]).default("own"),
          })
          .refine(
            (value) =>
              value.accessScope !== "roles" || value.allowedRoles.length > 0,
            {
              path: ["allowedRoles"],
              message: "At least one role is required",
            },
          ),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const rows = await requireDb().execute(sql`
          insert into public.custom_app (
            key, name, description, fields, access_scope, allowed_roles,
            record_visibility, created_by_employee_id
          ) values (
            ${input.key}, ${input.name}, ${input.description ?? null},
            ${JSON.stringify(input.fields)}::jsonb, ${input.accessScope},
            array(select jsonb_array_elements_text(${JSON.stringify(input.allowedRoles)}::jsonb)),
            ${input.recordVisibility}, ${current.employeeId}::uuid
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "custom_app.create",
          "custom_app",
          String(created.custom_app_id),
          {
            key: input.key,
            accessScope: input.accessScope,
          },
        );
        return created;
      }),

    setActive: staffProcedure
      .input(z.object({ appId: uuid, isActive: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx);
        const rows = await requireDb().execute(sql`
          update public.custom_app
          set is_active = ${input.isActive}, updated_at = now()
          where custom_app_id = ${input.appId}::uuid
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(ctx, "custom_app.status", "custom_app", input.appId, {
          isActive: input.isActive,
        });
        return rows[0];
      }),

    records: router({
      list: staffProcedure
        .input(
          z.object({
            appId: uuid,
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).max(100_000).default(0),
          }),
        )
        .query(async ({ input, ctx }) => {
          const current = actor(ctx);
          const app = await loadApp(input.appId);
          requireAppAccess(ctx, app);
          const canReadAll =
            isCustomAppsAdmin(current.roles) || app.record_visibility === "all";
          return requireDb().execute(sql`
            select * from public.custom_app_record
            where custom_app_id = ${input.appId}::uuid
              and deleted_at is null
              and (${canReadAll} or created_by_employee_id = ${current.employeeId}::uuid)
            order by created_at desc
            limit ${input.limit} offset ${input.offset}
          `);
        }),

      create: staffProcedure
        .input(z.object({ appId: uuid, data: boundedObject }))
        .mutation(async ({ input, ctx }) => {
          const current = actor(ctx);
          const app = await loadApp(input.appId);
          requireAppAccess(ctx, app);
          const data = validateCustomAppRecord(app.fields, input.data);
          const rows = await requireDb().execute(sql`
            insert into public.custom_app_record (
              custom_app_id, data, created_by_employee_id
            ) values (
              ${input.appId}::uuid, ${JSON.stringify(data)}::jsonb,
              ${current.employeeId}::uuid
            )
            returning *
          `);
          const created = rows[0]!;
          await audit(
            ctx,
            "custom_app.record.create",
            "custom_app_record",
            String(created.custom_app_record_id),
            { appId: input.appId },
          );
          return created;
        }),

      update: staffProcedure
        .input(z.object({ recordId: uuid, data: boundedObject }))
        .mutation(async ({ input, ctx }) => {
          const current = actor(ctx);
          const rows = await requireDb().execute<
            CustomAppRow & { created_by_employee_id: string }
          >(sql`
            select app.custom_app_id, app.fields, app.access_scope,
              app.allowed_roles, app.record_visibility, app.is_active,
              record.created_by_employee_id
            from public.custom_app_record record
            join public.custom_app app on app.custom_app_id = record.custom_app_id
            where record.custom_app_record_id = ${input.recordId}::uuid
              and record.deleted_at is null
            limit 1
          `);
          const record = rows[0];
          if (!record) throw new TRPCError({ code: "NOT_FOUND" });
          requireAppAccess(ctx, record);
          if (
            !isCustomAppsAdmin(current.roles) &&
            record.created_by_employee_id !== current.employeeId
          ) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
          const data = validateCustomAppRecord(record.fields, input.data);
          const updated = await requireDb().execute(sql`
            update public.custom_app_record
            set data = ${JSON.stringify(data)}::jsonb, updated_at = now()
            where custom_app_record_id = ${input.recordId}::uuid
              and deleted_at is null
            returning *
          `);
          await audit(
            ctx,
            "custom_app.record.update",
            "custom_app_record",
            input.recordId,
            {
              appId: record.custom_app_id,
            },
          );
          return updated[0]!;
        }),

      archive: staffProcedure
        .input(z.object({ recordId: uuid }))
        .mutation(async ({ input, ctx }) => {
          const current = actor(ctx);
          const rows = await requireDb().execute<
            CustomAppRow & { created_by_employee_id: string }
          >(sql`
            select app.custom_app_id, app.fields, app.access_scope,
              app.allowed_roles, app.record_visibility, app.is_active,
              record.created_by_employee_id
            from public.custom_app_record record
            join public.custom_app app on app.custom_app_id = record.custom_app_id
            where record.custom_app_record_id = ${input.recordId}::uuid
              and record.deleted_at is null
            limit 1
          `);
          const record = rows[0];
          if (!record) throw new TRPCError({ code: "NOT_FOUND" });
          requireAppAccess(ctx, record);
          if (
            !isCustomAppsAdmin(current.roles) &&
            record.created_by_employee_id !== current.employeeId
          ) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
          await requireDb().execute(sql`
            update public.custom_app_record
            set deleted_at = now(), updated_at = now()
            where custom_app_record_id = ${input.recordId}::uuid
          `);
          await audit(
            ctx,
            "custom_app.record.archive",
            "custom_app_record",
            input.recordId,
            {
              appId: record.custom_app_id,
            },
          );
          return { ok: true };
        }),
    }),
  }),

  reports: router({
    metrics: staffProcedure.query(({ ctx }) => {
      requireReportUser(ctx);
      return availableReportMetrics(ctx.roles).map(
        ({ keywords: _keywords, roles: _roles, ...metric }) => metric,
      );
    }),

    list: staffProcedure.query(async ({ ctx }) => {
      const current = requireReportUser(ctx);
      const rows = await requireDb().execute<GovernedReportRow>(sql`
        select * from public.governed_report order by created_at desc
      `);
      return rows.filter(
        (report) =>
          canUseReportMetrics(current.roles, stringArray(report.metrics)) &&
          (report.status === "active" ||
            report.created_by_employee_id === current.employeeId ||
            isCustomAppsAdmin(current.roles)),
      );
    }),

    create: staffProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          description: z.string().trim().max(2_000).optional(),
          metrics: z.array(z.string()).min(1).max(20),
          filters: reportFiltersSchema.default({}),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireReportUser(ctx);
        if (!canUseReportMetrics(current.roles, input.metrics)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Metric access denied",
          });
        }
        const rows = await requireDb().execute(sql`
          insert into public.governed_report (
            name, description, metrics, filters, created_by_employee_id
          ) values (
            ${input.name}, ${input.description ?? null},
            array(select jsonb_array_elements_text(${JSON.stringify(input.metrics)}::jsonb)),
            ${JSON.stringify(input.filters)}::jsonb, ${current.employeeId}::uuid
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "governed_report.create",
          "governed_report",
          String(created.governed_report_id),
          {
            metrics: input.metrics,
            status: "draft",
          },
        );
        return created;
      }),

    approve: staffProcedure
      .input(z.object({ reportId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const rows = await requireDb().execute(sql`
          update public.governed_report
          set status = 'active', approved_by_employee_id = ${current.employeeId}::uuid,
            approved_at = now(), updated_at = now()
          where governed_report_id = ${input.reportId}::uuid and status = 'draft'
          returning *
        `);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "governed_report.approve",
          "governed_report",
          input.reportId,
          {
            status: "active",
          },
        );
        return rows[0];
      }),

    run: staffProcedure
      .input(z.object({ reportId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const current = requireReportUser(ctx);
        const report = await loadReport(input.reportId);
        requireReportAccess(ctx, report);
        if (report.status !== "active") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Report is not approved",
          });
        }
        const metrics = stringArray(report.metrics);
        const filters = reportFiltersSchema.parse(report.filters);
        const runs = await requireDb().execute(sql`
          insert into public.governed_report_run (
            governed_report_id, requested_by_employee_id
          ) values (${input.reportId}::uuid, ${current.employeeId}::uuid)
          returning *
        `);
        const runId = String(runs[0]!.governed_report_run_id);
        try {
          const values = await Promise.all(
            metrics.map((metric) => runMetric(metric, filters)),
          );
          const result = {
            metrics: values,
            filters,
            generatedAt: new Date().toISOString(),
          };
          const completed = await requireDb().execute(sql`
            update public.governed_report_run
            set status = 'completed', result = ${JSON.stringify(result)}::jsonb,
              completed_at = now()
            where governed_report_run_id = ${runId}::uuid
            returning *
          `);
          await audit(
            ctx,
            "governed_report.run",
            "governed_report_run",
            runId,
            {
              reportId: input.reportId,
              metricCount: metrics.length,
            },
          );
          return completed[0]!;
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Report failed";
          await requireDb().execute(sql`
            update public.governed_report_run
            set status = 'failed', error_message = ${message}, completed_at = now()
            where governed_report_run_id = ${runId}::uuid
          `);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Report failed",
          });
        }
      }),

    runs: staffProcedure
      .input(
        z.object({
          reportId: uuid,
          limit: z.number().int().min(1).max(100).default(30),
        }),
      )
      .query(async ({ input, ctx }) => {
        requireReportUser(ctx);
        const report = await loadReport(input.reportId);
        requireReportAccess(ctx, report);
        return requireDb().execute(sql`
          select * from public.governed_report_run
          where governed_report_id = ${input.reportId}::uuid
          order by created_at desc limit ${input.limit}
        `);
      }),

    schedules: router({
      list: staffProcedure.query(async ({ ctx }) => {
        requireAdmin(ctx);
        return requireDb().execute(sql`
          select schedule.*, report.name as report_name
          from public.governed_report_schedule schedule
          join public.governed_report report
            on report.governed_report_id = schedule.governed_report_id
          order by schedule.next_run_at
        `);
      }),

      create: staffProcedure
        .input(
          z.object({
            reportId: uuid,
            cadence: z.enum(["daily", "weekly", "monthly"]),
            exportFormat: z.enum(["csv", "json"]).default("csv"),
            recipients: z
              .array(z.string().trim().email().max(320))
              .min(1)
              .max(50),
            nextRunAt: z.string().datetime(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const current = requireAdmin(ctx);
          const report = await loadReport(input.reportId);
          requireReportAccess(ctx, report);
          if (report.status !== "active") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Report is not approved",
            });
          }
          const rows = await requireDb().execute(sql`
            insert into public.governed_report_schedule (
              governed_report_id, cadence, export_format, recipients,
              next_run_at, created_by_employee_id
            ) values (
              ${input.reportId}::uuid, ${input.cadence}, ${input.exportFormat},
              array(select jsonb_array_elements_text(${JSON.stringify(input.recipients)}::jsonb)),
              ${input.nextRunAt}::timestamptz, ${current.employeeId}::uuid
            )
            returning *
          `);
          const created = rows[0]!;
          await audit(
            ctx,
            "governed_report.schedule.create",
            "governed_report_schedule",
            String(created.governed_report_schedule_id),
            { reportId: input.reportId, cadence: input.cadence },
          );
          return created;
        }),

      setStatus: staffProcedure
        .input(
          z.object({
            scheduleId: uuid,
            status: z.enum(["active", "paused", "archived"]),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          requireAdmin(ctx);
          const rows = await requireDb().execute(sql`
            update public.governed_report_schedule
            set status = ${input.status}, updated_at = now()
            where governed_report_schedule_id = ${input.scheduleId}::uuid
            returning *
          `);
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
          await audit(
            ctx,
            "governed_report.schedule.status",
            "governed_report_schedule",
            input.scheduleId,
            {
              status: input.status,
            },
          );
          return rows[0];
        }),
    }),

    naturalLanguage: router({
      list: staffProcedure.query(async ({ ctx }) => {
        const current = requireReportUser(ctx);
        const all = isCustomAppsAdmin(current.roles);
        return requireDb().execute(sql`
          select * from public.report_natural_language_request
          where ${all} or requested_by_employee_id = ${current.employeeId}::uuid
          order by created_at desc
        `);
      }),

      propose: staffProcedure
        .input(z.object({ requestText: z.string().trim().min(3).max(2_000) }))
        .mutation(async ({ input, ctx }) => {
          const current = requireReportUser(ctx);
          const proposal = proposedReportSchema.parse(
            proposeReport(input.requestText, current.roles),
          );
          const rows = await requireDb().execute(sql`
            insert into public.report_natural_language_request (
              request_text, proposed_definition, requested_by_employee_id
            ) values (
              ${input.requestText}, ${JSON.stringify(proposal)}::jsonb,
              ${current.employeeId}::uuid
            )
            returning *
          `);
          const created = rows[0]!;
          await audit(
            ctx,
            "governed_report.propose",
            "report_natural_language_request",
            String(created.report_natural_language_request_id),
            { metrics: proposal.metrics },
          );
          return created;
        }),

      accept: staffProcedure
        .input(z.object({ requestId: uuid }))
        .mutation(async ({ input, ctx }) => {
          const current = requireReportUser(ctx);
          const result = await requireDb().transaction(async (tx) => {
            const requests = await tx.execute<{
              proposed_definition: unknown;
              requested_by_employee_id: string;
            }>(sql`
              select proposed_definition, requested_by_employee_id
              from public.report_natural_language_request
              where report_natural_language_request_id = ${input.requestId}::uuid
                and status = 'proposed'
              for update
            `);
            const request = requests[0];
            if (!request) throw new TRPCError({ code: "NOT_FOUND" });
            if (
              request.requested_by_employee_id !== current.employeeId &&
              !isCustomAppsAdmin(current.roles)
            ) {
              throw new TRPCError({ code: "FORBIDDEN" });
            }
            const proposal = proposedReportSchema.parse(
              request.proposed_definition,
            );
            if (!canUseReportMetrics(current.roles, proposal.metrics)) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "Metric access denied",
              });
            }
            const reports = await tx.execute(sql`
              insert into public.governed_report (
                name, metrics, filters, created_by_employee_id
              ) values (
                ${proposal.name},
                array(select jsonb_array_elements_text(${JSON.stringify(proposal.metrics)}::jsonb)),
                ${JSON.stringify(proposal.filters)}::jsonb,
                ${current.employeeId}::uuid
              ) returning *
            `);
            const report = reports[0]!;
            await tx.execute(sql`
              update public.report_natural_language_request
              set status = 'accepted',
                accepted_report_id = ${String(report.governed_report_id)}::uuid,
                decided_at = now(), updated_at = now()
              where report_natural_language_request_id = ${input.requestId}::uuid
            `);
            return report;
          });
          await audit(
            ctx,
            "governed_report.proposal.accept",
            "governed_report",
            String(result.governed_report_id),
            {
              requestId: input.requestId,
              status: "draft",
            },
          );
          return result;
        }),
    }),
  }),
});
