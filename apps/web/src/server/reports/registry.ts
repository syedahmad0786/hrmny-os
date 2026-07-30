import { runAgent as defaultRunAgent, type RunAgent } from "@hrmny/ai";
import { listDeals } from "../crm/repository";
import { getDemoStore } from "../demo-store";
import { getDemoWork } from "../trpc/work-management-router";
import { computeWinRate } from "../analytics/win-rate";
import { scoreChurn, type ChurnActivity } from "../analytics/churn";
import { forecastCapacity, type CapacityResult } from "../analytics/capacity";
import { assembleWeeklyReport, type WeeklyReport } from "../analytics/report";
import { listCampaigns } from "../campaigns/repository";
import type { ReportArtifact, ReportKey } from "./types";

/**
 * Report registry: report_key → { gather, assemble }. `gather(deps)` pulls live
 * (demo-store when no DB) data and does any LLM work; `assemble(facts)` is a
 * pure, synchronous facts→artifact render so it is trivially testable on
 * planted facts. The scheduler runs gather then assemble. v1 reports reuse the
 * M10 analytics primitives — this module adds no new analytics.
 */

export type ReportDeps = {
  now?: Date;
  runAgent?: RunAgent;
};

export type ReportDef<F> = {
  key: ReportKey;
  title: string;
  gather: (deps: ReportDeps) => Promise<F>;
  assemble: (facts: F) => ReportArtifact;
};

const nowIso = (deps: ReportDeps) => (deps.now ?? new Date()).toISOString();
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

// Replicated from analytics-router (private helpers there) to keep this module
// isolated from the frozen M10 router — ~12 lines, not worth a shared export.
type DemoStore = ReturnType<typeof getDemoStore>;
function activeClients(store: DemoStore) {
  return [...store.clients.values()].filter(
    (c) => c.lifecycleStatus === "active",
  );
}
function deliverableEvents(store: DemoStore): ChurnActivity[] {
  const events: ChurnActivity[] = [];
  for (const d of store.clientDeliveryStatus.values())
    events.push({ clientId: d.clientId, approvedAt: d.updatedAt });
  for (const p of store.portalApprovals.values())
    if (p.status === "approved")
      events.push({ clientId: p.clientId, approvedAt: p.createdAt });
  return events;
}
function portfolioMargin(store: DemoStore): number | null {
  const rows = store.computeClientMargins();
  if (rows.length === 0) return null;
  return rows.reduce((s, r) => s + Number(r.marginPct) / 100, 0) / rows.length;
}

// ── weekly-agency ────────────────────────────────────────────

export const weeklyAgency: ReportDef<WeeklyReport> = {
  key: "weekly-agency",
  title: "Weekly Agency Report",
  async gather(deps) {
    const weekOf = nowIso(deps).slice(0, 10);
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
      deps.runAgent ?? defaultRunAgent,
    );
  },
  assemble(report) {
    return {
      title: `Weekly Agency Report — week of ${report.weekOf}`,
      generatedAt: new Date().toISOString(),
      sections: [
        { heading: "Narrative", lines: [report.narrative] },
        {
          heading: "Pipeline",
          lines: [
            `Open deals: ${report.pipeline.open}`,
            `Weighted value: AED ${report.pipeline.weightedValueAed}`,
          ],
        },
        {
          heading: "Delivery",
          lines: [
            `Capacity utilization: ${pct(report.capacityUtilizationPct)}`,
            `Clients at churn risk: ${report.churnRiskCount}`,
          ],
        },
      ],
    };
  },
};

// ── pipeline-summary ─────────────────────────────────────────

export type PipelineFacts = {
  generatedAt: string;
  openCount: number;
  totalOpenValueAed: string;
  weightedValueAed: string;
  winRatePct: number;
  dealsClosed: number;
  dealsWon: number;
};

export const pipelineSummary: ReportDef<PipelineFacts> = {
  key: "pipeline-summary",
  title: "Pipeline Summary",
  async gather(deps) {
    const deals = await listDeals();
    const win = computeWinRate(deals, { windowMonths: 6 });
    const open = deals.filter((d) => d.closeOutcome == null);
    const totalOpen = open.reduce((s, d) => s + Number(d.quoteValue ?? 0), 0);
    return {
      generatedAt: nowIso(deps),
      openCount: open.length,
      totalOpenValueAed: totalOpen.toFixed(2),
      weightedValueAed: (totalOpen * win.winRate).toFixed(2),
      winRatePct: Math.round(win.winRate * 100),
      dealsClosed: win.dealsClosed,
      dealsWon: win.dealsWon,
    };
  },
  assemble(f) {
    return {
      title: "Pipeline Summary",
      generatedAt: f.generatedAt,
      sections: [
        {
          heading: "Open pipeline",
          lines: [
            `Open deals: ${f.openCount}`,
            `Total open value: AED ${f.totalOpenValueAed}`,
            `Win-weighted value: AED ${f.weightedValueAed}`,
          ],
        },
        {
          heading: "Conversion (trailing 6 months)",
          lines: [
            `Win rate: ${f.winRatePct}%`,
            `Deals closed: ${f.dealsClosed} (won ${f.dealsWon})`,
          ],
        },
      ],
    };
  },
};

// ── capacity-forecast ────────────────────────────────────────

export type CapacityFacts = { generatedAt: string; capacity: CapacityResult };

export const capacityForecast: ReportDef<CapacityFacts> = {
  key: "capacity-forecast",
  title: "Capacity Forecast",
  async gather(deps) {
    return {
      generatedAt: nowIso(deps),
      capacity: forecastCapacity({
        items: [...getDemoWork().items.values()],
        weeks: 4,
        now: deps.now,
      }),
    };
  },
  assemble(f) {
    const overbooked = f.capacity.overbookedRoles.length
      ? f.capacity.overbookedRoles.join(", ")
      : "None";
    return {
      title: `Capacity Forecast — next ${f.capacity.weeks} weeks`,
      generatedAt: f.generatedAt,
      sections: [
        {
          heading: "Utilization",
          lines: [
            `Assigned-team utilization: ${pct(f.capacity.utilizationPct)}`,
            f.capacity.note,
          ],
        },
        { heading: "Overbooked", lines: [overbooked] },
      ],
    };
  },
};

// ── campaign-summary ─────────────────────────────────────────

export type CampaignFacts = {
  generatedAt: string;
  total: number;
  byStatus: Record<string, number>;
  upcoming: Array<{ title: string; channel: string; scheduledFor: string }>;
};

export const campaignSummary: ReportDef<CampaignFacts> = {
  key: "campaign-summary",
  title: "Campaign Summary",
  async gather(deps) {
    const today = nowIso(deps).slice(0, 10);
    const rows = await listCampaigns();
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const upcoming = rows
      .filter((r) => r.scheduledFor && r.scheduledFor >= today)
      .sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""))
      .slice(0, 5)
      .map((r) => ({
        title: r.title,
        channel: r.channel,
        scheduledFor: r.scheduledFor ?? "",
      }));
    return { generatedAt: nowIso(deps), total: rows.length, byStatus, upcoming };
  },
  assemble(f) {
    const statusLines = Object.entries(f.byStatus).map(
      ([status, count]) => `${status}: ${count}`,
    );
    const upcomingLines = f.upcoming.map(
      (u) => `${u.scheduledFor} — ${u.title} (${u.channel})`,
    );
    return {
      title: "Campaign Summary",
      generatedAt: f.generatedAt,
      sections: [
        {
          heading: "By status",
          lines: [`Total campaigns: ${f.total}`, ...statusLines],
        },
        { heading: "Upcoming", lines: upcomingLines },
      ],
    };
  },
};

/**
 * Type-erased registry entry — combines a def's gather+assemble into one `run`
 * so the map is homogeneous. The generic `F` is closed over inside `erase`
 * where it is still concrete, avoiding the parameter-variance clash a
 * `Record<ReportKey, ReportDef<unknown>>` would hit.
 */
export type RegistryEntry = {
  key: ReportKey;
  title: string;
  run: (deps: ReportDeps) => Promise<ReportArtifact>;
};

function erase<F>(def: ReportDef<F>): RegistryEntry {
  return {
    key: def.key,
    title: def.title,
    run: async (deps) => def.assemble(await def.gather(deps)),
  };
}

export const REPORT_REGISTRY: Record<ReportKey, RegistryEntry> = {
  "weekly-agency": erase(weeklyAgency),
  "pipeline-summary": erase(pipelineSummary),
  "capacity-forecast": erase(capacityForecast),
  "campaign-summary": erase(campaignSummary),
};

export function getReportEntry(key: string): RegistryEntry | null {
  return (REPORT_REGISTRY as Record<string, RegistryEntry>)[key] ?? null;
}
