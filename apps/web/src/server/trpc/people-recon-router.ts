/**
 * Parallel-payroll reconciliation harness (NOT registered in appRouter).
 *
 * Reads the native payroll run (Postgres) and a Bayzat-source cycle (CSV import
 * shape) for the same period, reconciles them, and records payroll sign-off with
 * maker/checker separation. Wire into root.ts under e.g. `payrollRecon` when the
 * cutover programme is ready to expose it.
 */
import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import { writeAudit } from "../m1-persistence";
import {
  reconcilePayrollCycle,
  sourceEntriesFromBayzatCsv,
  type PayrollCycleEntry,
} from "../people-recon/reconcile";
import { evaluateRollbackGate, evaluateSignoff } from "../people-recon/gates";
import { reconStore } from "../people-recon/store";
import {
  requirePermission,
  router,
  staffProcedure,
  type TrpcContext,
} from "./trpc";

const money = z.string().regex(/^\d+(?:\.\d{1,2})?$/);

const cycle = z.object({
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  label: z.string().trim().max(200).optional(),
});

const sourceEntry = z.object({
  externalId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().max(200).optional(),
  gross: money,
  net: money,
  allowances: money,
  deductions: money,
});

type NativeRow = {
  employee_id: string;
  external_id: string | null;
  display_name: string | null;
  gross: string;
  net: string;
  allowances: string;
  deductions: string;
  created_by_employee_id: string;
};

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for payroll reconciliation",
    });
  }
  return db;
}

function actorId(ctx: TrpcContext): string {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return ctx.employeeId;
}

/** Read the latest native payroll run for the period as reconciliation entries. */
async function readNativeCycle(periodStart: string, periodEnd: string) {
  const rows = await requireDb().execute<NativeRow>(sql`
    with latest as (
      select payroll_run_id, created_by_employee_id
      from public.payroll_run
      where period_start = ${periodStart}::date and period_end = ${periodEnd}::date
      order by run_number desc, created_at desc
      limit 1
    )
    select
      l.employee_id,
      m.external_id,
      e.display_name,
      l.gross_amount as gross,
      l.net_amount as net,
      (l.housing_amount + l.transport_amount + l.other_allowance_amount) as allowances,
      (l.deductions_amount + l.loan_deduction) as deductions,
      latest.created_by_employee_id
    from latest
    join public.payroll_line l on l.payroll_run_id = latest.payroll_run_id
    join public.employee e on e.employee_id = l.employee_id
    left join public.bayzat_employee_mirror m on m.employee_id = l.employee_id
  `);
  const list = rows as unknown as NativeRow[];
  const entries: PayrollCycleEntry[] = list.map((r) => ({
    externalId: r.external_id,
    employeeId: r.employee_id,
    displayName: r.display_name ?? undefined,
    gross: r.gross,
    net: r.net,
    allowances: r.allowances,
    deductions: r.deductions,
  }));
  const payrollRunActor = list[0]?.created_by_employee_id ?? null;
  return { entries, payrollRunActor };
}

export const peopleReconRouter = router({
  /** Run reconciliation for a period. Source is a Bayzat CSV export or entries. */
  run: staffProcedure
    .use(requirePermission("payroll", "confirm"))
    .input(
      z
        .object({
          cycle,
          source: z.array(sourceEntry).optional(),
          sourceCsv: z.string().max(5_000_000).optional(),
          toleranceAed: money.optional(),
        })
        .refine((v) => v.source || v.sourceCsv, {
          message: "Provide source entries or sourceCsv",
        }),
    )
    .mutation(async ({ input }) => {
      const source: PayrollCycleEntry[] = input.sourceCsv
        ? sourceEntriesFromBayzatCsv(input.sourceCsv)
        : (input.source ?? []).map((e) => ({ ...e, externalId: e.externalId }));
      const native = await readNativeCycle(
        input.cycle.periodStart,
        input.cycle.periodEnd,
      );
      const report = reconcilePayrollCycle({
        cycle: input.cycle,
        source,
        native: native.entries,
        toleranceAed: input.toleranceAed,
        payrollRunActor: native.payrollRunActor,
      });
      reconStore.save(report);
      return report;
    }),

  /** Latest computed reconciliation report + its sign-off, if any. */
  latest: staffProcedure
    .use(requirePermission("payroll", "confirm"))
    .query(() => reconStore.latest()),

  /** Record payroll sign-off for a reconciled cycle (maker/checker separation). */
  recordSignoff: staffProcedure
    .use(requirePermission("payroll", "approve"))
    .input(
      z.object({
        periodStart: z.string().date(),
        periodEnd: z.string().date(),
        note: z.string().trim().max(2_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const actor = actorId(ctx);
      const stored = reconStore.get(input.periodStart, input.periodEnd);
      if (!stored) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Run reconciliation for this period before signing off",
        });
      }
      const decision = evaluateSignoff({
        signoffActor: actor,
        payrollRunActor: stored.report.payrollRunActor,
        verdict: stored.report.verdict,
      });
      if (!decision.allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: decision.reason });
      }
      const signoff = {
        actor,
        at: new Date().toISOString(),
        note: input.note,
      };
      reconStore.recordSignoff(input.periodStart, input.periodEnd, signoff);
      await writeAudit({
        actorEmployeeId: actor,
        action: "payroll.recon.signoff",
        entityType: "payroll_reconciliation",
        entityId: `${input.periodStart}..${input.periodEnd}`,
        before: null,
        after: {
          verdict: stored.report.verdict,
          unresolved: stored.report.unresolved,
          payrollRunActor: stored.report.payrollRunActor,
        },
        reason: input.note ?? null,
      });
      return { cycle: stored.report.cycle, signoff };
    }),

  /** Bayzat retirement readiness gate derived from stored cycles. */
  rollbackReadiness: staffProcedure
    .use(requirePermission("payroll", "confirm"))
    .query(() => evaluateRollbackGate(reconStore.readiness())),
});
