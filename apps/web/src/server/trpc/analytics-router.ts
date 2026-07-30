import { z } from "zod";
import { runAgent } from "@hrmny/ai";
import { router, staffProcedure } from "./trpc";
import { listDeals } from "../crm/repository";
import { getDemoStore } from "../demo-store";
import { getDemoWork } from "./work-management-router";
import { computeWinRate } from "../analytics/win-rate";
import { scoreChurn, type ChurnActivity } from "../analytics/churn";
import { forecastCapacity } from "../analytics/capacity";
import { assembleWeeklyReport } from "../analytics/report";

/**
 * M10 analytics & scoring v2 — READ-ONLY by contract: every procedure is a query
 * over existing m3/m5/work data; this router never writes a domain table, runs no
 * migration, and adds no mutation. Signatures are frozen (the #5 UI depends on
 * them); only the values are computed. Heuristics + LLM narrative, no ML infra.
 */

type DemoStore = ReturnType<typeof getDemoStore>;

/** Active client margin average as a 0–1 fraction (marginPct is a percent string). */
function portfolioMargin(store: DemoStore): number | null {
  const rows = store.computeClientMargins();
  if (rows.length === 0) return null;
  const sum = rows.reduce((s, r) => s + Number(r.marginPct) / 100, 0);
  return sum / rows.length;
}

/** Approved-deliverable / client-facing activity events for the churn signal. */
function deliverableEvents(store: DemoStore): ChurnActivity[] {
  const events: ChurnActivity[] = [];
  for (const d of store.clientDeliveryStatus.values())
    events.push({ clientId: d.clientId, approvedAt: d.updatedAt });
  for (const p of store.portalApprovals.values())
    if (p.status === "approved")
      events.push({ clientId: p.clientId, approvedAt: p.createdAt });
  return events;
}

function activeClients(store: DemoStore) {
  return [...store.clients.values()].filter(
    (c) => c.lifecycleStatus === "active",
  );
}

export const analyticsRouter = router({
  /** Win-rate model over deal history (BUAF features → close probability). */
  winRate: staffProcedure
    .input(z.object({ sinceMonths: z.number().min(1).max(24).default(6) }).optional())
    .query(async ({ input }) => {
      const windowMonths = input?.sinceMonths ?? 6;
      const deals = await listDeals();
      return computeWinRate(deals, { windowMonths });
    }),

  /** Churn signals from client activity (recency/volume of approved deliverables). */
  churnRisk: staffProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(({ input }) => {
      const store = getDemoStore();
      return scoreChurn({
        clients: activeClients(store),
        deliverables: deliverableEvents(store),
        limit: input?.limit ?? 20,
      });
    }),

  /** Capacity forecast from Work assignments (work-planning data). */
  capacityForecast: staffProcedure
    .input(z.object({ weeks: z.number().min(1).max(12).default(4) }).optional())
    .query(({ input }) => {
      const items = [...getDemoWork().items.values()];
      return forecastCapacity({ items, weeks: input?.weeks ?? 4 });
    }),

  /** Unattended weekly agency report — LLM-written narrative over the above. */
  weeklyReport: staffProcedure
    .input(z.object({ weekOf: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const weekOf = input?.weekOf ?? new Date().toISOString().slice(0, 10);
      const store = getDemoStore();

      const deals = await listDeals();
      const win = computeWinRate(deals, { windowMonths: 6 });
      const openDeals = deals.filter((d) => d.closeOutcome == null);
      const weightedValue = openDeals.reduce(
        (sum, d) => sum + Number(d.quoteValue ?? 0) * win.winRate,
        0,
      );

      const churn = scoreChurn({
        clients: activeClients(store),
        deliverables: deliverableEvents(store),
        limit: 100,
      });
      const capacity = forecastCapacity({
        items: [...getDemoWork().items.values()],
        weeks: 4,
      });

      return assembleWeeklyReport(
        {
          weekOf,
          pipeline: {
            open: openDeals.length,
            weightedValueAed: weightedValue.toFixed(2),
          },
          capacityUtilizationPct: capacity.utilizationPct,
          churnRiskCount: churn.filter((c) => c.risk >= 0.5).length,
          churnTop: churn.slice(0, 3).map((c) => ({ name: c.name, risk: c.risk })),
          portfolioMarginPct: portfolioMargin(store),
        },
        runAgent,
      );
    }),
});
