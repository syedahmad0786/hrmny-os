import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { InvoiceProposeSchema, type InvoiceProposePayload } from "@hrmny/ai";
import {
  bootstrapGateRegistry,
  transition,
  type ActorContext,
  type EntitySnapshot,
} from "@hrmny/gate";
import { DEMO_EMPLOYEE_ID, getDemoStore, vatOnAmount } from "../demo-store";
import { protectedProcedure, router } from "./trpc";

bootstrapGateRegistry();

const HR_ADMIN_ROLES = ["partner", "director", "hr"] as const;
const PAYROLL_VIEW_ROLES = ["partner", "director", "finance", "hr"] as const;

function requireAnyRole(
  roles: string[],
  allowed: readonly string[],
  operation: string,
) {
  if (!roles.some((role) => allowed.includes(role))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Not authorized to ${operation}`,
    });
  }
}

function actorFromCtx(ctx: {
  employeeId: string | null;
  roles: string[];
  user: { permissions: string[] } | null;
}): ActorContext {
  return {
    employeeId: ctx.employeeId!,
    roles: ctx.roles,
    permissions: ctx.user?.permissions ?? [],
  };
}

async function runTransition(
  entityType: string,
  entityId: string,
  state: string,
  data: Record<string, unknown>,
  input: { to: string; from?: string; payload?: Record<string, unknown> },
  ctx: {
    employeeId: string | null;
    roles: string[];
    user: { permissions: string[] } | null;
  },
  apply: (to: string, payload?: Record<string, unknown>) => void,
) {
  const store = getDemoStore();
  const entity: EntitySnapshot = { entityType, entityId, state, data };
  return transition(actorFromCtx(ctx), entity, input, {
    authorize: async (a) =>
      a.roles.some((r) =>
        ["partner", "finance", "hr", "director", "am"].includes(r),
      ),
    apply: async ({ request }) => {
      apply(request.to, request.payload);
      return {
        ...entity,
        state: request.to,
        data: { ...data, ...request.payload },
      };
    },
    audit: async (event) => {
      const row = store.appendAudit({
        actorEmployeeId: event.actorEmployeeId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        before: event.before,
        after: event.after,
        reason: event.reason ?? null,
      });
      return { auditId: row.auditEventId };
    },
    emit: async (event) => {
      store.pushHealth(`${entityType}_transition`, "info", event.payload);
    },
  });
}

export const invoicesRouter = router({
  list: protectedProcedure.query(() => [...getDemoStore().invoices.values()]),

  proposals: protectedProcedure.query(() => [
    ...getDemoStore().proposals.values(),
  ]),

  intake: protectedProcedure
    .input(
      z.object({
        emailRef: z.string().min(1),
        bodyHint: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const store = getDemoStore();
      const result = await store.llm.generate({
        task: "invoice_extract",
        schema: InvoiceProposeSchema,
        messages: [
          {
            role: "user",
            content: `emailRef: ${input.emailRef}\n${input.bodyHint ?? "Invoice AED 2100.00"}`,
          },
        ],
      });
      const payload = InvoiceProposeSchema.parse(
        result.object ?? JSON.parse(result.text),
      ) as InvoiceProposePayload;

      const proposalId = randomUUID();
      const proposal = {
        proposalId,
        emailRef: input.emailRef,
        status: "pending" as const,
        payload: { ...payload },
        invoiceId: null,
        createdAt: new Date().toISOString(),
      };
      store.proposals.set(proposalId, proposal);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "invoices.intake",
        entityType: "invoice_intake_proposal",
        entityId: proposalId,
        before: null,
        after: { ...proposal },
        reason: payload.ruleCited,
      });
      return proposal;
    }),

  intakeDecide: protectedProcedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        decision: z.enum(["approve", "reject", "edit_approve"]),
        edits: z
          .object({
            contactName: z.string().optional(),
            amount: z.string().optional(),
            vatAmount: z.string().optional(),
            trn: z.string().nullable().optional(),
          })
          .optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const proposal = store.proposals.get(input.proposalId);
      if (!proposal) throw new Error("NOT_FOUND");
      if (input.decision === "reject") {
        proposal.status = "rejected";
        return { proposal, invoice: null };
      }

      const base = proposal.payload as InvoiceProposePayload;
      const merged = {
        ...base,
        ...input.edits,
        trn: input.edits?.trn !== undefined ? input.edits.trn : base.trn,
        trnStatus:
          input.edits?.trn === null ||
          (input.edits?.trn === undefined && base.trnStatus === "unknown_held")
            ? ("unknown_held" as const)
            : ("known" as const),
      };
      if (merged.trn) merged.trnStatus = "known";

      const invoiceId = randomUUID();
      const invoice = {
        invoiceId,
        status: "proposed",
        contactName: merged.contactName,
        amount: merged.amount,
        vatAmount: merged.vatAmount,
        currency: merged.currency,
        invoiceType: merged.invoiceType,
        billingKind: "intake" as const,
        clientId: null,
        period: null,
        trn: merged.trn,
        trnStatus: merged.trnStatus,
        ruleCited: merged.ruleCited,
        sourceAttached: {
          emailRef: proposal.emailRef,
          evidence: merged.evidence,
        },
        xeroInvoiceId: null,
        proposedByEmployeeId: ctx.employeeId,
        approvedByEmployeeId: null,
        createdAt: new Date().toISOString(),
      };
      store.invoices.set(invoiceId, invoice);
      proposal.status =
        input.decision === "edit_approve" ? "edited" : "approved";
      proposal.invoiceId = invoiceId;
      proposal.payload = { ...merged };
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "invoices.intakeDecide",
        entityType: "invoice",
        entityId: invoiceId,
        before: { proposal: input.proposalId },
        after: { ...invoice },
        reason: merged.ruleCited,
      });
      return { proposal, invoice };
    }),

  /** M5: retainer / progress / first invoice draft (VAT 5%). */
  draft: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        type: z.enum(["retainer", "progress", "first"]),
        period: z.string().regex(/^\d{4}-\d{2}$/),
        amount: z.string().optional(),
        contactName: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const client = store.clients.get(input.clientId);
      if (!client) throw new Error("NOT_FOUND");
      const amountNum = Number(
        input.amount ?? client.fee ?? client.contractValue,
      );
      const invoiceId = randomUUID();
      const invoice = {
        invoiceId,
        status: "draft",
        contactName: input.contactName ?? client.name,
        amount: amountNum.toFixed(2),
        vatAmount: vatOnAmount(amountNum),
        currency: client.currency || "AED",
        invoiceType: input.type,
        billingKind: input.type,
        clientId: client.clientId,
        period: input.period,
        trn: "100000000000003",
        trnStatus: "known" as const,
        ruleCited: "UAE VAT 5% on retainer/progress draft",
        sourceAttached: {
          kind: "retainer_billing",
          clientId: client.clientId,
          period: input.period,
        },
        xeroInvoiceId: null as string | null,
        proposedByEmployeeId: ctx.employeeId,
        approvedByEmployeeId: null as string | null,
        createdAt: new Date().toISOString(),
      };
      store.invoices.set(invoiceId, invoice);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "invoices.draft",
        entityType: "invoice",
        entityId: invoiceId,
        before: null,
        after: { ...invoice },
        reason: `M5 ${input.type} draft for ${input.period}`,
      });
      return invoice;
    }),

  /** Month-start retainer auto-draft for all active retainer clients. */
  draftRetainersForMonth: protectedProcedure
    .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }))
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const created = [];
      for (const client of store.clients.values()) {
        if (client.engagementType !== "retainer") continue;
        if (client.lifecycleStatus === "churned") continue;
        const exists = [...store.invoices.values()].some(
          (inv) =>
            inv.clientId === client.clientId &&
            inv.period === input.period &&
            inv.billingKind === "retainer" &&
            inv.status !== "void",
        );
        if (exists) continue;
        const amountNum = Number(client.fee || client.contractValue);
        const invoiceId = randomUUID();
        const invoice = {
          invoiceId,
          status: "draft",
          contactName: client.name,
          amount: amountNum.toFixed(2),
          vatAmount: vatOnAmount(amountNum),
          currency: client.currency || "AED",
          invoiceType: "retainer",
          billingKind: "retainer" as const,
          clientId: client.clientId,
          period: input.period,
          trn: "100000000000003",
          trnStatus: "known" as const,
          ruleCited: "UAE VAT 5% monthly retainer auto-draft",
          sourceAttached: {
            kind: "retainer_month_start",
            clientId: client.clientId,
            period: input.period,
          },
          xeroInvoiceId: null as string | null,
          proposedByEmployeeId: ctx.employeeId,
          approvedByEmployeeId: null as string | null,
          createdAt: new Date().toISOString(),
        };
        store.invoices.set(invoiceId, invoice);
        created.push(invoice);
      }
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "invoices.draftRetainersForMonth",
        entityType: "invoice",
        entityId: input.period,
        before: null,
        after: { count: created.length, period: input.period },
        reason: "billing/retainer-month-start",
      });
      return { period: input.period, created };
    }),

  /** Xero paid-status webhook read-back stub. */
  markPaidFromWebhook: protectedProcedure
    .input(
      z.object({
        xeroInvoiceId: z.string().min(1),
        event: z.enum(["invoice.paid"]).optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const store = getDemoStore();
      const inv = [...store.invoices.values()].find(
        (i) => i.xeroInvoiceId === input.xeroInvoiceId,
      );
      if (!inv) throw new Error("NOT_FOUND");
      if (inv.status !== "issued" && inv.status !== "paid") {
        throw new Error("INVALID_STATE");
      }
      const before = inv.status;
      inv.status = "paid";
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "invoices.markPaidFromWebhook",
        entityType: "invoice",
        entityId: inv.invoiceId,
        before: { status: before },
        after: { status: "paid", xeroInvoiceId: inv.xeroInvoiceId },
        reason: input.event ?? "invoice.paid",
      });
      return inv;
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const store = getDemoStore();
      const inv = store.invoices.get(input.id);
      if (!inv) throw new Error("NOT_FOUND");
      const result = await runTransition(
        "invoice",
        inv.invoiceId,
        inv.status,
        { ...inv },
        { to: "approved", from: inv.status },
        ctx,
        (to) => {
          inv.status = to;
          inv.approvedByEmployeeId = ctx.employeeId;
        },
      );
      return { result, invoice: inv };
    }),

  issue: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const store = getDemoStore();
      const inv = store.invoices.get(input.id);
      if (!inv) throw new Error("NOT_FOUND");

      const result = await runTransition(
        "invoice",
        inv.invoiceId,
        inv.status,
        { ...inv },
        { to: "issued", from: inv.status },
        ctx,
        () => {
          /* applied after Xero post */
        },
      );
      if (!result.ok) return { result, invoice: inv };

      const posted = await store.xero.createInvoice({
        invoiceId: inv.invoiceId,
        contactName: inv.contactName,
        amount: inv.amount,
        vatAmount: inv.vatAmount,
        currency: inv.currency,
        sourceAttached: inv.sourceAttached ?? undefined,
        trn: inv.trn,
      });
      inv.status = "issued";
      inv.xeroInvoiceId = posted.xeroInvoiceId;
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "invoices.issue.xero_post",
        entityType: "invoice",
        entityId: inv.invoiceId,
        before: { status: "approved" },
        after: { status: "issued", xeroInvoiceId: posted.xeroInvoiceId },
        reason: "Posted to Xero with source attached (never disburse)",
      });
      return { result, invoice: inv };
    }),

  transition: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        to: z.string(),
        from: z.string().optional(),
        payload: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const store = getDemoStore();
      const inv = store.invoices.get(input.id);
      if (!inv) throw new Error("NOT_FOUND");
      return runTransition(
        "invoice",
        inv.invoiceId,
        inv.status,
        { ...inv },
        input,
        ctx,
        (to) => {
          inv.status = to;
        },
      );
    }),

  resetDemo: protectedProcedure.mutation(() => {
    getDemoStore().resetM2Demo();
    return { ok: true as const };
  }),
});

export const employeesRouter = router({
  list: protectedProcedure.query(() => [...getDemoStore().employees.values()]),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input, ctx }) => {
      if (input.id !== ctx.employeeId) {
        requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "view another employee");
      }
      const store = getDemoStore();
      const emp = store.employees.get(input.id);
      if (!emp) return null;
      const mirror = store.bayzatMirror.find(
        (m) => m.externalId === emp.bayzatExternalId,
      );
      return { ...emp, bayzatMirror: mirror ?? null };
    }),

  /** Accept offer → spawn 9-phase lifecycle bundle at hire_packet. */
  acceptOffer: protectedProcedure
    .input(z.object({ id: z.string().uuid().default(DEMO_EMPLOYEE_ID) }))
    .mutation(async ({ input, ctx }) => {
      requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "accept employee offers");
      const store = getDemoStore();
      const emp = store.employees.get(input.id);
      if (!emp) throw new Error("NOT_FOUND");
      emp.checklist = { ...emp.checklist, offer_accepted: true };
      const result = await runTransition(
        "employee",
        emp.employeeId,
        emp.lifecycleStatus,
        { checklist: emp.checklist },
        { to: "hire_packet", from: emp.lifecycleStatus },
        ctx,
        (to) => {
          emp.lifecycleStatus = to;
          emp.spawnedBundle = true;
          // Probation deadline stub: 14 days from hire for demo escalation
          const due = new Date();
          due.setDate(due.getDate() - 1); // already overdue for demo
          emp.probationDueAt = due.toISOString();
        },
      );
      return { result, employee: emp };
    }),

  lifecycle: router({
    transition: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          to: z.string(),
          from: z.string().optional(),
          payload: z
            .object({
              checklist: z.record(z.boolean()).optional(),
            })
            .passthrough()
            .optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "change employee lifecycle");
        const store = getDemoStore();
        const emp = store.employees.get(input.id);
        if (!emp) throw new Error("NOT_FOUND");
        if (input.payload?.checklist) {
          emp.checklist = { ...emp.checklist, ...input.payload.checklist };
        }
        return runTransition(
          "employee",
          emp.employeeId,
          emp.lifecycleStatus,
          { checklist: emp.checklist },
          {
            to: input.to,
            from: input.from,
            payload: { checklist: emp.checklist },
          },
          ctx,
          (to) => {
            emp.lifecycleStatus = to;
          },
        );
      }),
  }),

  /** Job stub: escalate overdue probation / lifecycle misses. */
  runEscalationJob: protectedProcedure.mutation(({ ctx }) => {
    requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "run HR escalations");
    const store = getDemoStore();
    const now = Date.now();
    const fired: unknown[] = [];
    for (const emp of store.employees.values()) {
      if (
        emp.lifecycleStatus === "probation" ||
        (emp.lifecycleStatus === "hire_packet" && emp.probationDueAt)
      ) {
        const due = emp.probationDueAt ? Date.parse(emp.probationDueAt) : null;
        if (due !== null && due < now && !emp.escalatedAt) {
          emp.escalatedAt = new Date().toISOString();
          const esc = store.pushEscalation(
            emp.employeeId,
            "probation_deadline_missed",
            `Auto-escalate: ${emp.displayName} missed probation/lifecycle deadline`,
          );
          store.appendAudit({
            actorEmployeeId: ctx.employeeId!,
            action: "employees.escalation",
            entityType: "employee",
            entityId: emp.employeeId,
            before: null,
            after: { ...esc },
            reason: "Missed probation deadline — auto-escalation (job stub)",
          });
          fired.push(esc);
        }
      }
    }
    return { fired, count: fired.length };
  }),

  escalations: protectedProcedure.query(({ ctx }) => {
    requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "view HR escalations");
    return getDemoStore().escalations;
  }),

  importBayzatCsv: protectedProcedure
    .input(z.object({ csvText: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "import employee records");
      const store = getDemoStore();
      const rows = await store.bayzat.importCsv(input.csvText);
      store.bayzatMirror = await store.bayzat.listEmployees();
      // Link demo employee if email matches
      for (const emp of store.employees.values()) {
        const match = store.bayzatMirror.find((m) => m.email === emp.email);
        if (match) emp.bayzatExternalId = match.externalId;
      }
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "bayzat.importCsv",
        entityType: "bayzat_employee_mirror",
        entityId: "00000000-0000-4000-8000-000000000000",
        before: null,
        after: { count: rows.length, source: store.bayzat.source },
        reason: "Read-only mirror — OS never writes Bayzat master",
      });
      return { imported: rows.length, mirror: store.bayzatMirror };
    }),

  bayzatMirror: protectedProcedure.query(({ ctx }) => {
    requireAnyRole(ctx.roles, PAYROLL_VIEW_ROLES, "view payroll source data");
    return getDemoStore().bayzatMirror;
  }),

  performanceReview: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(["confirm", "pip", "exit"]),
        notes: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "record performance reviews");
      const store = getDemoStore();
      const emp = store.employees.get(input.id);
      if (!emp) throw new Error("NOT_FOUND");
      emp.checklist = {
        ...emp.checklist,
        probation_decision: true,
        form4_decision: true,
      };
      const review = {
        employeeId: emp.employeeId,
        decision: input.decision,
        notes: input.notes ?? null,
        at: new Date().toISOString(),
      };
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "employees.performanceReview",
        entityType: "performance_review",
        entityId: emp.employeeId,
        before: null,
        after: review,
        reason: null,
      });
      return review;
    }),
});

export const requisitionsRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "view requisitions");
    return [...getDemoStore().requisitions.values()];
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        department: z.string().min(1),
      }),
    )
    .mutation(({ input, ctx }) => {
      requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "create requisitions");
      const store = getDemoStore();
      const requisitionId = randomUUID();
      const row = {
        requisitionId,
        title: input.title,
        department: input.department,
        status: "pending" as const,
        requesterEmployeeId: ctx.employeeId!,
        approverEmployeeId: null,
        createdAt: new Date().toISOString(),
      };
      store.requisitions.set(requisitionId, row);
      return row;
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) => {
      requireAnyRole(
        ctx.roles,
        ["partner", "director"],
        "approve requisitions",
      );
      const store = getDemoStore();
      const row = store.requisitions.get(input.id);
      if (!row) throw new Error("NOT_FOUND");
      if (row.requesterEmployeeId === ctx.employeeId) {
        throw new Error("SoD: requester cannot approve own requisition");
      }
      row.status = "approved";
      row.approverEmployeeId = ctx.employeeId;
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "requisitions.approve",
        entityType: "requisition",
        entityId: row.requisitionId,
        before: { status: "pending" },
        after: { ...row },
        reason: null,
      });
      return row;
    }),
});

/** Payroll Module E — draft from Bayzat → HR confirm → Director approve → JE (never disburse). */
export const payrollRouter = router({
  runs: router({
    list: protectedProcedure.query(({ ctx }) => {
      requireAnyRole(ctx.roles, PAYROLL_VIEW_ROLES, "view payroll runs");
      return [...getDemoStore().payrollRuns.values()];
    }),

    draft: protectedProcedure
      .input(z.object({ period: z.string().min(1) }))
      .mutation(({ input, ctx }) => {
        requireAnyRole(ctx.roles, ["finance", "hr"], "draft payroll");
        const store = getDemoStore();
        const { lines, totalGross } = store.buildPayrollLinesFromMirror();
        const payrollRunId = randomUUID();
        const run = {
          payrollRunId,
          period: input.period,
          status: "draft",
          confirmedByEmployeeId: null as string | null,
          approvedByEmployeeId: null as string | null,
          xeroJournalId: null as string | null,
          lines,
          totalGross,
          adjustments: null as Record<string, unknown> | null,
          source: "bayzat_mirror" as const,
          disbursed: false as const,
          createdAt: new Date().toISOString(),
        };
        store.payrollRuns.set(payrollRunId, run);
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "payroll.runs.draft",
          entityType: "payroll_run",
          entityId: payrollRunId,
          before: null,
          after: {
            ...run,
            fromBayzatMirror: store.bayzatMirror.length,
            neverDisburse: true,
          },
          reason: "Draft from Bayzat mirror — JE post only, never disburse",
        });
        return run;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(({ input, ctx }) => {
        requireAnyRole(ctx.roles, PAYROLL_VIEW_ROLES, "view payroll runs");
        return getDemoStore().payrollRuns.get(input.id) ?? null;
      }),

    confirm: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          adjustments: z.record(z.unknown()).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAnyRole(ctx.roles, ["finance", "hr"], "confirm payroll");
        const store = getDemoStore();
        const run = store.payrollRuns.get(input.id);
        if (!run) throw new Error("NOT_FOUND");
        const result = await runTransition(
          "payroll_run",
          run.payrollRunId,
          run.status,
          { confirmedByEmployeeId: run.confirmedByEmployeeId },
          { to: "hr_confirmed", payload: input.adjustments },
          ctx,
          (to) => {
            run.status = to;
            run.confirmedByEmployeeId = ctx.employeeId;
            if (input.adjustments) run.adjustments = input.adjustments;
          },
        );
        return { result, run };
      }),

    approve: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        requireAnyRole(ctx.roles, ["partner", "director"], "approve payroll");
        const store = getDemoStore();
        const run = store.payrollRuns.get(input.id);
        if (!run) throw new Error("NOT_FOUND");
        const result = await runTransition(
          "payroll_run",
          run.payrollRunId,
          run.status,
          { confirmedByEmployeeId: run.confirmedByEmployeeId },
          { to: "director_approved" },
          ctx,
          (to) => {
            run.status = to;
            run.approvedByEmployeeId = ctx.employeeId;
          },
        );
        return { result, run };
      }),

    /** JE post stub only — never disburse (disburse=true blocked by gate). */
    post: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          disburse: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAnyRole(
          ctx.roles,
          ["partner", "director", "finance"],
          "post payroll journals",
        );
        const store = getDemoStore();
        const run = store.payrollRuns.get(input.id);
        if (!run) throw new Error("NOT_FOUND");
        const result = await runTransition(
          "payroll_run",
          run.payrollRunId,
          run.status,
          { confirmedByEmployeeId: run.confirmedByEmployeeId },
          { to: "posted", payload: { disburse: input.disburse === true } },
          ctx,
          () => undefined,
        );
        if (!result.ok) return { result, run };
        const je = await store.xero.createJournal({
          payrollRunId: run.payrollRunId,
          period: run.period,
          totalGross: run.totalGross,
          neverDisburse: true,
        });
        run.status = "posted";
        run.xeroJournalId = je.xeroJournalId;
        // disbursed stays false — OS never pays bank
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: "payroll.runs.post.xero_je",
          entityType: "payroll_run",
          entityId: run.payrollRunId,
          before: { status: "director_approved" },
          after: {
            status: "posted",
            xeroJournalId: je.xeroJournalId,
            disbursed: false,
          },
          reason: "Xero JE only — never disburse",
        });
        return { result, run };
      }),
  }),
});

export const dashboardsHrRouter = router({
  hrLifecycle: protectedProcedure.query(({ ctx }) => {
    requireAnyRole(ctx.roles, HR_ADMIN_ROLES, "view HR dashboards");
    const store = getDemoStore();
    const byPhase: Record<string, number> = {};
    for (const emp of store.employees.values()) {
      byPhase[emp.lifecycleStatus] = (byPhase[emp.lifecycleStatus] ?? 0) + 1;
    }
    const risk = [...store.employees.values()].filter(
      (e) => e.escalatedAt,
    ).length;
    return {
      byPhase,
      overdue: store.escalations.length,
      risk,
    };
  }),
});
