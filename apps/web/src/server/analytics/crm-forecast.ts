/**
 * W10 CRM forecast & reporting — pure functions over deal/activity history.
 * ponytail: heuristic stage-probability weighting + trailing run-rate, not a
 * fitted model — upgrade to per-stage historical win probability when there is
 * enough closed history to estimate one.
 *
 * Margin semantics: every computation here reads quoteValue ONLY. internalCost
 * and marginPct are never read, so outputs are safe for non-margin roles by
 * construction (same contract redactDealMargin enforces on row responses).
 */
import { CRM_PIPELINE_STAGES, type CrmPipelineStage } from "@hrmny/db";

/** Minimal deal shape read here — DealRow satisfies this structurally. */
export type ForecastDeal = {
  stage: CrmPipelineStage | string;
  closeOutcome: "won" | "lost" | "postponed_on_hold" | null;
  lostReason: string | null;
  quoteValue: string | null;
  updatedAt: string;
};

/** stage_change audit-trail event (activity.metadata from moveDealStage). */
export type StageChangeEvent = { from: string; to: string };

/**
 * Stage → probability-of-eventual-win weights used for weighted pipeline value.
 * Heuristic ladder: roughly doubles through qualification, then converges as a
 * deal survives pricing; handover_pack is post-close (already won) so 1.0.
 */
export const STAGE_PROBABILITY: Record<CrmPipelineStage, number> = {
  discover: 0.05,
  qualify: 0.1,
  engage: 0.2,
  scope: 0.35,
  propose: 0.55,
  price_cost: 0.7,
  close: 0.9,
  handover_pack: 1.0,
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const value = (d: ForecastDeal) => Number(d.quoteValue ?? 0) || 0;
const isOpen = (d: ForecastDeal) => d.closeOutcome == null;

function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 864e5).toISOString();
}

// ── 1. pipeline ────────────────────────────────────────────

export type PipelineStageSummary = {
  stage: CrmPipelineStage;
  probability: number;
  count: number;
  totalValue: number;
  weightedValue: number;
};

/** Per-stage open-deal summary. weightedValue = Σ quoteValue × stage weight. */
export function computePipeline(deals: ForecastDeal[]): {
  stages: PipelineStageSummary[];
  totals: { count: number; totalValue: number; weightedValue: number };
} {
  const open = deals.filter(isOpen);
  const stages = CRM_PIPELINE_STAGES.map((stage) => {
    const rows = open.filter((d) => d.stage === stage);
    const totalValue = rows.reduce((s, d) => s + value(d), 0);
    return {
      stage,
      probability: STAGE_PROBABILITY[stage],
      count: rows.length,
      totalValue: round2(totalValue),
      weightedValue: round2(totalValue * STAGE_PROBABILITY[stage]),
    };
  });
  return {
    stages,
    totals: {
      count: stages.reduce((s, x) => s + x.count, 0),
      totalValue: round2(stages.reduce((s, x) => s + x.totalValue, 0)),
      weightedValue: round2(stages.reduce((s, x) => s + x.weightedValue, 0)),
    },
  };
}

// ── 2. forecast ────────────────────────────────────────────

export type ForecastResult = {
  horizonDays: number;
  /** Probability-weighted open pipeline value (quoteValue only). */
  weightedPipelineValue: number;
  /** Won deals inside the trailing window of the same length as the horizon. */
  wonInWindow: { count: number; value: number };
  /** Trailing won value per day. */
  runRatePerDay: number;
  /** runRatePerDay × horizonDays — what the current pace closes by itself. */
  runRateProjection: number;
};

/** Weighted pipeline + won-run-rate projection over the horizon. */
export function computeForecast(
  deals: ForecastDeal[],
  opts?: { horizonDays?: number; now?: Date },
): ForecastResult {
  const horizonDays = opts?.horizonDays ?? 90;
  const now = opts?.now ?? new Date();
  const cutoff = daysAgoIso(now, horizonDays);

  const won = deals.filter(
    (d) => d.closeOutcome === "won" && d.updatedAt >= cutoff,
  );
  const wonValue = won.reduce((s, d) => s + value(d), 0);
  const runRatePerDay = wonValue / horizonDays;

  return {
    horizonDays,
    weightedPipelineValue: computePipeline(deals).totals.weightedValue,
    wonInWindow: { count: won.length, value: round2(wonValue) },
    runRatePerDay: round2(runRatePerDay),
    runRateProjection: round2(runRatePerDay * horizonDays),
  };
}

// ── 3. win / loss ──────────────────────────────────────────

export type WinLossResult = {
  sinceDays: number;
  won: number;
  lost: number;
  winRate: number;
  topLostReasons: Array<{ reason: string; count: number }>;
};

/** Won/lost over the trailing window + top lost reasons (postponed excluded). */
export function computeWinLoss(
  deals: ForecastDeal[],
  opts?: { sinceDays?: number; now?: Date },
): WinLossResult {
  const sinceDays = opts?.sinceDays ?? 90;
  const now = opts?.now ?? new Date();
  const cutoff = daysAgoIso(now, sinceDays);

  const closed = deals.filter(
    (d) =>
      (d.closeOutcome === "won" || d.closeOutcome === "lost") &&
      d.updatedAt >= cutoff,
  );
  const won = closed.filter((d) => d.closeOutcome === "won").length;
  const lost = closed.length - won;

  const reasons = new Map<string, number>();
  for (const d of closed) {
    if (d.closeOutcome === "lost" && d.lostReason) {
      reasons.set(d.lostReason, (reasons.get(d.lostReason) ?? 0) + 1);
    }
  }
  const topLostReasons = [...reasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 5);

  return {
    sinceDays,
    won,
    lost,
    winRate: closed.length === 0 ? 0 : round2(won / closed.length),
    topLostReasons,
  };
}

// ── 4. stage conversion ────────────────────────────────────

export type StageConversionRow = {
  stage: CrmPipelineStage;
  /** audit_trail: transitions leaving the stage. stage_distribution: deals at-or-beyond it. */
  entered: number;
  /** audit_trail: transitions to a later stage. stage_distribution: deals at-or-beyond the next stage. */
  advanced: number;
  /** advanced / entered, or null when entered = 0 (unmeasurable). */
  rate: number | null;
};

export type StageConversionResult = {
  method: "audit_trail" | "stage_distribution";
  stages: StageConversionRow[];
};

const stageIndex = (s: string) =>
  CRM_PIPELINE_STAGES.indexOf(s as CrmPipelineStage);

/**
 * Historical stage→stage conversion.
 * Primary method: stage_change activities (moveDealStage audit trail) — per
 * stage, fraction of observed exits that advanced to a later stage.
 * Fallback (no trail yet): survival over the current stage distribution —
 * deals at-or-beyond stage i+1 / deals at-or-beyond stage i.
 */
export function computeStageConversion(
  deals: ForecastDeal[],
  stageChanges: StageChangeEvent[],
): StageConversionResult {
  const valid = stageChanges.filter(
    (e) => stageIndex(e.from) >= 0 && stageIndex(e.to) >= 0,
  );

  if (valid.length > 0) {
    const stages = CRM_PIPELINE_STAGES.map((stage) => {
      const exits = valid.filter((e) => e.from === stage);
      const advanced = exits.filter(
        (e) => stageIndex(e.to) > stageIndex(e.from),
      ).length;
      return {
        stage,
        entered: exits.length,
        advanced,
        rate: exits.length === 0 ? null : round2(advanced / exits.length),
      };
    });
    return { method: "audit_trail", stages };
  }

  // Fallback: current distribution survival. Won deals count as beyond every
  // stage; lost/postponed deals count at their resting stage.
  const atOrBeyond = (i: number) =>
    deals.filter(
      (d) => d.closeOutcome === "won" || stageIndex(String(d.stage)) >= i,
    ).length;
  const stages = CRM_PIPELINE_STAGES.map((stage, i) => {
    const entered = atOrBeyond(i);
    const advanced = i + 1 < CRM_PIPELINE_STAGES.length ? atOrBeyond(i + 1) : entered;
    return {
      stage,
      entered,
      advanced,
      rate: entered === 0 ? null : round2(advanced / entered),
    };
  });
  return { method: "stage_distribution", stages };
}
