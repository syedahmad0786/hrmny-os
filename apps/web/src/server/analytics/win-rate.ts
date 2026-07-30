/**
 * M10 win-rate model — pure function over closed deal history.
 * ponytail: data-driven feature-lift heuristic (per-feature win-rate delta),
 * not a trained model — no training pipeline, no feature store. Upgrade to a
 * fitted logistic regression only if accuracy demands it (MASTER-PLAN-V2 M10).
 */

/** Minimal deal shape the model reads — DealRow satisfies this structurally. */
export type WinRateDeal = {
  closeOutcome: "won" | "lost" | "postponed_on_hold" | null;
  buafBudget: boolean | null;
  buafUrgency: boolean | null;
  buafAccess: boolean | null;
  buafFit: boolean | null;
  buafTemperature: "hot" | "warm" | "cool" | "cold" | string | null;
  emailVerified: boolean;
  /** Close/last-touch time, ISO — used for the rolling window. */
  updatedAt: string;
};

export type WinRateFactor = { feature: string; weight: number };

export type WinRateResult = {
  windowMonths: number;
  dealsClosed: number;
  dealsWon: number;
  winRate: number;
  topFactors: WinRateFactor[];
};

/** Binary BUAF + signal features. `null` = unknown, excluded from that feature's lift. */
const FEATURES: Array<{ feature: string; test: (d: WinRateDeal) => boolean | null }> = [
  { feature: "buaf_budget", test: (d) => d.buafBudget },
  { feature: "buaf_urgency", test: (d) => d.buafUrgency },
  { feature: "buaf_access", test: (d) => d.buafAccess },
  { feature: "buaf_fit", test: (d) => d.buafFit },
  {
    feature: "buaf_temperature_warm_plus",
    test: (d) =>
      d.buafTemperature == null
        ? null
        : d.buafTemperature === "hot" || d.buafTemperature === "warm",
  },
  { feature: "verified_email", test: (d) => d.emailVerified },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * Win rate + the features that most shift it, over deals closed in the window.
 * Each factor weight is P(won | feature) − P(won | ¬feature); a feature is only
 * scored when both groups are non-empty (otherwise its lift is unmeasurable).
 */
export function computeWinRate(
  deals: WinRateDeal[],
  opts: { windowMonths: number; now?: Date },
): WinRateResult {
  const now = opts.now ?? new Date();
  const cutoff = monthsAgo(now, opts.windowMonths).toISOString();

  const closed = deals.filter(
    (d) => d.closeOutcome != null && d.updatedAt >= cutoff,
  );
  const dealsClosed = closed.length;
  const dealsWon = closed.filter((d) => d.closeOutcome === "won").length;
  const winRate = dealsClosed === 0 ? 0 : round2(dealsWon / dealsClosed);

  const factors: WinRateFactor[] = [];
  for (const { feature, test } of FEATURES) {
    const withF = closed.filter((d) => test(d) === true);
    const withoutF = closed.filter((d) => test(d) === false);
    if (withF.length === 0 || withoutF.length === 0) continue; // unmeasurable
    const pWith = withF.filter((d) => d.closeOutcome === "won").length / withF.length;
    const pWithout =
      withoutF.filter((d) => d.closeOutcome === "won").length / withoutF.length;
    factors.push({ feature, weight: round2(pWith - pWithout) });
  }
  factors.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  return {
    windowMonths: opts.windowMonths,
    dealsClosed,
    dealsWon,
    winRate,
    topFactors: factors.slice(0, 3),
  };
}
