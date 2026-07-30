import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { writeAudit } from "../m1-persistence";
import { REPORT_REGISTRY, getReportEntry } from "../reports/registry";
import { CADENCES, renderMarkdown, type ReportArtifact } from "../reports/types";
import {
  createSchedule,
  deleteSchedule,
  getRun,
  getSchedule,
  listRuns,
  listSchedules,
  updateSchedule,
} from "../reports/store";
import { runScheduleNow } from "../inngest/report-scheduler";
import { requirePermission, router, staffProcedure } from "./trpc";

/**
 * Scheduled-reports surface (importable module — orchestrator wires it into
 * appRouter in root.ts; deliberately NOT registered here). Reads are staff;
 * schedule mutations + run-now require `admin:reports` (same requirePermission
 * pattern as the Asana / Work admin routers) and every mutation writes an
 * audit_event. The runner itself lives in inngest/report-scheduler.ts.
 */

const reportsAdminProcedure = staffProcedure.use(
  requirePermission("admin", "reports"),
);

const cadenceSchema = z.enum(CADENCES as [string, ...string[]]);
const reportKeySchema = z.string().refine((k) => getReportEntry(k) != null, {
  message: "unknown report_key",
});
const recipientsSchema = z.array(z.string().email()).min(1).max(50);

function markdownOf(artifact: Record<string, unknown>): string | null {
  if (typeof artifact.markdown === "string") return artifact.markdown;
  if (Array.isArray(artifact.sections) && typeof artifact.title === "string") {
    return renderMarkdown(artifact as unknown as ReportArtifact);
  }
  return null;
}

export const reportsRouter = router({
  /** Report builder v1 catalogue — key → title for the schedule picker. */
  catalog: staffProcedure.query(() =>
    Object.values(REPORT_REGISTRY).map((e) => ({ key: e.key, title: e.title })),
  ),

  list: staffProcedure.query(() => listSchedules()),

  get: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getSchedule(input.id)),

  create: reportsAdminProcedure
    .input(
      z.object({
        reportKey: reportKeySchema,
        cadence: cadenceSchema,
        recipients: recipientsSchema,
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await createSchedule({
        reportKey: input.reportKey,
        cadence: input.cadence,
        recipients: input.recipients,
        enabled: input.enabled,
        createdBy: ctx.employeeId,
      });
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "report_schedule.create",
        entityType: "report_schedule",
        entityId: row.reportScheduleId,
        before: null,
        after: { ...row },
        reason: null,
      });
      return row;
    }),

  update: reportsAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        cadence: cadenceSchema.optional(),
        recipients: recipientsSchema.optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const before = await getSchedule(input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND" });
      const row = await updateSchedule(input.id, {
        cadence: input.cadence,
        recipients: input.recipients,
        enabled: input.enabled,
      });
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "report_schedule.update",
        entityType: "report_schedule",
        entityId: input.id,
        before: { ...before },
        after: row ? { ...row } : null,
        reason: null,
      });
      return row;
    }),

  delete: reportsAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const before = await getSchedule(input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND" });
      const ok = await deleteSchedule(input.id);
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "report_schedule.delete",
        entityType: "report_schedule",
        entityId: input.id,
        before: { ...before },
        after: null,
        reason: null,
      });
      return { ok };
    }),

  /** Manual run — assembles + sends (mock Resend) regardless of cadence. */
  runNow: reportsAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const run = await runScheduleNow(input.id);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "report_schedule.run_now",
        entityType: "report_run",
        entityId: run.reportRunId,
        before: null,
        after: { status: run.status, reportKey: run.reportKey },
        reason: null,
      });
      return run;
    }),

  listRuns: staffProcedure
    .input(z.object({ scheduleId: z.string().uuid().optional() }).optional())
    .query(({ input }) => listRuns(input?.scheduleId)),

  /** Rendered markdown artifact for a single run (null for failed runs). */
  getArtifact: staffProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ input }) => {
      const run = await getRun(input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        reportRunId: run.reportRunId,
        reportKey: run.reportKey,
        status: run.status,
        markdown: markdownOf(run.artifact),
      };
    }),
});
