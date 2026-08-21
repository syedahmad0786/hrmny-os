import { z } from "zod";
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
import {
  closeDurableDeal,
  durableHandoverPack,
} from "../crm/handover";
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
} from "../crm/repository";
import { redactDealMargin, redactQuoteMargin } from "../crm/types";
import { emitHealthSignal, writeAudit } from "../m1-persistence";
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

const marketSchema = z.enum(["UAE", "KSA", "Both"]);
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
      await auditMutation(ctx, "crm.companies.create", "company", row.companyId, null, {
        ...row,
      });
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
      await auditMutation(ctx, "crm.contacts.create", "contact", row.contactId, null, {
        ...row,
      });
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
        emailVerified: z.boolean().optional(),
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
        buafBudget: z.boolean().nullable().optional(),
        buafUrgency: z.boolean().nullable().optional(),
        buafAccess: z.boolean().nullable().optional(),
        buafFit: z.boolean().nullable().optional(),
        buafTemperature: z
          .enum(["hot", "warm", "cool", "cold"])
          .nullable()
          .optional(),
        emailVerified: z.boolean().optional(),
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

      // Durable CRM has no voice_check column yet — treat verified email as
      // voice-check proxy so engage→scope is demoable end-to-end.
      const gateData = {
        ...existing,
        voiceCheckPassed: existing.emailVerified,
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
              data: { ...moved.deal, voiceCheckPassed: moved.deal.emailVerified },
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
  close: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        outcome: z.enum(["won", "lost", "postponed_on_hold"]),
        lostReason: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
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
  handoverPack: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
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
      await auditMutation(ctx, "crm.notes.create", "crm_note", row.crmNoteId, null, {
        ...row,
      });
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
      await auditMutation(ctx, "crm.tasks.create", "crm_task", row.crmTaskId, null, {
        ...row,
      });
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
        status: z.enum(["draft", "sent", "accepted", "rejected"]).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const deal = await getDeal(input.dealId);
      if (!deal) return { ok: false as const, reason: "Deal not found" };

      // Non-margin roles never see unitCost, so their client echoes 0s back.
      // Carry costs forward from the latest version instead of zeroing them.
      let lineItems = input.lineItems;
      if (!ctx.canViewMargin) {
        const [latest] = await listQuotesByDeal(input.dealId);
        const prior = latest?.lineItems ?? [];
        // Label match only — a positional fallback bleeds another line's cost
        // into renamed/new lines. Unmatched lines keep the client's unitCost.
        lineItems = input.lineItems.map((li) => {
          const match = prior.find((p) => p.label === li.label);
          return match ? { ...li, unitCost: match.unitCost } : li;
        });
      }

      const metrics = computeQuoteMetrics(lineItems);
      const discountPct = input.discountPct ?? 0;
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
        status: input.status ?? "draft",
        createdBy: ctx.employeeId,
      });
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
          { survivorId: input.survivorId, mergedDuplicateId: input.duplicateId },
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
          { survivorId: input.survivorId, mergedDuplicateId: input.duplicateId },
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
      ["companyId", "name", "sector", "market", "website", "linkedinUrl", "notes", "createdAt"],
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
      const stamp = Date.now();
      let companyId: string;
      let contactId: string;
      let dealId: string;
      let companyName: string;
      let apolloMode: "mock" | "live" | null = null;

      if (input?.viaApollo) {
        const { importApolloCompaniesToCrm } = await import(
          "../crm/apollo-import"
        );
        const { resolveIntegrationApiKey } = await import(
          "../integrations/resolve-keys"
        );
        const { createApolloLive, createEmailVerificationAdapter } =
          await import("@hrmny/integrations");
        const { getDemoStore } = await import("../demo-store");
        const query =
          input?.companyName?.trim() || `Demo Retail UAE ${stamp}`;
        const { apiKey } = await resolveIntegrationApiKey(
          "apollo",
          ctx.employeeId!,
        );
        const hunter = await resolveIntegrationApiKey(
          "hunter",
          ctx.employeeId!,
        );
        const apolloClient = apiKey
          ? createApolloLive({ mode: "live", apiKey })
          : getDemoStore().apollo;
        apolloMode = apiKey ? "live" : "mock";
        const hits = await apolloClient.searchCompanies(query);
        const imported = await importApolloCompaniesToCrm({
          query,
          companies: hits as Record<string, unknown>[],
          mode: apolloMode,
          ownerEmployeeId: ctx.employeeId,
          limit: 1,
          verifier: createEmailVerificationAdapter(
            hunter.apiKey
              ? { mode: "live", apiKey: hunter.apiKey }
              : { mode: "mock" },
          ),
        });
        const first = imported.deals[0];
        if (!first) {
          return {
            ok: false as const,
            step: "apollo",
            reason: "Apollo returned no companies",
          };
        }
        companyId = first.companyId;
        contactId = first.contactId ?? "";
        dealId = first.dealId;
        companyName = first.companyName;
        if (!contactId) {
          const contact = await createContact({
            companyId,
            firstName: "Apollo",
            lastName: "Prospect",
            email: `apollo+${stamp}@example.com`,
            isPrimary: true,
          });
          contactId = contact.contactId;
          await updateDeal(dealId, { primaryContactId: contactId });
        }
      } else {
        companyName =
          input?.companyName?.trim() || `Demo Hunt ${stamp}`;
        const company = await createCompany({
          name: companyName,
          market: "UAE",
          website: `https://demo-${stamp}.example`,
        });
        const contact = await createContact({
          companyId: company.companyId,
          firstName: "Demo",
          lastName: "Prospect",
          email: `prospect+${stamp}@example.com`,
          title: "Marketing Lead",
          isPrimary: true,
        });
        const deal = await createDeal({
          companyName: company.name,
          companyId: company.companyId,
          primaryContactId: contact.contactId,
          leadSourceLane: "relationship_led",
          ownerEmployeeId: ctx.employeeId,
        });
        companyId = company.companyId;
        contactId = contact.contactId;
        dealId = deal.dealId;
      }

      const stages = [
        "qualify",
        "engage",
        "scope",
        "propose",
        "price_cost",
      ] as const;
      for (const to of stages) {
        const moved = await moveDealStage({
          dealId,
          to,
          actorEmployeeId: ctx.employeeId,
        });
        if (!moved.ok) {
          return {
            ok: false as const,
            step: `stage:${to}`,
            reason: moved.reason,
          };
        }
      }

      let outreachId: string | null = null;
      try {
        const { draftOutreach } = await import("./leadgen-router");
        const outreach = await draftOutreach({
          dealId,
          channel: "gmail",
          subject: `Creative Harmony × ${companyName}`,
          body: `Hi — following up on ${companyName}. We'd love to share a short creative retainer concept for the UAE market. Shall we book 20 minutes?`,
        });
        outreachId = outreach.id;
      } catch {
        /* outreach optional when agent/kill-switch refuses */
      }

      await updateDeal(dealId, {
        quoteValue: "50000",
        internalCost: "28000",
      });

      const closed = await closeDurableDeal({
        dealId,
        outcome: "won",
        actorEmployeeId: ctx.employeeId,
      });
      if (!closed.ok) {
        return {
          ok: false as const,
          step: "close",
          reason: closed.reason,
          code: closed.code,
        };
      }

      const pack = await durableHandoverPack({
        dealId,
        actorEmployeeId: ctx.employeeId,
      });
      if (!pack.ok) {
        return {
          ok: false as const,
          step: "handover",
          reason: pack.reason,
          code: pack.code,
          dealId,
        };
      }

      let calendarId: string | null = null;
      try {
        const { createDeliveryCalendar, addDeliveryCalendarSlot } =
          await import("../tasks/delivery-calendars");
        const month = new Date().toISOString().slice(0, 7);
        const calendar = await createDeliveryCalendar({
          clientId: pack.client.clientId,
          month,
          focusPoints: ["Launch reel", "Product stills"],
        });
        calendarId = calendar?.calendarId ?? null;
        if (calendar && pack.task?.taskId) {
          await addDeliveryCalendarSlot({
            calendarId: calendar.calendarId,
            slotDate: `${month}-15`,
            slotLabel: "Studio shoot",
            taskId: pack.task.taskId,
            position: 1,
          });
        }
      } catch {
        /* calendar optional if schema missing state column on older DBs */
      }

      let portalInvite: {
        portalUserId: string;
        email: string;
        portalPath?: string;
        delivery?: { mode: "mock" | "live"; id: string };
      } | null = null;
      try {
        const { getDb } = await import("../db");
        const { sql } = await import("@hrmny/db");
        const db = getDb();
        if (db) {
          const contact = contactId ? await getContact(contactId) : null;
          const inviteEmail =
            contact?.email?.trim().toLowerCase() ||
            `portal+${pack.client.clientId.slice(0, 8)}@example.com`;
          const displayName =
            [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ||
            `${pack.client.name} Portal`;
          const existing = await db.execute<{
            portalUserId: string;
            email: string;
          }>(sql`
            select client_portal_user_id as "portalUserId", email
            from public.client_portal_user
            where client_id = ${pack.client.clientId}::uuid
              and lower(email) = ${inviteEmail}
            limit 1
          `);
          let invited = existing[0] ?? null;
          if (invited) {
            await db.execute(sql`
              update public.client_portal_user
              set is_active = true, display_name = ${displayName},
                  updated_at = now()
              where client_portal_user_id = ${invited.portalUserId}::uuid
            `);
          } else {
            const created = await db.execute<{
              portalUserId: string;
              email: string;
            }>(sql`
              insert into public.client_portal_user (
                client_id, email, display_name, is_active
              ) values (
                ${pack.client.clientId}::uuid,
                ${inviteEmail},
                ${displayName},
                true
              )
              returning client_portal_user_id as "portalUserId", email
            `);
            invited = created[0] ?? null;
          }
          if (invited) {
            const { sendPortalInviteMagicLink } = await import(
              "../auth/portal-magic-link"
            );
            // Demo placeholder inboxes must not hit live Resend (bounces /
            // rejects). Token + portalPath still return for the Hunt result.
            const placeholderInbox = inviteEmail.endsWith("@example.com");
            const { createResendMock } = await import("@hrmny/integrations");
            const sent = await sendPortalInviteMagicLink({
              email: inviteEmail,
              clientId: pack.client.clientId,
              displayName,
              emailer: placeholderInbox ? createResendMock() : undefined,
            });
            portalInvite = {
              ...invited,
              portalPath: sent.portalPath,
              delivery: { mode: sent.delivery.mode, id: sent.delivery.id },
            };
          }
        }
      } catch {
        /* invite optional when unique constraints differ */
      }

      await auditMutation(
        ctx,
        "crm.runDemoClosedLoop",
        "deal",
        dealId,
        null,
        {
          companyId,
          clientId: pack.client.clientId,
          taskId: pack.task?.taskId ?? null,
          calendarId,
          portalInvite,
          outreachId,
          invoiceId: pack.invoiceId,
          viaApollo: Boolean(input?.viaApollo),
          apolloMode,
        },
      );

      return {
        ok: true as const,
        companyId,
        contactId,
        dealId,
        clientId: pack.client.clientId,
        clientName: pack.client.name,
        taskId: pack.task?.taskId ?? null,
        calendarId,
        portalInvite,
        outreachId,
        invoiceId: pack.invoiceId,
        onboardingPhases: pack.onboardingPhases,
        fired: pack.pack.fired,
        viaApollo: Boolean(input?.viaApollo),
        apolloMode,
        next: {
          crmDeal: `/crm/deals/${dealId}`,
          client: `/clients/${pack.client.clientId}`,
          account: `/account?clientId=${encodeURIComponent(pack.client.clientId)}`,
          finance: pack.invoiceId
            ? `/finance?invoiceId=${encodeURIComponent(pack.invoiceId)}`
            : "/finance",
          billing: "/billing",
          creative: `/creative?clientId=${encodeURIComponent(pack.client.clientId)}`,
          portal: "/portal/approvals",
          onboarding: "/portal/onboarding",
          approvals: "/approvals",
          outreach: outreachId
            ? `/crm/outreach?id=${encodeURIComponent(outreachId)}`
            : "/crm/outreach",
        },
      };
    }),

  /** Durable prospecting helpers (Postgres / CRM memory). */
  prospect: router({
    apolloImport: staffProcedure
      .input(z.object({ query: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        const { importApolloCompaniesToCrm } = await import(
          "../crm/apollo-import"
        );
        const { resolveIntegrationApiKey } = await import(
          "../integrations/resolve-keys"
        );
        const { createApolloLive, createEmailVerificationAdapter } =
          await import("@hrmny/integrations");
        const { getDemoStore } = await import("../demo-store");
        const { apiKey } = await resolveIntegrationApiKey(
          "apollo",
          ctx.employeeId!,
        );
        const hunter = await resolveIntegrationApiKey(
          "hunter",
          ctx.employeeId!,
        );
        const apolloClient = apiKey
          ? createApolloLive({ mode: "live", apiKey })
          : getDemoStore().apollo;
        const mode = apiKey ? ("live" as const) : ("mock" as const);
        const hits = await apolloClient.searchCompanies(input.query);
        const result = await importApolloCompaniesToCrm({
          query: input.query,
          companies: hits as Record<string, unknown>[],
          mode,
          ownerEmployeeId: ctx.employeeId,
          verifier: createEmailVerificationAdapter(
            hunter.apiKey
              ? { mode: "live", apiKey: hunter.apiKey }
              : { mode: "mock" },
          ),
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
