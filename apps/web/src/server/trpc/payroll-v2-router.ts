import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  and,
  auditEvent,
  desc,
  employeeExpense,
  employeeLoan,
  eq,
  payrollLine,
  payrollRun,
  payslip,
  salaryPackage,
  sql,
  type Db,
} from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import {
  UAE_GRATUITY_RULE,
  calculatePayrollLine,
  filsToMoney,
  moneyToFils,
} from "../payroll-core";
import { router, staffProcedure, type TrpcContext } from "./trpc";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type SalaryRow = {
  salary_package_id: string;
  employee_id: string;
  basic_monthly: string;
  housing_monthly: string;
  transport_monthly: string;
  other_allowance_monthly: string;
};

const ADMIN_ROLES = ["partner", "director", "finance", "hr"];
const APPROVER_ROLES = ["partner", "director"];
const money = z.string().regex(/^\d+(?:\.\d{1,2})?$/);

function database(): Db {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for payroll",
    });
  }
  return db;
}

function actorId(ctx: TrpcContext): string {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return ctx.employeeId;
}

function isAdmin(roles: readonly string[]) {
  return roles.some((role) => ADMIN_ROLES.includes(role));
}

function requireRoles(ctx: TrpcContext, roles: readonly string[]) {
  if (!ctx.roles.some((role) => roles.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return actorId(ctx);
}

function requireSelfOrAdmin(ctx: TrpcContext, target: string) {
  const actor = actorId(ctx);
  if (actor !== target && !isAdmin(ctx.roles)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return actor;
}

async function appendAudit(
  tx: Tx,
  actorEmployeeId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) {
  await tx.insert(auditEvent).values({
    actorEmployeeId,
    action,
    entityType,
    entityId,
    before,
    after,
  });
}

const lineAdjustment = z.object({
  employeeId: z.string().uuid(),
  paidDays: z.number().int().nonnegative().optional(),
  overtime: money.optional(),
  bonus: money.optional(),
  expenseReimbursement: money.optional(),
  deductions: money.optional(),
  loanDeduction: money.optional(),
});

export const payrollV2Router = router({
  salary: router({
    current: staffProcedure
      .input(z.object({ employeeId: z.string().uuid().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const employeeId = input?.employeeId ?? actorId(ctx);
        requireSelfOrAdmin(ctx, employeeId);
        const [row] = await database()
          .select()
          .from(salaryPackage)
          .where(eq(salaryPackage.employeeId, employeeId))
          .orderBy(desc(salaryPackage.effectiveFrom))
          .limit(1);
        return row ?? null;
      }),

    create: staffProcedure
      .input(
        z.object({
          employeeId: z.string().uuid(),
          effectiveFrom: z.string().date(),
          effectiveTo: z.string().date().optional(),
          basicMonthly: money,
          housingMonthly: money.default("0"),
          transportMonthly: money.default("0"),
          otherAllowanceMonthly: money.default("0"),
          bankIban: z.string().trim().max(40).optional(),
          bankRoutingCode: z.string().trim().max(40).optional(),
          mohrePersonId: z.string().trim().max(80).optional(),
          wpsAgentId: z.string().trim().max(80).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const actor = requireRoles(ctx, ADMIN_ROLES);
        if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid effective dates",
          });
        }
        return database().transaction(async (tx) => {
          const [created] = await tx
            .insert(salaryPackage)
            .values({
              employeeId: input.employeeId,
              effectiveFrom: input.effectiveFrom,
              effectiveTo: input.effectiveTo,
              basicMonthly: input.basicMonthly,
              housingMonthly: input.housingMonthly,
              transportMonthly: input.transportMonthly,
              otherAllowanceMonthly: input.otherAllowanceMonthly,
              bankIban: input.bankIban,
              bankRoutingCode: input.bankRoutingCode,
              mohrePersonId: input.mohrePersonId,
              wpsAgentId: input.wpsAgentId,
              createdByEmployeeId: actor,
            })
            .returning();
          await appendAudit(
            tx,
            actor,
            "payroll.salary.create",
            "salary_package",
            created!.salaryPackageId,
            null,
            {
              employeeId: input.employeeId,
              effectiveFrom: input.effectiveFrom,
            },
          );
          return created!;
        });
      }),
  }),

  expenses: router({
    list: staffProcedure
      .input(z.object({ employeeId: z.string().uuid().optional() }).optional())
      .query(({ input, ctx }) => {
        const employeeId = input?.employeeId ?? actorId(ctx);
        requireSelfOrAdmin(ctx, employeeId);
        return database()
          .select()
          .from(employeeExpense)
          .where(eq(employeeExpense.employeeId, employeeId))
          .orderBy(desc(employeeExpense.expenseDate));
      }),

    create: staffProcedure
      .input(
        z.object({
          expenseDate: z.string().date(),
          category: z.string().trim().min(2).max(80),
          description: z.string().trim().min(2).max(2_000),
          amount: money,
          receiptAssetId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const actor = actorId(ctx);
        return database().transaction(async (tx) => {
          const [created] = await tx
            .insert(employeeExpense)
            .values({
              employeeId: actor,
              submittedByEmployeeId: actor,
              expenseDate: input.expenseDate,
              category: input.category,
              description: input.description,
              amount: input.amount,
              receiptAssetId: input.receiptAssetId,
            })
            .returning();
          await appendAudit(
            tx,
            actor,
            "expense.submit",
            "employee_expense",
            created!.employeeExpenseId,
            null,
            {
              amount: input.amount,
              category: input.category,
            },
          );
          return created!;
        });
      }),

    decide: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          decision: z.enum(["approved", "rejected"]),
          note: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const actor = requireRoles(ctx, ADMIN_ROLES);
        return database().transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(employeeExpense)
            .where(eq(employeeExpense.employeeExpenseId, input.id))
            .limit(1);
          if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
          if (existing.employeeId === actor)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Self-approval is not allowed",
            });
          if (existing.status !== "pending")
            throw new TRPCError({ code: "CONFLICT" });
          const [updated] = await tx
            .update(employeeExpense)
            .set({
              status: input.decision,
              approvedByEmployeeId: actor,
              approvedAt: new Date(),
              decisionNote: input.note,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(employeeExpense.employeeExpenseId, input.id),
                eq(employeeExpense.status, "pending"),
              ),
            )
            .returning();
          if (!updated) throw new TRPCError({ code: "CONFLICT" });
          await appendAudit(
            tx,
            actor,
            "expense.decide",
            "employee_expense",
            input.id,
            { status: "pending" },
            { status: input.decision },
          );
          return updated;
        });
      }),
  }),

  loans: router({
    list: staffProcedure
      .input(z.object({ employeeId: z.string().uuid().optional() }).optional())
      .query(({ input, ctx }) => {
        const employeeId = input?.employeeId ?? actorId(ctx);
        requireSelfOrAdmin(ctx, employeeId);
        return database()
          .select()
          .from(employeeLoan)
          .where(eq(employeeLoan.employeeId, employeeId))
          .orderBy(desc(employeeLoan.createdAt));
      }),

    create: staffProcedure
      .input(
        z.object({
          purpose: z.string().trim().min(2).max(2_000),
          principalAmount: money,
          instalmentAmount: money,
          firstDeductionPeriod: z.string().date().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (
          moneyToFils(input.instalmentAmount) >
          moneyToFils(input.principalAmount)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Instalment exceeds principal",
          });
        }
        const actor = actorId(ctx);
        return database().transaction(async (tx) => {
          const [created] = await tx
            .insert(employeeLoan)
            .values({
              employeeId: actor,
              requestedByEmployeeId: actor,
              purpose: input.purpose,
              principalAmount: input.principalAmount,
              outstandingAmount: input.principalAmount,
              instalmentAmount: input.instalmentAmount,
              firstDeductionPeriod: input.firstDeductionPeriod,
            })
            .returning();
          await appendAudit(
            tx,
            actor,
            "loan.request",
            "employee_loan",
            created!.employeeLoanId,
            null,
            { principalAmount: input.principalAmount },
          );
          return created!;
        });
      }),

    decide: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          decision: z.enum(["approved", "rejected"]),
          note: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const actor = requireRoles(ctx, ADMIN_ROLES);
        return database().transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(employeeLoan)
            .where(eq(employeeLoan.employeeLoanId, input.id))
            .limit(1);
          if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
          if (existing.employeeId === actor)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Self-approval is not allowed",
            });
          if (existing.status !== "pending")
            throw new TRPCError({ code: "CONFLICT" });
          const [updated] = await tx
            .update(employeeLoan)
            .set({
              status: input.decision,
              approvedByEmployeeId: actor,
              approvedAt: new Date(),
              decisionNote: input.note,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(employeeLoan.employeeLoanId, input.id),
                eq(employeeLoan.status, "pending"),
              ),
            )
            .returning();
          if (!updated) throw new TRPCError({ code: "CONFLICT" });
          await appendAudit(
            tx,
            actor,
            "loan.decide",
            "employee_loan",
            input.id,
            { status: "pending" },
            { status: input.decision },
          );
          return updated;
        });
      }),
  }),

  runs: router({
    list: staffProcedure.query(({ ctx }) => {
      requireRoles(ctx, ADMIN_ROLES);
      return database()
        .select()
        .from(payrollRun)
        .orderBy(desc(payrollRun.periodStart));
    }),

    draft: staffProcedure
      .input(
        z.object({
          periodStart: z.string().date(),
          periodEnd: z.string().date(),
          idempotencyKey: z.string().trim().min(8).max(200),
          adjustments: z.array(lineAdjustment).default([]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const actor = requireRoles(ctx, ["finance", "hr"]);
        const start = new Date(`${input.periodStart}T00:00:00.000Z`);
        const end = new Date(`${input.periodEnd}T00:00:00.000Z`);
        const calendarDays =
          Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
        if (
          !Number.isInteger(calendarDays) ||
          calendarDays < 1 ||
          calendarDays > 31
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payroll period must be 1–31 days",
          });
        }
        const db = database();
        const salaries = await db.execute<SalaryRow>(sql`
          SELECT DISTINCT ON (package.employee_id)
            package.salary_package_id, package.employee_id, package.basic_monthly,
            package.housing_monthly, package.transport_monthly, package.other_allowance_monthly
          FROM public.salary_package package
          JOIN public.employee employee ON employee.employee_id = package.employee_id
          WHERE employee.is_active = true
            AND package.effective_from <= ${input.periodEnd}::date
            AND (package.effective_to IS NULL OR package.effective_to >= ${input.periodStart}::date)
          ORDER BY package.employee_id, package.effective_from DESC
        `);
        if (!salaries.length) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No active salary packages",
          });
        }
        const adjustmentByEmployee = new Map(
          input.adjustments.map((item) => [item.employeeId, item]),
        );
        const lines = salaries.map((salary) => {
          const adjustment = adjustmentByEmployee.get(salary.employee_id);
          const paidDays = adjustment?.paidDays ?? calendarDays;
          const calculated = calculatePayrollLine({
            basicMonthly: salary.basic_monthly,
            housingMonthly: salary.housing_monthly,
            transportMonthly: salary.transport_monthly,
            otherAllowanceMonthly: salary.other_allowance_monthly,
            calendarDays,
            paidDays,
            overtime: adjustment?.overtime,
            bonus: adjustment?.bonus,
            expenseReimbursement: adjustment?.expenseReimbursement,
            deductions: adjustment?.deductions,
            loanDeduction: adjustment?.loanDeduction,
          });
          return { salary, paidDays, calculated };
        });
        const sum = (field: keyof (typeof lines)[number]["calculated"]) =>
          filsToMoney(
            lines.reduce(
              (total, line) => total + moneyToFils(line.calculated[field]),
              0,
            ),
          );

        return db.transaction(async (tx) => {
          const runId = randomUUID();
          const [run] = await tx
            .insert(payrollRun)
            .values({
              payrollRunId: runId,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              idempotencyKey: input.idempotencyKey,
              calculationRuleVersion: UAE_GRATUITY_RULE,
              totalGross: sum("gross"),
              totalReimbursements: sum("expenseReimbursement"),
              totalDeductions: filsToMoney(
                moneyToFils(sum("deductions")) +
                  moneyToFils(sum("loanDeduction")),
              ),
              totalNet: sum("net"),
              createdByEmployeeId: actor,
            })
            .returning();
          await tx.insert(payrollLine).values(
            lines.map(({ salary, paidDays, calculated }) => ({
              payrollRunId: runId,
              employeeId: salary.employee_id,
              salaryPackageId: salary.salary_package_id,
              paidDays,
              calendarDays,
              basicAmount: calculated.basic,
              housingAmount: calculated.housing,
              transportAmount: calculated.transport,
              otherAllowanceAmount: calculated.otherAllowance,
              overtimeAmount: calculated.overtime,
              bonusAmount: calculated.bonus,
              expenseReimbursement: calculated.expenseReimbursement,
              deductionsAmount: calculated.deductions,
              loanDeduction: calculated.loanDeduction,
              grossAmount: calculated.gross,
              netAmount: calculated.net,
              calculationSnapshot: {
                ...calculated,
                ruleVersion: UAE_GRATUITY_RULE,
              },
            })),
          );
          await appendAudit(
            tx,
            actor,
            "payroll.run.draft",
            "payroll_run",
            runId,
            null,
            { employeeCount: lines.length, totalNet: run!.totalNet },
          );
          return { ...run!, employeeCount: lines.length };
        });
      }),

    confirm: staffProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const actor = requireRoles(ctx, ["finance", "hr"]);
        return transitionRun(
          input.id,
          "draft",
          "confirmed",
          actor,
          "confirmedByEmployeeId",
          "confirmedAt",
        );
      }),

    approve: staffProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const actor = requireRoles(ctx, APPROVER_ROLES);
        const [existing] = await database()
          .select()
          .from(payrollRun)
          .where(eq(payrollRun.payrollRunId, input.id))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.confirmedByEmployeeId === actor)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Maker/checker separation required",
          });
        return transitionRun(
          input.id,
          "confirmed",
          "approved",
          actor,
          "approvedByEmployeeId",
          "approvedAt",
        );
      }),

    markPosted: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          xeroJournalId: z.string().trim().min(2).max(200),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const actor = requireRoles(ctx, ["partner", "director", "finance"]);
        const db = database();
        return db.transaction(async (tx) => {
          const [updated] = await tx
            .update(payrollRun)
            .set({
              status: "posted",
              xeroJournalId: input.xeroJournalId,
              postedByEmployeeId: actor,
              postedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(payrollRun.payrollRunId, input.id),
                eq(payrollRun.status, "approved"),
              ),
            )
            .returning();
          if (!updated)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Run must be approved",
            });
          await appendAudit(
            tx,
            actor,
            "payroll.run.post",
            "payroll_run",
            input.id,
            { status: "approved" },
            {
              status: "posted",
              xeroJournalId: input.xeroJournalId,
              disbursed: false,
            },
          );
          return { ...updated, disbursed: false as const };
        });
      }),

    recordWpsValidation: staffProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(["generated", "validated", "rejected"]),
          summary: z.record(z.unknown()),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const actor = requireRoles(ctx, ["finance", "hr"]);
        const db = database();
        return db.transaction(async (tx) => {
          const [updated] = await tx
            .update(payrollRun)
            .set({
              wpsStatus: input.status,
              wpsPayload: input.summary,
              updatedAt: new Date(),
            })
            .where(eq(payrollRun.payrollRunId, input.id))
            .returning();
          if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
          await appendAudit(
            tx,
            actor,
            "payroll.wps.validate",
            "payroll_run",
            input.id,
            null,
            { status: input.status, providerSubmission: false },
          );
          return updated;
        });
      }),
  }),

  payslips: router({
    list: staffProcedure
      .input(z.object({ employeeId: z.string().uuid().optional() }).optional())
      .query(({ input, ctx }) => {
        const employeeId = input?.employeeId ?? actorId(ctx);
        requireSelfOrAdmin(ctx, employeeId);
        return database()
          .select()
          .from(payslip)
          .where(eq(payslip.employeeId, employeeId))
          .orderBy(desc(payslip.generatedAt));
      }),
  }),
});

async function transitionRun(
  id: string,
  from: string,
  to: string,
  actor: string,
  employeeColumn: "confirmedByEmployeeId" | "approvedByEmployeeId",
  timeColumn: "confirmedAt" | "approvedAt",
) {
  const db = database();
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(payrollRun)
      .set({
        status: to,
        [employeeColumn]: actor,
        [timeColumn]: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(payrollRun.payrollRunId, id), eq(payrollRun.status, from)))
      .returning();
    if (!updated)
      throw new TRPCError({ code: "CONFLICT", message: `Run must be ${from}` });
    await appendAudit(
      tx,
      actor,
      `payroll.run.${to}`,
      "payroll_run",
      id,
      { status: from },
      { status: to },
    );
    return updated;
  });
}
