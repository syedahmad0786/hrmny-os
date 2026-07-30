import { describe, expect, it } from "vitest";
import { computeWinRate, type WinRateDeal } from "./win-rate";

const NOW = new Date("2026-07-30T00:00:00Z");
const RECENT = "2026-07-01T00:00:00Z";

/** Closed deal with only budget + email set; other features unknown (excluded). */
function deal(overrides: Partial<WinRateDeal>): WinRateDeal {
  return {
    closeOutcome: "lost",
    buafBudget: null,
    buafUrgency: null,
    buafAccess: null,
    buafFit: null,
    buafTemperature: null,
    emailVerified: false,
    updatedAt: RECENT,
    ...overrides,
  };
}

describe("computeWinRate", () => {
  it("computes win rate and per-feature lift from closed history", () => {
    // 8 closed deals. budget=true → 3/4 won; budget=false → 1/4 won (lift 0.5).
    // emailVerified aligned identically → lift 0.5 as well.
    const deals: WinRateDeal[] = [
      deal({ closeOutcome: "won", buafBudget: true, emailVerified: true }),
      deal({ closeOutcome: "won", buafBudget: true, emailVerified: true }),
      deal({ closeOutcome: "won", buafBudget: true, emailVerified: true }),
      deal({ closeOutcome: "lost", buafBudget: true, emailVerified: true }),
      deal({ closeOutcome: "won", buafBudget: false, emailVerified: false }),
      deal({ closeOutcome: "lost", buafBudget: false, emailVerified: false }),
      deal({ closeOutcome: "lost", buafBudget: false, emailVerified: false }),
      deal({ closeOutcome: "lost", buafBudget: false, emailVerified: false }),
    ];

    const res = computeWinRate(deals, { windowMonths: 6, now: NOW });

    expect(res.dealsClosed).toBe(8);
    expect(res.dealsWon).toBe(4);
    expect(res.winRate).toBe(0.5);
    // Both measurable features, tied at 0.5; FEATURES order breaks the tie.
    // No fabricated reply_intent factor (no data source for it).
    expect(res.topFactors).toEqual([
      { feature: "buaf_budget", weight: 0.5 },
      { feature: "verified_email", weight: 0.5 },
    ]);
  });

  it("keeps topFactors sorted by absolute weight, max 3", () => {
    const res = computeWinRate(
      [
        deal({ closeOutcome: "won", buafBudget: true, buafFit: true, emailVerified: true }),
        deal({ closeOutcome: "won", buafBudget: true, buafFit: false, emailVerified: false }),
        deal({ closeOutcome: "lost", buafBudget: false, buafFit: true, emailVerified: true }),
        deal({ closeOutcome: "lost", buafBudget: false, buafFit: false, emailVerified: false }),
      ],
      { windowMonths: 6, now: NOW },
    );
    expect(res.topFactors.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < res.topFactors.length; i++) {
      expect(Math.abs(res.topFactors[i - 1]!.weight)).toBeGreaterThanOrEqual(
        Math.abs(res.topFactors[i]!.weight),
      );
    }
  });

  it("excludes deals closed before the window", () => {
    const deals: WinRateDeal[] = [
      deal({ closeOutcome: "won", buafBudget: true, updatedAt: "2025-01-01T00:00:00Z" }),
      deal({ closeOutcome: "lost", buafBudget: false, updatedAt: RECENT }),
    ];
    const res = computeWinRate(deals, { windowMonths: 6, now: NOW });
    expect(res.dealsClosed).toBe(1);
    expect(res.dealsWon).toBe(0);
  });

  it("ignores open deals (no close outcome)", () => {
    const deals: WinRateDeal[] = [
      deal({ closeOutcome: "won", buafBudget: true }),
      deal({ closeOutcome: null, buafBudget: true }),
    ];
    const res = computeWinRate(deals, { windowMonths: 6, now: NOW });
    expect(res.dealsClosed).toBe(1);
  });

  it("returns zeros and no factors with no closed deals", () => {
    const res = computeWinRate([], { windowMonths: 6, now: NOW });
    expect(res).toEqual({
      windowMonths: 6,
      dealsClosed: 0,
      dealsWon: 0,
      winRate: 0,
      topFactors: [],
    });
  });
});
