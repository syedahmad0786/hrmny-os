import { z } from "zod";
import { CRM_MARKETS } from "@/lib/crm-markets";
import { TRPCError } from "@trpc/server";
import {
  ApolloProviderRequestError,
  getApolloCreditUsage,
  salesgrowth,
} from "@hrmny/integrations";
import { runSalesGrowthImport } from "../crm/salesgrowth-import";
import { addCredit } from "../sales-os/store";
import {
  applyEvolve,
  APOLLO_EMAIL_STATUSES,
  APOLLO_PERSON_SENIORITIES,
  applySalesOsReplyIntent,
  approveApolloExactPerson,
  assertLinkedInAssistAllowed,
  buildSalesOsDigest,
  createSalesCampaign,
  decideCompany,
  decideContact,
  DEFAULT_SALES_OS_SETTINGS,
  draftChannelsForApprovedContact,
  enrichOneApolloPerson,
  getApolloOnePersonCanaryStatus,
  getLatestApolloPeopleSearch,
  getApolloPeopleSearchStatus,
  getResearchReceiptSignalIdsByProposal,
  getSalesFunnel,
  getSalesOsSettings,
  honorUnsubscribe,
  ingestGmailReply,
  ingestManualResearch,
  listCompanyResearch,
  listSalesCampaigns,
  listContactResearch,
  listEvolveProposals,
  listIntelSignals,
  listSuppression,
  normalizeResearchEvidence,
  OUTREACH_GUIDELINES,
  processIntentLeads,
  proposeEvolve,
  rejectEvolve,
  RESEARCH_GUIDELINES,
  revokeApolloPeopleSearch,
  searchApolloPeopleFree,
  SALES_OS_SOP_SOURCE,
  mutateSalesOsSettings,
  runSalesCampaignFirstTouch,
  runSalesCampaignFollowups,
  setSalesCampaignStatus,
  sectorForDate,
  suppressTarget,
  consumeApolloExactApproval,
  weekKey,
  type SalesOsSettings,
} from "../sales-os";
import { getOutreach, listOutreach, patchOutreach } from "../leadgen/store";
import {
  ownedIntegrationConnectionStatus,
  resolveOwnedIntegrationApiKey,
} from "../integrations/resolve-keys";
import { importApolloPersonToCrm } from "../crm/apollo-import";
import { getContact } from "../crm/repository";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  findIntegrationReceiptByDealId,
  getIntegrationReceipt,
  recordIntegrationReceipt,
} from "../integrations/inbox";
import { middleware, router, staffProcedure } from "./trpc";

const SALES_OPERATOR_ROLES = new Set([
  "partner",
  "director",
  "am",
  "account_manager",
]);
const SALES_ADMIN_ROLES = new Set(["partner", "director"]);

function salesRoleProcedure(allowed: ReadonlySet<string>, message: string) {
  return staffProcedure.use(
    middleware(({ ctx, next }) => {
      if (!ctx.roles.some((role) => allowed.has(role))) {
        throw new TRPCError({ code: "FORBIDDEN", message });
      }
      return next({ ctx });
    }),
  );
}

export const salesOperatorProcedure = salesRoleProcedure(
  SALES_OPERATOR_ROLES,
  "Sales operator role required",
);
const salesAdminProcedure = salesRoleProcedure(
  SALES_ADMIN_ROLES,
  "Sales administrator role required",
);

const settingsPatch = z.object({
  rateCard: z
    .array(
      z.object({
        service: z.string().trim().min(1).max(180),
        unit: z.string().trim().min(1).max(60),
        unitSell: z.number().min(0),
        unitCost: z.number().min(0),
        active: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
  icp: z
    .object({
      target: z.string().optional(),
      primarySectors: z.array(z.string()).optional(),
      secondarySectors: z.array(z.string()).optional(),
      noGo: z.array(z.string()).optional(),
      minEmployeesGlobal: z.number().optional(),
      minEmployeesMena: z.number().optional(),
      minSeniority: z.string().optional(),
    })
    .optional(),
  caps: z
    .object({
      apolloContactsPerMonth: z.number().optional(),
      emailPerDay: z.number().optional(),
      linkedinConnectsPerWeek: z.number().optional(),
      companiesPerResearchRun: z.number().optional(),
      pauseAllOutreach: z.boolean().optional(),
    })
    .optional(),
  outreach: z
    .object({
      senderName: z.string().optional(),
      senderTitle: z.string().optional(),
      physicalAddress: z.string().optional(),
      voice: z.string().optional(),
    })
    .optional(),
});

const apolloCandidateInput = z.object({
  externalId: z.string().trim().min(1).max(180),
  email: z.string().trim().email().optional(),
  fullName: z.string().trim().min(2).max(180).optional(),
  title: z.string().trim().min(1).max(180).optional(),
  companyName: z.string().trim().min(1).max(180).optional(),
  companyDomain: z.string().trim().min(1).max(255).optional(),
  linkedinUrl: z.string().trim().url().max(500).optional(),
});

export const salesOsRouter = router({
  access: staffProcedure.query(({ ctx }) => ({
    canOperate: ctx.roles.some((role) => SALES_OPERATOR_ROLES.has(role)),
    canAdmin: ctx.roles.some((role) => SALES_ADMIN_ROLES.has(role)),
    principalId: ctx.employeeId,
  })),
  apollo: router({
    status: staffProcedure.query(() => getApolloOnePersonCanaryStatus()),
    connection: staffProcedure.query(async ({ ctx }) => ({
      ...(await ownedIntegrationConnectionStatus("apollo", ctx.employeeId)),
      principalId: ctx.employeeId,
    })),
    creditBalance: staffProcedure.query(async ({ ctx }) => {
      const { apiKey } = await resolveOwnedIntegrationApiKey(
        "apollo",
        ctx.employeeId,
        null,
      );
      if (!apiKey) {
        return {
          state: "not_connected" as const,
          principalId: ctx.employeeId,
          message: "Connect Apollo to view the live team credit balance.",
        };
      }
      try {
        return {
          state: "live" as const,
          principalId: ctx.employeeId,
          ...(await getApolloCreditUsage(apiKey)),
        };
      } catch (error) {
        if (error instanceof ApolloProviderRequestError) {
          return {
            state:
              error.httpStatus === 403
                ? ("scope_required" as const)
                : ("unavailable" as const),
            principalId: ctx.employeeId,
            message:
              error.httpStatus === 403
                ? "This Apollo key needs the credit usage stats permission. Reconnect it with api/v1/usage_stats/credit_usage_stats enabled."
                : "Apollo could not return the live credit balance right now.",
            retryable: error.retryable,
          };
        }
        throw error;
      }
    }),
    search: salesOperatorProcedure
      .input(
        z
          .object({
            idempotencyKey: z.string().uuid(),
            query: z.string().trim().min(2).max(160).optional(),
            titles: z
              .array(z.string().trim().min(2).max(120))
              .min(1)
              .max(8)
              .optional(),
            locations: z
              .array(z.string().trim().min(2).max(120))
              .max(6)
              .optional(),
            organizationLocations: z
              .array(z.string().trim().min(2).max(120))
              .max(6)
              .optional(),
            seniorities: z
              .array(z.enum(APOLLO_PERSON_SENIORITIES))
              .max(11)
              .optional(),
            emailStatuses: z
              .array(z.enum(APOLLO_EMAIL_STATUSES))
              .max(4)
              .optional(),
            technologyIds: z
              .array(
                z
                  .string()
                  .trim()
                  .regex(/^[a-z0-9_]+$/)
                  .max(80),
              )
              .max(10)
              .optional(),
            includeSimilarTitles: z.boolean().optional(),
            employeeCountMin: z.number().int().min(1).max(1_000_000).optional(),
            employeeCountMax: z.number().int().min(1).max(1_000_000).optional(),
            perPage: z.number().int().min(1).max(10).optional(),
          })
          .refine(
            (input) => Boolean(input.query) || Boolean(input.titles?.length),
            "Provide at least one job title or keyword",
          )
          .refine(
            (input) =>
              input.employeeCountMin == null ||
              input.employeeCountMax == null ||
              input.employeeCountMin <= input.employeeCountMax,
            "Company size minimum cannot exceed maximum",
          ),
      )
      .mutation(async ({ input, ctx }) => {
        const result = await searchApolloPeopleFree({
          ...input,
          actorEmployeeId: ctx.employeeId,
        });
        return result;
      }),
    searchStatus: salesOperatorProcedure
      .input(z.object({ idempotencyKey: z.string().uuid() }))
      .query(({ input, ctx }) =>
        getApolloPeopleSearchStatus({
          ...input,
          actorEmployeeId: ctx.employeeId,
        }),
      ),
    latestSearch: salesOperatorProcedure.query(({ ctx }) =>
      getLatestApolloPeopleSearch({ actorEmployeeId: ctx.employeeId }),
    ),
    cancelSearch: salesOperatorProcedure
      .input(z.object({ idempotencyKey: z.string().uuid() }))
      .mutation(({ input, ctx }) =>
        revokeApolloPeopleSearch({
          ...input,
          actorEmployeeId: ctx.employeeId,
        }),
      ),
    revokeSearch: salesAdminProcedure
      .input(z.object({ idempotencyKey: z.string().uuid() }))
      .mutation(({ input, ctx }) =>
        revokeApolloPeopleSearch({
          ...input,
          actorEmployeeId: ctx.employeeId,
          administratorOverride: true,
        }),
      ),
    savedCandidates: staffProcedure
      .input(
        z.object({
          externalIds: z.array(z.string().trim().min(1).max(180)).max(10),
        }),
      )
      .query(async ({ input, ctx }) => {
        const rows = await Promise.all(
          [...new Set(input.externalIds)].map(async (externalId) => {
            const receipt = await getIntegrationReceipt(
              "apollo",
              `free-save:${ctx.employeeId}:${externalId}`,
            );
            const result =
              receipt?.status === "completed" ? receipt.result : null;
            if (
              !result ||
              typeof result.dealId !== "string" ||
              typeof result.contactId !== "string" ||
              typeof result.companyName !== "string"
            ) {
              return null;
            }
            const contact = await getContact(result.contactId);
            return {
              externalId,
              dealId: result.dealId,
              companyName: result.companyName,
              fullName: contact
                ? `${contact.firstName} ${contact.lastName ?? ""}`.trim()
                : null,
              email: contact?.email ?? null,
              emailVerified: contact?.emailVerified ?? false,
            };
          }),
        );
        return rows.flatMap((row) => (row ? [row] : []));
      }),
    candidateForDeal: salesOperatorProcedure
      .input(z.object({ dealId: z.string().uuid() }))
      .query(async ({ input }) => {
        const receipt = await findIntegrationReceiptByDealId({
          provider: "apollo",
          operation: "people.search.save_candidate",
          dealId: input.dealId,
        });
        const candidate = apolloCandidateInput
          .omit({ email: true })
          .safeParse(receipt?.payload);
        return candidate.success ? candidate.data : null;
      }),
    saveCandidate: salesOperatorProcedure
      .input(
        z.object({
          candidate: apolloCandidateInput.omit({ email: true }),
          market: z.enum(CRM_MARKETS).default("UAE"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const receipt = await recordIntegrationReceipt({
          provider: "apollo",
          externalEventId: `free-save:${ctx.employeeId}:${input.candidate.externalId}`,
          operation: "people.search.save_candidate",
          rawBody: JSON.stringify({
            employeeId: ctx.employeeId,
            externalId: input.candidate.externalId,
          }),
          status: "processing",
          ownerEmployeeId: ctx.employeeId,
          payload: {
            ...input.candidate,
            market: input.market,
            paidDetailsUnlocked: false,
          },
        });
        if (receipt.duplicate) {
          const result = receipt.result;
          if (
            result &&
            typeof result.dealId === "string" &&
            typeof result.companyId === "string" &&
            typeof result.contactId === "string" &&
            typeof result.companyName === "string"
          ) {
            return {
              dealId: result.dealId,
              companyId: result.companyId,
              contactId: result.contactId,
              companyName: result.companyName,
              duplicate: true,
            };
          }
          if (receipt.status !== "failed") {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This prospect is already being saved. Refresh the pipeline in a moment.",
            });
          }
        }
        try {
          const imported = await importApolloPersonToCrm({
            person: {
              ...input.candidate,
              source: "apollo",
              raw: { freeSearch: true },
            },
            receiptId: receipt.receiptId,
            market: input.market,
            ownerEmployeeId: ctx.employeeId,
          });
          const result = {
            dealId: imported.dealId,
            companyId: imported.companyId,
            contactId: imported.contactId,
            companyName: imported.companyName,
            duplicate: false,
          };
          await completeIntegrationReceipt(receipt.receiptId, result);
          return result;
        } catch (error) {
          await failIntegrationReceipt(
            receipt.receiptId,
            error instanceof Error ? error.message : "save failed",
          );
          throw error;
        }
      }),
    approveExact: salesOperatorProcedure
      .input(
        z.object({
          candidate: apolloCandidateInput,
          confirmCreditUse: z.literal(true),
        }),
      )
      .mutation(({ input, ctx }) =>
        approveApolloExactPerson({
          candidate: input.candidate,
          actorEmployeeId: ctx.employeeId!,
        }),
      ),
    enrichOne: salesOperatorProcedure
      .input(
        z.object({
          candidate: apolloCandidateInput,
          confirmCreditUse: z.literal(true),
          approvalReceiptId: z.string().uuid(),
        }),
      )
      .mutation(({ input, ctx }) =>
        enrichOneApolloPerson(
          { ...input, actorEmployeeId: ctx.employeeId! },
          { consumeExactApproval: consumeApolloExactApproval },
        ),
      ),
  }),

  settings: router({
    get: staffProcedure.query(async ({ ctx }) => {
      const settings = await getSalesOsSettings();
      return {
        settings: ctx.canViewMargin
          ? settings
          : {
              ...settings,
              rateCard: settings.rateCard.map((item) => ({
                ...item,
                unitCost: 0,
              })),
            },
        defaults: ctx.canViewMargin
          ? DEFAULT_SALES_OS_SETTINGS
          : {
              ...DEFAULT_SALES_OS_SETTINGS,
              rateCard: DEFAULT_SALES_OS_SETTINGS.rateCard.map((item) => ({
                ...item,
                unitCost: 0,
              })),
            },
        source: SALES_OS_SOP_SOURCE,
        guidelines: {
          outreach: OUTREACH_GUIDELINES,
          research: RESEARCH_GUIDELINES,
        },
        sectorToday: sectorForDate(settings),
      };
    }),
    save: staffProcedure
      .input(settingsPatch)
      .mutation(async ({ input, ctx }) => {
        if (
          input.rateCard &&
          !ctx.roles.some((role) => SALES_ADMIN_ROLES.has(role))
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Partner or Director role required to edit the rate card",
          });
        }
        return mutateSalesOsSettings((current) => {
          const next: SalesOsSettings = {
            ...current,
            rateCard: input.rateCard ?? current.rateCard,
            icp: { ...current.icp, ...input.icp },
            caps: { ...current.caps, ...input.caps },
            outreach: { ...current.outreach, ...input.outreach },
          };
          return { settings: next, result: next };
        }, ctx.employeeId);
      }),
  }),

  campaigns: router({
    list: staffProcedure.query(() => listSalesCampaigns()),
    create: salesOperatorProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(120),
          dealIds: z.array(z.string().uuid()).min(1).max(100),
          subjectTemplate: z.string().trim().min(2).max(240),
          bodyTemplate: z
            .string()
            .trim()
            .min(40)
            .max(5_000)
            .refine(
              (body) => body.includes("{{company}}"),
              "Include {{company}} so every draft is company-specific",
            ),
        }),
      )
      .mutation(({ input, ctx }) =>
        createSalesCampaign({ ...input, actorEmployeeId: ctx.employeeId }),
      ),
    prepareFirstTouch: salesOperatorProcedure
      .input(
        z.object({
          campaignId: z.string().uuid(),
          runId: z.string().uuid(),
        }),
      )
      .mutation(({ input, ctx }) =>
        runSalesCampaignFirstTouch({
          ...input,
          actorEmployeeId: ctx.employeeId,
        }),
      ),
    prepareFollowups: salesOperatorProcedure
      .input(
        z.object({
          campaignId: z.string().uuid(),
          runId: z.string().uuid(),
        }),
      )
      .mutation(({ input, ctx }) =>
        runSalesCampaignFollowups({
          ...input,
          actorEmployeeId: ctx.employeeId,
        }),
      ),
    setStatus: salesOperatorProcedure
      .input(
        z.object({
          campaignId: z.string().uuid(),
          status: z.enum(["running", "paused", "completed"]),
        }),
      )
      .mutation(({ input }) => setSalesCampaignStatus(input)),
  }),

  research: router({
    list: staffProcedure
      .input(
        z
          .object({
            state: z
              .enum(["researched", "approved", "rejected", "rework"])
              .optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const rows = await listCompanyResearch(input);
        const receipts = await getResearchReceiptSignalIdsByProposal(
          rows.map((row) => row.id),
        );
        return rows.map((row) => {
          const evidenceAccepted = (() => {
            try {
              normalizeResearchEvidence(row.evidence);
              return true;
            } catch {
              return false;
            }
          })();
          const receiptAccepted = (receipts.get(row.id)?.length ?? 0) > 0;
          return { ...row, evidenceAccepted, receiptAccepted };
        });
      }),
    ingest: salesOperatorProcedure
      .input(
        z.object({
          requestId: z.string().uuid(),
          name: z.string().trim().min(2).max(180),
          market: z.enum(CRM_MARKETS).default("UAE"),
          sector: z.string().trim().max(180).optional(),
          whyThis: z.string().trim().min(8).max(2_000),
          website: z.string().trim().url().max(500).optional(),
          evidence: z.string().trim().url().max(1_000),
          estimatedValueAed: z.number().optional(),
          suggestedServices: z.string().trim().max(1_000).optional(),
          employeesGlobal: z.number().optional(),
          employeesMena: z.number().optional(),
          leadSourceLane: z.string().trim().max(120).optional(),
        }),
      )
      .mutation(({ input, ctx }) =>
        ingestManualResearch({ ...input, actorEmployeeId: ctx.employeeId }),
      ),
    decide: salesOperatorProcedure
      .input(
        z.object({
          id: z.string(),
          action: z.enum(["approve", "reject", "rework"]),
          feedback: z.string().optional(),
        }),
      )
      .mutation(({ input, ctx }) =>
        decideCompany(input.id, input.action, {
          actorId: ctx.employeeId,
          feedback: input.feedback,
        }),
      ),
    enrich: salesOperatorProcedure
      .input(z.object({ id: z.string() }))
      .mutation(() => {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "APOLLO_DURABLE_SEARCH_RECEIPT_REQUIRED",
        });
      }),
  }),

  contacts: router({
    list: staffProcedure
      .input(
        z
          .object({
            companyResearchId: z.string().optional(),
            state: z
              .enum(["found", "approved", "rejected", "rework"])
              .optional(),
          })
          .optional(),
      )
      .query(({ input }) => listContactResearch(input)),
    decide: salesOperatorProcedure
      .input(
        z.object({
          id: z.string(),
          action: z.enum(["approve", "reject", "rework"]),
          feedback: z.string().optional(),
        }),
      )
      .mutation(({ input, ctx }) =>
        decideContact(input.id, input.action, {
          actorId: ctx.employeeId,
          feedback: input.feedback,
        }),
      ),
    draft: salesOperatorProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input, ctx }) =>
        draftChannelsForApprovedContact(input.id, { roles: ctx.roles }),
      ),
  }),

  suppression: router({
    list: staffProcedure.query(() => listSuppression()),
    add: staffProcedure
      .input(
        z.object({
          email: z.string().email().optional(),
          domain: z.string().optional(),
          reason: z.enum([
            "unsubscribe",
            "bounce",
            "complaint",
            "dnc",
            "no_go",
          ]),
        }),
      )
      .mutation(({ input }) =>
        suppressTarget({
          email: input.email,
          domain: input.domain,
          reason: input.reason,
          source: "staff",
        }),
      ),
  }),

  digest: staffProcedure.query(() => buildSalesOsDigest()),

  funnel: staffProcedure
    .input(
      z
        .object({
          market: z.enum(CRM_MARKETS).optional(),
          owner: z.string().trim().min(1).optional(),
          channel: z.string().trim().min(1).optional(),
          campaign: z.string().trim().min(1).optional(),
          dateFrom: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          dateTo: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .optional(),
    )
    .query(({ input }) => getSalesFunnel(input)),

  intentCsv: salesOperatorProcedure
    .input(z.object({ csv: z.string().min(3) }))
    .mutation(({ input, ctx }) =>
      processIntentLeads(input.csv, { actorEmployeeId: ctx.employeeId }),
    ),

  replies: router({
    /** Not named `apply` — tRPC proxies collide with Function.prototype.apply. */
    applyIntent: staffProcedure
      .input(
        z.object({
          dealId: z.string().uuid(),
          intent: z.enum([
            "interested",
            "question",
            "not_now",
            "unsubscribe",
            "other",
          ]),
          email: z.string().optional(),
        }),
      )
      .mutation(({ input, ctx }) =>
        applySalesOsReplyIntent({
          dealId: input.dealId,
          intent: input.intent,
          actorEmployeeId: ctx.employeeId,
          email: input.email,
        }),
      ),
    ingest: staffProcedure
      .input(
        z.object({
          fromEmail: z.string().email(),
          body: z.string().min(1),
          dealId: z.string().uuid().optional(),
          outreachItemId: z.string().optional(),
        }),
      )
      .mutation(({ input, ctx }) =>
        ingestGmailReply({ ...input, actorEmployeeId: ctx.employeeId }),
      ),
  }),

  linkedin: router({
    markSent: staffProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        const item = await getOutreach(input.id);
        if (!item)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Outreach not found",
          });
        if (!item.channel.startsWith("linkedin")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Assisted send is LinkedIn-only",
          });
        }
        if (item.state !== "approved") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Approve the draft before marking sent",
          });
        }
        if (item.channel === "linkedin_followup") {
          const connect = (await listOutreach({ dealId: item.dealId })).find(
            (o) => o.channel === "linkedin_connect" && o.acceptedAt,
          );
          if (!connect) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Mark the connection Accepted before sending the follow-up",
            });
          }
        }
        const cap = await assertLinkedInAssistAllowed();
        if (!cap.ok) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: cap.reason,
          });
        }
        await addCredit("linkedin_assist", 1, weekKey());
        return patchOutreach(input.id, {
          state: "sent",
          sentAt: new Date().toISOString(),
        });
      }),
    markAccepted: staffProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        const item = await getOutreach(input.id);
        if (!item || item.channel !== "linkedin_connect") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Not a connection item",
          });
        }
        return patchOutreach(input.id, {
          acceptedAt: new Date().toISOString(),
        });
      }),
    markSkipped: staffProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => patchOutreach(input.id, { state: "discarded" })),
  }),

  evolve: router({
    list: staffProcedure.query(() => listEvolveProposals()),
    propose: staffProcedure
      .input(z.object({ focus: z.string().optional() }).optional())
      .mutation(({ input }) => proposeEvolve(input?.focus)),
    accept: staffProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input, ctx }) => applyEvolve(input.id, ctx.employeeId)),
    reject: staffProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => rejectEvolve(input.id)),
  }),

  intel: staffProcedure
    .input(z.object({ companyId: z.string().uuid().optional() }).optional())
    .query(({ input }) => listIntelSignals(input?.companyId)),

  importSalesGrowth: staffProcedure
    .input(
      z.object({
        data: z.unknown(),
        apply: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => {
      const parsed = salesgrowth.parseSalesGrowthExport
        ? salesgrowth.parseSalesGrowthExport(input.data)
        : (input.data as Parameters<typeof runSalesGrowthImport>[0]);
      return runSalesGrowthImport(parsed, { apply: input.apply ?? false });
    }),

  outreach: router({
    rework: staffProcedure
      .input(z.object({ id: z.string(), feedback: z.string().min(2) }))
      .mutation(async ({ input }) => {
        const item = await getOutreach(input.id);
        if (!item)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Outreach not found",
          });
        if (item.state !== "draft" && item.state !== "approved") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Only draft or approved items can be sent back for rework",
          });
        }
        return patchOutreach(input.id, {
          state: "draft",
          reworkFeedback: input.feedback.trim(),
        });
      }),
  }),

  honorUnsubscribe: staffProcedure
    .input(
      z.object({
        dealId: z.string().uuid().optional(),
        email: z.string().email(),
      }),
    )
    .mutation(({ input }) => honorUnsubscribe(input)),
});
