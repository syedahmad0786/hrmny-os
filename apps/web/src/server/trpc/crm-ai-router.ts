import { z } from "zod";
import { router, staffProcedure } from "./trpc";
import { salesOperatorProcedure } from "./sales-os-router";
import {
  accountSummary,
  companyKnowledgeBrief,
  dealSummary,
  draftOutreachForDeal,
  nextBestAction,
  rescoreBuaf,
} from "../crm-ai/service";

/**
 * W9 CRM AI surface (module only — the orchestrator wires this into appRouter
 * as `crmAi`). Read-only summaries are plain staff queries (analytics-router
 * precedent); mutations reuse the same Sales-operator role boundary as Apollo
 * and outreach. All output is draft/advisory: draftOutreach
 * lands in the same leadgen HITL queue — approve + gate before any send —
 * and rescoreBuaf writes only BUAF fields, audited. Mock-first: with
 * LLM_PROVIDER=mock (or no keys) every procedure works deterministically.
 */

const dealInput = z.object({ dealId: z.string().uuid() });

export const crmAiRouter = router({
  /** LLM summary of one deal's timeline (deal + contact + activities + notes). */
  dealSummary: staffProcedure
    .input(dealInput)
    .query(({ input }) => dealSummary(input)),

  /** LLM summary of an account: company + contacts + deals + activity trail. */
  accountSummary: staffProcedure
    .input(z.object({ companyId: z.string().uuid() }))
    .query(({ input }) => accountSummary(input)),

  /** Suggested next step for a deal from stage/BUAF/activity recency. */
  nextBestAction: staffProcedure
    .input(dealInput)
    .query(({ input }) => nextBestAction(input)),

  /** Source-backed brief stored on the deal; live search is explicitly confirmed. */
  companyKnowledgeBrief: salesOperatorProcedure
    .input(
      dealInput.extend({
        requestId: z.string().uuid(),
        confirmWebResearch: z.literal(true),
      }),
    )
    .mutation(({ input, ctx }) =>
      companyKnowledgeBrief({
        ...input,
        actorEmployeeId: ctx.employeeId!,
        roles: ctx.roles,
      }),
    ),

  /** Re-run the research-agent BUAF scoring on one deal; writes temperature back. */
  rescoreBuaf: salesOperatorProcedure
    .input(dealInput)
    .mutation(({ input, ctx }) =>
      rescoreBuaf({ ...input, actorEmployeeId: ctx.employeeId }),
    ),

  /** Draft outreach for a deal — delegates to the gated leadgen HITL queue. */
  draftOutreach: salesOperatorProcedure
    .input(dealInput)
    .mutation(({ input }) => draftOutreachForDeal(input)),
});
