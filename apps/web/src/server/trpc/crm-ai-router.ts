import { z } from "zod";
import { requirePermission, router, staffProcedure } from "./trpc";
import {
  accountSummary,
  dealSummary,
  draftOutreachForDeal,
  nextBestAction,
  rescoreBuaf,
} from "../crm-ai/service";

/**
 * W9 CRM AI surface (module only — the orchestrator wires this into appRouter
 * as `crmAi`). Read-only summaries are plain staff queries (analytics-router
 * precedent); the two mutations additionally require the `ai:run` permission
 * (ai-policy-router precedent). All output is draft/advisory: draftOutreach
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

  /** Re-run the research-agent BUAF scoring on one deal; writes temperature back. */
  rescoreBuaf: staffProcedure
    .use(requirePermission("ai", "run"))
    .input(dealInput)
    .mutation(({ input, ctx }) =>
      rescoreBuaf({ ...input, actorEmployeeId: ctx.employeeId }),
    ),

  /** Draft outreach for a deal — delegates to the gated leadgen HITL queue. */
  draftOutreach: staffProcedure
    .use(requirePermission("ai", "run"))
    .input(dealInput)
    .mutation(({ input }) => draftOutreachForDeal(input)),
});
