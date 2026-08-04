import { z } from "zod";
import { router, staffProcedure } from "./trpc";
import { listActivities, listDeals } from "../crm/repository";
import {
  computeForecast,
  computePipeline,
  computeStageConversion,
  computeWinLoss,
  type StageChangeEvent,
} from "../analytics/crm-forecast";

/**
 * W10 CRM forecast & reporting — READ-ONLY: every procedure is a query over
 * repository deal/activity data (memory-mode safe); no mutations, no writes.
 * Margin-safe by construction: computations read quoteValue only (see
 * analytics/crm-forecast.ts), so no redaction branch is needed here.
 */

/** stage_change activities from the moveDealStage audit trail. */
async function stageChangeEvents(): Promise<StageChangeEvent[]> {
  // ponytail: single bounded fetch (last 1000 activities), no pagination —
  // paginate when the activity table outgrows this window.
  const rows = await listActivities({ limit: 1000 });
  const events: StageChangeEvent[] = [];
  for (const a of rows) {
    if (a.type !== "stage_change") continue;
    const { from, to } = a.metadata as { from?: unknown; to?: unknown };
    if (typeof from === "string" && typeof to === "string") {
      events.push({ from, to });
    }
  }
  return events;
}

export const crmForecastRouter = router({
  /** Per-stage open pipeline: count, totalValue, probability-weighted value. */
  pipeline: staffProcedure.query(async () => {
    const deals = await listDeals();
    return computePipeline(deals);
  }),

  /** Weighted pipeline value + trailing won-run-rate projection. */
  forecast: staffProcedure
    .input(
      z
        .object({ horizonDays: z.number().int().min(7).max(365).default(90) })
        .optional(),
    )
    .query(async ({ input }) => {
      const deals = await listDeals();
      return computeForecast(deals, { horizonDays: input?.horizonDays ?? 90 });
    }),

  /** Won/lost counts, win rate, top lost reasons over the trailing window. */
  winLoss: staffProcedure
    .input(
      z
        .object({ sinceDays: z.number().int().min(7).max(365).default(90) })
        .optional(),
    )
    .query(async ({ input }) => {
      const deals = await listDeals();
      return computeWinLoss(deals, { sinceDays: input?.sinceDays ?? 90 });
    }),

  /** Stage→stage conversion from the stage_change audit trail (distribution fallback). */
  stageConversion: staffProcedure.query(async () => {
    const [deals, events] = await Promise.all([
      listDeals(),
      stageChangeEvents(),
    ]);
    return computeStageConversion(deals, events);
  }),
});
