import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CRM_MARKETS } from "@/lib/crm-markets";
import {
  bootstrapGateRegistry,
  computeQuoteMetrics,
  discountAuthorityTier,
  transition,
  MARGIN_FLOOR_PCT,
  MARGIN_TARGET_PCT,
  type ActorContext,
} from "@hrmny/gate";
import { toCsv } from "../crm/csv";
import { runDemoClosedLoopCore } from "../crm/closed-loop";
import { closeDurableDeal, durableHandoverPack } from "../crm/handover";
import {
  createActivity,
  createCompany,
  createContact,
  createCrmTask,
  createDeal,
  createNote,
  createQuoteVersion,
  crmBackendMode,
  crmHealth,
  dedupeCandidates,
  getCompany,
  getContact,
  getDeal,
  getQuote,
  listActivities,
  listCompanies,
  listContacts,
  listCrmTasks,
  listDeals,
  listNotes,
  listQuotesByDeal,
  mergeCompanies,
  mergeContacts,
  moveDealStage,
  normalizeDomain,
  omniSearch,
  pipelineStages,
  updateCompany,
  updateContact,
  updateCrmTask,
  updateDeal,
  updateQuoteStatus,
} from "../crm/repository";
import { redactDealMargin, redactQuoteMargin } from "../crm/types";
import { emitHealthSignal, writeAudit } from "../m1-persistence";
import {
  legacySalesEffectRefusal,
  legacySalesSyntheticRuntimeEnabled,
} from "../sales-os/legacy-effect-policy";
import { listOutreach } from "../leadgen/store";
import { getSalesOsSettings } from "../sales-os/store";
import {
  protectedProcedure,
  publicProcedure,
  router,
  staffProcedure,
} from "./trpc";

bootstrapGateRegistry();

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

/** Same audit idiom as crm.deals.moveStage, for plain CRUD mutations. */
async function auditMutation(
  ctx: { employeeId: string | null },
  action: string,
  entityType: string,
  entityId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  await writeAudit({
    actorEmployeeId: ctx.employeeId,
    action,
    entityType,
    entityId,
    before,
    after,
    reason: null,
  });
}

const marketSchema = z.enum(CRM_MARKETS);
const leadLaneSchema = z.enum([
  "industry_scanning",
  "apollo_intent",
  "relationship_led",
  "tejari",
  "inbound",
]);
const crmTaskStatusSchema = z.enum([
  "open",
  "in_progress",
  "done",
  "cancelled",
]);
const activityTypeSchema = z.enum([
  "note",
  "call",
  "meeting",
  "email",
  "stage_change",
  "task",
  "outreach",
  "system",
]);

export const crmCompaniesRouter = router({
  list: protectedProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(({ input }) => listCompanies(input)),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getCompany(input.id)),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        sector: z.string().nullable().optional(),
        market: marketSchema.optional(),
        website: z.string().nullable().optional(),
        linkedinUrl: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await createCompany(input);
      await auditMutation(
        ctx,
        "crm.companies.create",
        "company",
        row.companyId,
        null,
        {
          ...row,
        },
      );
      return row;
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        sector: z.string().nullable().optional(),
        market: marketSchema.nullable().optional(),
        website: z.string().nullable().optional(),
        linkedinUrl: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const before = await getCompany(id);
      const row = await updateCompany(id, patch);
      if (row) {
        await auditMutation(
          ctx,
          "crm.companies.update",
          "company",
          id,
          before ? { ...before } : null,
          { ...row },
        );
      }
      return row;
    }),
});

export const crmContactsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          companyId: z.string().uuid().optional(),
          search: z.string().optional(),
        })
        .optional(),
    )
    .query(({ input }) => listContacts(input)),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getContact(input.id)),
  create: protectedProcedure
    .input(
      z.object({
        companyId: z.string().uuid().nullable().optional(),
        firstName: z.string().min(1),
        lastName: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        linkedinUrl: z.string().nullable().optional(),
        isPrimary: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await createContact(input);
      await auditMutation(
        ctx,
        "crm.contacts.create",
        "contact",
        row.contactId,
        null,
        {
          ...row,
        },
      );
      return row;
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        companyId: z.string().uuid().nullable().optional(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        linkedinUrl: z.string().nullable().optional(),
        isPrimary: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const before = await getContact(id);
      const row = await updateContact(id, patch);
      if (row) {
        await auditMutation(
          ctx,
          "crm.contacts.update",
          "contact",
          id,
          before ? { ...before } : null,
          { ...row },
        );
      }
      return row;
    }),
});

export const crmDealsRouter = router({
  stages: publicProcedure.query(() => pipelineStages()),
  list: protectedProcedure
    .input(
      z
        .object({
          stage: z.string().optional(),
          companyId: z.string().uuid().optional(),
          lane: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const rows = await listDeals(input);
      return rows.map((d) => redactDealMargin(d, ctx.canViewMargin));
    }),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const row = await getDeal(input.id);
      if (!row) return null;
      return redactDealMargin(row, ctx.canViewMargin);
    }),
  create: protectedProcedure
    .input(
      z.object({
        companyName: z.string().min(1),
        companyId: z.string().uuid().nullable().optional(),
        primaryContactId: z.string().uuid().nullable().optional(),
        sector: z.string().nullable().optional(),
        leadSourceLane: leadLaneSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await createDeal({
        ...input,
        ownerEmployeeId: ctx.employeeId,
      });
      await createActivity({
        type: "system",
        subject: "Deal created",
        dealId: row.dealId,
        companyId: row.companyId,
        actorEmployeeId: ctx.employeeId,
      });
      await auditMutation(ctx, "crm.deals.create", "deal", row.dealId, null, {
        ...row,
      });
      return redactDealMargin(row, ctx.canViewMargin);
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        companyName: z.string().min(1).optional(),
        companyId: z.string().uuid().nullable().optional(),
        primaryContactId: z.string().uuid().nullable().optional(),
        sector: z.string().nullable().optional(),
        ownerEmployeeId: z.string().uuid().nullable().optional(),
        opportunityName: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .nullable()
          .optional(),
        expectedCloseDate: z.string().date().nullable().optional(),
        buafBudget: z.boolean().nullable().optional(),
        buafUrgency: z.boolean().nullable().optional(),
        buafAccess: z.boolean().nullable().optional(),
        buafFit: z.boolean().nullable().optional(),
        buafTemperature: z
          .enum(["hot", "warm", "cool", "cold"])
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const before = await getDeal(id);
      const row = await updateDeal(id, patch);
      if (!row) return null;
      await auditMutation(
        ctx,
        "crm.deals.update",
        "deal",
        id,
        before ? { ...before } : null,
        { ...row },
      );
      return redactDealMargin(row, ctx.canViewMargin);
    }),
  moveStage: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        to: z.string().min(1),
        overrideReason: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getDeal(input.id);
      if (!existing) return { ok: false as const, reason: "Deal not found" };

      const contact = existing.primaryContactId
        ? await getContact(existing.primaryContactId)
        : null;
      const { outreachVoiceViolations } =
        await import("../sales-os/compliance");
      const voiceCheckPassed = (await listOutreach({ dealId: existing.dealId }))
        .filter((item) => item.state === "approved" || item.state === "sent")
        .some(
          (item) =>
            outreachVoiceViolations(item.body, existing.companyName).length ===
            0,
        );
      const needsNote = [...(await listNotes({ dealId: existing.dealId }))]
        .filter((note) => note.body.startsWith("SALES NEEDS —"))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      let needsComplete = false;
      if (needsNote) {
        try {
          const value = JSON.parse(
            needsNote.body.slice("SALES NEEDS —".length).trim(),
          ) as Record<string, unknown>;
          needsComplete = [
            "objective",
            "deliverables",
            "timing",
            "decisionMaker",
          ].every(
            (key) =>
              typeof value[key] === "string" &&
              (value[key] as string).trim().length > 0,
          );
        } catch {
          needsComplete = false;
        }
      }
      const gateData = {
        ...existing,
        emailVerified: Boolean(contact?.emailVerified),
        voiceCheckPassed,
        needsComplete,
      };

      const gateResult = await transition(
        actorFromCtx(ctx),
        {
          entityType: "deal",
          entityId: existing.dealId,
          state: existing.stage,
          data: gateData,
        },
        {
          to: input.to,
          from: existing.stage,
          overrideReason: input.overrideReason,
        },
        {
          authorize: async (a) =>
            a.roles.some((r) =>
              ["partner", "am", "finance", "director"].includes(r),
            ),
          apply: async ({ request }) => {
            const moved = await moveDealStage({
              dealId: existing.dealId,
              to: request.to,
              actorEmployeeId: ctx.employeeId,
            });
            if (!moved.ok) {
              throw new Error(moved.reason);
            }
            return {
              entityType: "deal",
              entityId: moved.deal.dealId,
              state: moved.deal.stage,
              data: {
                ...moved.deal,
                emailVerified: Boolean(contact?.emailVerified),
                voiceCheckPassed,
              },
            };
          },
          audit: async (event) => {
            const row = await writeAudit({
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
            await emitHealthSignal(
              event.name.endsWith("transition_blocked")
                ? "gate_blocked"
                : "crm_deal_transition",
              event.name.endsWith("transition_blocked") ? "warn" : "info",
              event.payload,
            );
          },
        },
      );

      if (!gateResult.ok) {
        return {
          ok: false as const,
          reason: gateResult.code,
          code: gateResult.code,
          blockedBy: gateResult.blockedBy,
          auditId: gateResult.auditId,
        };
      }

      const deal = await getDeal(input.id);
      if (!deal)
        return { ok: false as const, reason: "Deal missing after apply" };
      return {
        ok: true as const,
        deal: redactDealMargin(deal, ctx.canViewMargin),
        auditId: gateResult.auditId,
      };
    }),

  /** Mark deal won/lost/on-hold (sets closeOutcome; required before handover). */
  close: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        outcome: z.enum(["won", "lost", "postponed_on_hold"]),
        lostReason: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const isSalesOperator = ctx.roles.some((role) =>
        ["partner", "director", "am", "account_manager"].includes(role),
      );
      const isSalesLeader = ctx.roles.some((role) =>
        ["partner", "director"].includes(role),
      );
      if (!isSalesOperator || (input.outcome === "won" && !isSalesLeader)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            input.outcome === "won"
              ? "Partner or Director must confirm a won deal"
              : "Sales operator role required",
        });
      }
      const before = await getDeal(input.id);
      const result = await closeDurableDeal({
        dealId: input.id,
        outcome: input.outcome,
        lostReason: input.lostReason,
        actorEmployeeId: ctx.employeeId,
      });
      if (!result.ok) {
        return {
          ok: false as const,
          reason: result.reason,
          code: result.code ?? "GATE_BLOCKED",
        };
      }
      await auditMutation(
        ctx,
        "crm.deals.close",
        "deal",
        input.id,
        before ? { ...before } : null,
        { stage: result.deal.stage, closeOutcome: result.deal.closeOutcome },
      );
      return {
        ok: true as const,
        deal: redactDealMargin(result.deal, ctx.canViewMargin),
      };
    }),

  /** Won deal → client + onboarding + creative QC task + client memory. */
  handoverPack: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.roles.some((role) => ["partner", "director"].includes(role))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Partner or Director must confirm the client handover",
        });
      }
      const result = await durableHandoverPack({
        dealId: input.id,
        actorEmployeeId: ctx.employeeId,
      });
      if (!result.ok) {
        return {
          ok: false as const,
          reason: result.reason,
          code: result.code ?? "GATE_BLOCKED",
        };
      }
      await auditMutation(
        ctx,
        "crm.deals.handoverPack",
        "deal",
        input.id,
        null,
        result.pack,
      );
      await emitHealthSignal("deal.won", "info", {
        dealId: input.id,
        clientId: result.client.clientId,
        fired: result.pack.fired,
      });
      return result;
    }),
});

export const crmActivitiesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid().optional(),
          companyId: z.string().uuid().optional(),
          contactId: z.string().uuid().optional(),
          limit: z.number().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ input }) => listActivities(input)),
  create: protectedProcedure
    .input(
      z.object({
        type: activityTypeSchema,
        subject: z.string().nullable().optional(),
        body: z.string().nullable().optional(),
        companyId: z.string().uuid().nullable().optional(),
        contactId: z.string().uuid().nullable().optional(),
        dealId: z.string().uuid().nullable().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await createActivity({
        ...input,
        actorEmployeeId: ctx.employeeId,
      });
      await auditMutation(
        ctx,
        "crm.activities.create",
        "activity",
        row.activityId,
        null,
        { ...row },
      );
      return row;
    }),
});

export const crmNotesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid().optional(),
          companyId: z.string().uuid().optional(),
          contactId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(({ input }) => listNotes(input)),
  create: protectedProcedure
    .input(
      z.object({
        body: z.string().min(1),
        companyId: z.string().uuid().nullable().optional(),
        contactId: z.string().uuid().nullable().optional(),
        dealId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await createNote({
        ...input,
        authorEmployeeId: ctx.employeeId,
      });
      await auditMutation(
        ctx,
        "crm.notes.create",
        "crm_note",
        row.crmNoteId,
        null,
        {
          ...row,
        },
      );
      return row;
    }),
});

export const crmTasksRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid().optional(),
          companyId: z.string().uuid().optional(),
          status: crmTaskStatusSchema.optional(),
          ownerEmployeeId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(({ input }) => listCrmTasks(input)),
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        dueDate: z.string().nullable().optional(),
        companyId: z.string().uuid().nullable().optional(),
        contactId: z.string().uuid().nullable().optional(),
        dealId: z.string().uuid().nullable().optional(),
        ownerEmployeeId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await createCrmTask({
        ...input,
        ownerEmployeeId: input.ownerEmployeeId ?? ctx.employeeId,
      });
      await auditMutation(
        ctx,
        "crm.tasks.create",
        "crm_task",
        row.crmTaskId,
        null,
        {
          ...row,
        },
      );
      return row;
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        status: crmTaskStatusSchema.optional(),
        dueDate: z.string().nullable().optional(),
        ownerEmployeeId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const row = await updateCrmTask(id, patch);
      if (row) {
        await auditMutation(ctx, "crm.tasks.update", "crm_task", id, null, {
          ...row,
        });
      }
      return row;
    }),
});

// ── Quotes (versioned per deal) ────────────────────────────

const quoteLineItemSchema = z.object({
  label: z.string().min(1),
  unitSell: z.number().min(0),
  unitCost: z.number().min(0),
  qty: z.number().positive().optional(),
  isVendor: z.boolean().optional(),
});

export const crmQuotesRouter = router({
  listByDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const rows = await listQuotesByDeal(input.dealId);
      return rows.map((q) => redactQuoteMargin(q, ctx.canViewMargin));
    }),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const row = await getQuote(input.id);
      if (!row) return null;
      return redactQuoteMargin(row, ctx.canViewMargin);
    }),
  save: staffProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        lineItems: z.array(quoteLineItemSchema).min(1),
        discountPct: z.number().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const deal = await getDeal(input.dealId);
      if (!deal) return { ok: false as const, reason: "Deal not found" };

      // Non-margin roles never see unitCost, so their client echoes 0s back.
      // Carry costs forward from the latest version instead of zeroing them.
      let lineItems = input.lineItems;
      if (!ctx.canViewMargin) {
        const [[latest], settings] = await Promise.all([
          listQuotesByDeal(input.dealId),
          getSalesOsSettings(),
        ]);
        const prior = latest?.lineItems ?? [];
        // Label match only — a positional fallback bleeds another line's cost
        // into renamed/new lines. Unmatched lines keep the client's unitCost.
        lineItems = input.lineItems.map((li) => {
          const match = prior.find((p) => p.label === li.label);
          const pricedPrior = match && match.unitCost > 0 ? match : null;
          const rate = settings.rateCard.find(
            (item) =>
              item.active &&
              item.unitSell > 0 &&
              item.unitCost > 0 &&
              item.service === li.label,
          );
          if (!pricedPrior && !rate) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Finance or Partner must cost the new line “${li.label}” before it can be quoted`,
            });
          }
          return {
            ...li,
            unitCost: pricedPrior?.unitCost ?? rate!.unitCost,
          };
        });
      }

      const discountPct = input.discountPct ?? 0;
      const metrics = computeQuoteMetrics(lineItems, discountPct);
      // Same tier thresholds as deals.discount (m3): ≤5 am, ≤15 md, else partner.
      const tier = discountPct > 0 ? discountAuthorityTier(discountPct) : null;
      const escalatedTo =
        tier === "partner" && !ctx.roles.includes("partner")
          ? ("partner" as const)
          : tier === "md" &&
              !ctx.roles.some((r) => ["md", "director", "partner"].includes(r))
            ? ("md" as const)
            : undefined;

      const quote = await createQuoteVersion({
        dealId: input.dealId,
        lineItems,
        quoteValue: metrics.quoteValue.toFixed(2),
        internalCost: metrics.internalCost.toFixed(2),
        marginPct: metrics.marginPct.toFixed(2),
        discountPct: discountPct > 0 ? discountPct.toFixed(2) : null,
        discountApprovalTier: tier,
        status: "draft",
        createdBy: ctx.employeeId,
      });
      const projected = await updateDeal(input.dealId, {
        quoteValue: quote.quoteValue,
        internalCost: quote.internalCost,
        marginPct: quote.marginPct,
        discountPct: quote.discountPct,
        discountApprovalTier: quote.discountApprovalTier,
      });
      if (!projected) throw new Error("Failed to project quote onto deal");
      await auditMutation(
        ctx,
        "crm.quotes.save",
        "crm_quote",
        quote.quoteId,
        null,
        {
          dealId: quote.dealId,
          version: quote.version,
          quoteValue: quote.quoteValue,
          marginPct: quote.marginPct,
          discountPct: quote.discountPct,
          discountApprovalTier: quote.discountApprovalTier,
          status: quote.status,
        },
      );
      // Margin oracle only for margin-viewing roles; approvalTier/escalatedTo
      // stay — the AM escalation UX needs them.
      const marginOracle: {
        marginBelowFloor?: boolean;
        floorPct?: number;
        targetPct?: number;
      } = ctx.canViewMargin
        ? {
            marginBelowFloor: metrics.marginPct < MARGIN_FLOOR_PCT,
            floorPct: MARGIN_FLOOR_PCT,
            targetPct: MARGIN_TARGET_PCT,
          }
        : {};
      return {
        ok: true as const,
        quote: redactQuoteMargin(quote, ctx.canViewMargin),
        approvalTier: tier,
        escalatedTo,
        ...marginOracle,
      };
    }),
  acceptSigned: staffProcedure
    .input(
      z.object({
        quoteId: z.string().uuid(),
        evidenceUrl: z
          .string()
          .url()
          .refine(
            (value) => value.startsWith("https://"),
            "HTTPS URL required",
          ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.roles.some((role) => ["partner", "director"].includes(role))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Partner or Director approval required",
        });
      }
      const quote = await getQuote(input.quoteId);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
      const [latest] = await listQuotesByDeal(quote.dealId);
      if (latest?.quoteId !== quote.quoteId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only the latest quote version can be accepted",
        });
      }
      if (Number(quote.marginPct ?? 0) < MARGIN_FLOOR_PCT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Margin is below the ${MARGIN_FLOOR_PCT}% floor`,
        });
      }
      const accepted = await updateQuoteStatus(quote.quoteId, "accepted");
      if (!accepted) throw new Error("Failed to accept quote");
      await createActivity({
        type: "system",
        subject: `Signed agreement recorded for quote v${quote.version}`,
        dealId: quote.dealId,
        actorEmployeeId: ctx.employeeId,
        metadata: {
          quoteId: quote.quoteId,
          quoteVersion: quote.version,
          evidenceUrl: input.evidenceUrl,
        },
      });
      await auditMutation(
        ctx,
        "crm.quotes.accept_signed",
        "crm_quote",
        quote.quoteId,
        { status: quote.status },
        {
          status: accepted.status,
          evidenceUrl: input.evidenceUrl,
          version: accepted.version,
        },
      );
      return redactQuoteMargin(accepted, ctx.canViewMargin);
    }),
});

// ── Dedupe & merge ─────────────────────────────────────────

export const crmDedupeRouter = router({
  candidates: staffProcedure.query(() => dedupeCandidates()),
});

export const crmMergeRouter = router({
  contacts: staffProcedure
    .input(
      z.object({
        survivorId: z.string().uuid(),
        duplicateId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Snapshot the duplicate before the merge deletes it — the audit
      // 'before' payload is the only way to recover merged data.
      const duplicate = await getContact(input.duplicateId);
      const result = await mergeContacts(input);
      if (result.ok) {
        await auditMutation(
          ctx,
          "crm.merge.contacts",
          "contact",
          input.survivorId,
          {
            survivorId: input.survivorId,
            duplicateId: input.duplicateId,
            duplicate: duplicate ? { ...duplicate } : null,
          },
          {
            survivorId: input.survivorId,
            mergedDuplicateId: input.duplicateId,
          },
        );
      }
      return result;
    }),
  companies: staffProcedure
    .input(
      z.object({
        survivorId: z.string().uuid(),
        duplicateId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const duplicate = await getCompany(input.duplicateId);
      const result = await mergeCompanies(input);
      if (result.ok) {
        await auditMutation(
          ctx,
          "crm.merge.companies",
          "company",
          input.survivorId,
          {
            survivorId: input.survivorId,
            duplicateId: input.duplicateId,
            duplicate: duplicate ? { ...duplicate } : null,
          },
          {
            survivorId: input.survivorId,
            mergedDuplicateId: input.duplicateId,
          },
        );
      }
      return result;
    }),
});

// ── Omni search ────────────────────────────────────────────

export const crmSearchRouter = router({
  omni: staffProcedure
    .input(z.object({ q: z.string().min(1).max(200) }))
    .query(async ({ input, ctx }) => {
      const result = await omniSearch(input.q);
      return {
        ...result,
        deals: result.deals.map((d) => redactDealMargin(d, ctx.canViewMargin)),
      };
    }),
});

// ── CSV export / import ────────────────────────────────────

export const crmExportRouter = router({
  companies: staffProcedure.query(async () => {
    const rows = await listCompanies();
    return toCsv(
      [
        "companyId",
        "name",
        "sector",
        "market",
        "website",
        "linkedinUrl",
        "notes",
        "createdAt",
      ],
      rows as unknown as Record<string, unknown>[],
    );
  }),
  contacts: staffProcedure.query(async () => {
    const rows = await listContacts();
    return toCsv(
      [
        "contactId",
        "companyId",
        "firstName",
        "lastName",
        "email",
        "phone",
        "title",
        "linkedinUrl",
        "emailVerified",
        "isPrimary",
        "createdAt",
      ],
      rows as unknown as Record<string, unknown>[],
    );
  }),
  deals: staffProcedure.query(async ({ ctx }) => {
    const rows = await listDeals();
    const columns = [
      "dealId",
      "companyId",
      "companyName",
      "sector",
      "stage",
      "leadSourceLane",
      "quoteValue",
      ...(ctx.canViewMargin ? ["internalCost", "marginPct"] : []),
      "discountPct",
      "ownerEmployeeId",
      "createdAt",
    ];
    return toCsv(columns, rows as unknown as Record<string, unknown>[]);
  }),
});

const companyImportRowSchema = z.object({
  name: z.string().min(1),
  sector: z.string().nullable().optional(),
  market: marketSchema.optional(),
  website: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const contactImportRowSchema = z.object({
  companyId: z.string().uuid().nullable().optional(),
  firstName: z.string().min(1),
  lastName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
});

type ImportSummary = {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
};

export const crmImportRouter = router({
  companies: staffProcedure
    .input(z.object({ rows: z.array(z.record(z.unknown())).min(1).max(5000) }))
    .mutation(async ({ input, ctx }) => {
      const existing = await listCompanies();
      const seen = new Set<string>();
      for (const co of existing) {
        const domain = normalizeDomain(co.website);
        if (domain) seen.add(`d:${domain}`);
        seen.add(`n:${co.name.trim().toLowerCase()}`);
      }
      const summary: ImportSummary = { created: 0, skipped: 0, errors: [] };
      for (const [i, raw] of input.rows.entries()) {
        const parsed = companyImportRowSchema.safeParse(raw);
        if (!parsed.success) {
          summary.errors.push({
            row: i,
            message: parsed.error.issues
              .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
              .join("; "),
          });
          continue;
        }
        const row = parsed.data;
        const domain = normalizeDomain(row.website ?? null);
        const nameKey = `n:${row.name.trim().toLowerCase()}`;
        if ((domain && seen.has(`d:${domain}`)) || seen.has(nameKey)) {
          summary.skipped += 1;
          continue;
        }
        // Per-row guard: one failing insert must not 500 the whole batch.
        try {
          await createCompany(row);
        } catch (e) {
          summary.errors.push({
            row: i,
            message: e instanceof Error ? e.message : String(e),
          });
          continue;
        }
        if (domain) seen.add(`d:${domain}`);
        seen.add(nameKey);
        summary.created += 1;
      }
      await auditMutation(ctx, "crm.import.companies", "company", null, null, {
        created: summary.created,
        skipped: summary.skipped,
        errorCount: summary.errors.length,
      });
      return summary;
    }),
  contacts: staffProcedure
    .input(z.object({ rows: z.array(z.record(z.unknown())).min(1).max(5000) }))
    .mutation(async ({ input, ctx }) => {
      const existing = await listContacts();
      const seenEmails = new Set(
        existing
          .map((c) => c.email?.trim().toLowerCase())
          .filter((e): e is string => !!e),
      );
      const summary: ImportSummary = { created: 0, skipped: 0, errors: [] };
      for (const [i, raw] of input.rows.entries()) {
        const parsed = contactImportRowSchema.safeParse(raw);
        if (!parsed.success) {
          summary.errors.push({
            row: i,
            message: parsed.error.issues
              .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
              .join("; "),
          });
          continue;
        }
        const row = parsed.data;
        const emailKey = row.email?.trim().toLowerCase();
        if (emailKey && seenEmails.has(emailKey)) {
          summary.skipped += 1;
          continue;
        }
        // Per-row guard: one failing insert must not 500 the whole batch.
        try {
          await createContact(row);
        } catch (e) {
          summary.errors.push({
            row: i,
            message: e instanceof Error ? e.message : String(e),
          });
          continue;
        }
        if (emailKey) seenEmails.add(emailKey);
        summary.created += 1;
      }
      await auditMutation(ctx, "crm.import.contacts", "contact", null, null, {
        created: summary.created,
        skipped: summary.skipped,
        errorCount: summary.errors.length,
      });
      return summary;
    }),
});

/** Durable CRM surface — Postgres when DATABASE_URL set, else seeded memory. */
export const crmRouter = router({
  health: publicProcedure.query(async () => ({
    ...(await crmHealth()),
    mode: crmBackendMode(),
  })),
  stages: publicProcedure.query(() => pipelineStages()),
  /**
   * One-shot demo: prospect → pipeline → won → client onboarding →
   * creative QC task. Optional viaApollo uses durable Apollo import first.
   */
  runDemoClosedLoop: staffProcedure
    .input(
      z
        .object({
          companyName: z.string().min(2).max(120).optional(),
          /** When true, seed via Apollo search → durable CRM, then close. */
          viaApollo: z.boolean().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      if (!legacySalesSyntheticRuntimeEnabled()) {
        return legacySalesEffectRefusal("crm.runDemoClosedLoop");
      }
      const result = await runDemoClosedLoopCore({
        companyName: input?.companyName,
        viaApollo: input?.viaApollo,
        actorEmployeeId: ctx.employeeId,
      });
      if (!result.ok) {
        return result;
      }

      await auditMutation(
        ctx,
        "crm.runDemoClosedLoop",
        "deal",
        result.dealId,
        null,
        {
          companyId: result.companyId,
          clientId: result.clientId,
          taskId: result.taskId,
          calendarId: result.calendarId,
          portalInvite: result.portalInvite,
          outreachId: result.outreachId,
          invoiceId: result.invoiceId,
          viaApollo: result.viaApollo,
          apolloMode: result.apolloMode,
        },
      );

      return result;
    }),

  /** Durable prospecting helpers (Postgres / CRM memory). */
  prospect: router({
    apolloImport: staffProcedure
      .input(z.object({ query: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        if (!legacySalesSyntheticRuntimeEnabled()) {
          return {
            ...legacySalesEffectRefusal("crm.prospect.apolloImport"),
            deals: [],
            mode: "disabled" as const,
            verifyMode: "skipped" as const,
          };
        }
        const { importApolloCompaniesToCrm } =
          await import("../crm/apollo-import");
        const {
          resolveApolloRuntimeConfig,
          resolveEmailVerificationRuntimeConfig,
        } = await import("../integrations/runtime-adapters");
        const { createApolloAdapter, createEmailVerificationAdapter } =
          await import("@hrmny/integrations");
        const apollo = await resolveApolloRuntimeConfig(ctx.employeeId!);
        const verifier = await resolveEmailVerificationRuntimeConfig(
          ctx.employeeId!,
        );
        const apolloClient = createApolloAdapter(apollo.config);
        const mode = apollo.mode;
        const hits = await apolloClient.searchCompanies(input.query);
        const result = await importApolloCompaniesToCrm({
          query: input.query,
          companies: hits as Record<string, unknown>[],
          mode,
          ownerEmployeeId: ctx.employeeId,
          verifier: createEmailVerificationAdapter(verifier.config),
        });
        await auditMutation(
          ctx,
          "crm.prospect.apolloImport",
          "deal",
          result.deals[0]?.dealId ?? null,
          null,
          {
            query: input.query,
            mode,
            verifyMode: result.verifyMode,
            count: result.deals.length,
          },
        );
        return result;
      }),
  }),

  companies: crmCompaniesRouter,
  contacts: crmContactsRouter,
  deals: crmDealsRouter,
  activities: crmActivitiesRouter,
  notes: crmNotesRouter,
  tasks: crmTasksRouter,
  quotes: crmQuotesRouter,
  dedupe: crmDedupeRouter,
  merge: crmMergeRouter,
  search: crmSearchRouter,
  export: crmExportRouter,
  import: crmImportRouter,
});
