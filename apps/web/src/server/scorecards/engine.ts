import type { DealRow } from "../crm/types";

/**
 * Explainable ratings — pure scoring core (no I/O, no DB). A definition owns
 * weighted factors; compute() turns a definition + evidence into a 0–100
 * snapshot with a per-factor breakdown (weight, evidence refs, freshness,
 * confidence). Persistence + tRPC live in ./store and ../trpc/scorecards-router.
 *
 * HARD RULE (PLAN-PRODUCTION "Explainable ratings"): AI never rates employee /
 * person performance. assertScorableKind() is the single enforcement point —
 * both definition creation and compute() route through it.
 */

export const SCORECARD_ENTITY_KINDS = [
  "lead",
  "deal",
  "client",
  "campaign",
  "vendor",
  "system_health",
] as const;

export type ScorecardEntityKind = (typeof SCORECARD_ENTITY_KINDS)[number];

/** Kinds that would rate a person — explicitly refused for a clear error. */
const FORBIDDEN_ENTITY_KINDS = [
  "employee",
  "person",
  "people",
  "staff",
  "individual",
  "performance",
  "user",
];

export function assertScorableKind(
  kind: string,
): asserts kind is ScorecardEntityKind {
  const k = kind.toLowerCase();
  if (FORBIDDEN_ENTITY_KINDS.includes(k)) {
    throw new Error(
      `Scorecards must not rate people: entity kind "${kind}" is forbidden`,
    );
  }
  if (!SCORECARD_ENTITY_KINDS.includes(k as ScorecardEntityKind)) {
    throw new Error(`Unknown scorecard entity kind: ${kind}`);
  }
}

export type ScorecardFactor = {
  key: string;
  label?: string;
  /** 0..1; factor weights must sum to 1 across a definition. */
  weight: number;
};

export type ScorecardDefinition = {
  scorecardDefinitionId: string;
  key: string;
  entityKind: ScorecardEntityKind;
  version: number;
  weights: ScorecardFactor[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Evidence = {
  /** Matches a factor key in the definition. */
  factor: string;
  /** Normalized factor sub-score, 0..1. */
  value: number;
  /** Where this came from, e.g. "deal:buafBudget". */
  ref?: string;
  /** 0..1, 1 = just observed. */
  freshness?: number;
  /** 0..1, 1 = certain. */
  confidence?: number;
};

export type FactorBreakdown = {
  factor: string;
  label: string;
  weight: number;
  value: number;
  /** weight * value * 100 — this factor's points toward the 0–100 score. */
  contribution: number;
  evidence: string[];
  freshness: number;
  confidence: number;
};

export type ScorecardSnapshot = {
  definitionKey: string;
  version: number;
  entityKind: ScorecardEntityKind;
  entityId: string;
  score: number;
  breakdown: {
    factors: FactorBreakdown[];
    freshness: number;
    confidence: number;
  };
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Trust-boundary validation for a definition's factor weights. */
export function validateWeights(weights: ScorecardFactor[]): void {
  if (!weights.length) throw new Error("Scorecard needs at least one factor");
  const seen = new Set<string>();
  let sum = 0;
  for (const f of weights) {
    if (!f.key) throw new Error("Factor key required");
    if (seen.has(f.key)) throw new Error(`Duplicate factor: ${f.key}`);
    seen.add(f.key);
    if (!(f.weight >= 0 && f.weight <= 1)) {
      throw new Error(`Weight out of range for ${f.key}: ${f.weight}`);
    }
    sum += f.weight;
  }
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`Factor weights must sum to 1 (got ${sum})`);
  }
}

/**
 * Deterministic: score depends only on weights and evidence values, never on
 * freshness/confidence (those annotate the breakdown, they don't move the
 * score). A factor with no matching evidence scores 0 at confidence 0.
 */
export function compute(
  definition: ScorecardDefinition,
  entityId: string,
  evidence: Evidence[],
): ScorecardSnapshot {
  assertScorableKind(definition.entityKind);
  validateWeights(definition.weights);

  const byFactor = new Map<string, Evidence[]>();
  for (const e of evidence) {
    const list = byFactor.get(e.factor) ?? [];
    list.push(e);
    byFactor.set(e.factor, list);
  }

  const factors: FactorBreakdown[] = definition.weights.map((f) => {
    const rows = byFactor.get(f.key) ?? [];
    // Multiple evidence rows for one factor → average their values.
    const value = rows.length
      ? clamp01(rows.reduce((s, e) => s + clamp01(e.value), 0) / rows.length)
      : 0;
    const freshness = rows.length
      ? rows.reduce((s, e) => s + clamp01(e.freshness ?? 1), 0) / rows.length
      : 0;
    const confidence = rows.length
      ? rows.reduce((s, e) => s + clamp01(e.confidence ?? 1), 0) / rows.length
      : 0;
    return {
      factor: f.key,
      label: f.label ?? f.key,
      weight: f.weight,
      value,
      contribution: f.weight * value * 100,
      evidence: rows.map((e) => e.ref).filter((r): r is string => !!r),
      freshness,
      confidence,
    };
  });

  const score = Math.round(
    clamp01(factors.reduce((s, f) => s + f.contribution / 100, 0)) * 100,
  );
  // Overall freshness/confidence: weighted by factor weight (sums to 1).
  const freshness = factors.reduce((s, f) => s + f.weight * f.freshness, 0);
  const confidence = factors.reduce((s, f) => s + f.weight * f.confidence, 0);

  return {
    definitionKey: definition.key,
    version: definition.version,
    entityKind: definition.entityKind,
    entityId,
    score,
    breakdown: {
      factors,
      freshness: Math.round(freshness * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
    },
  };
}

// ── BUAF wiring: the first consumer ────────────────────────

/**
 * Seed definition mapping the deal's existing BUAF fields (Budget, Urgency,
 * Access, Fit) to equal weights. Used as the fallback active definition so
 * scoring works in both memory and DB mode before any admin edit lands.
 */
export const DEAL_BUAF_V1: ScorecardDefinition = {
  scorecardDefinitionId: "b0af0000-0000-4000-8000-000000000001",
  key: "deal-buaf-v1",
  entityKind: "deal",
  version: 1,
  weights: [
    { key: "budget", label: "Budget", weight: 0.25 },
    { key: "urgency", label: "Urgency", weight: 0.25 },
    { key: "access", label: "Access", weight: 0.25 },
    { key: "fit", label: "Fit", weight: 0.25 },
  ],
  active: true,
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
};

// ponytail: linear freshness decay over 30 days — a calibration knob, not a
// physical constant. Tune the window (or swap to exponential) once real deal
// churn cadence is known.
const FRESHNESS_WINDOW_DAYS = 30;

function freshnessFrom(iso: string, now: number): number {
  const ageDays = (now - Date.parse(iso)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return 0;
  return clamp01(1 - ageDays / FRESHNESS_WINDOW_DAYS);
}

/**
 * Map a deal's BUAF fields to evidence. A null field is unknown: value 0 at
 * confidence 0 (not a confident "no"). A set field is confidence 1.
 */
export function dealBuafEvidence(deal: DealRow, now = Date.now()): Evidence[] {
  const fresh = freshnessFrom(deal.updatedAt, now);
  const of = (
    factor: string,
    field: keyof DealRow,
    flag: boolean | null,
  ): Evidence => ({
    factor,
    value: flag === true ? 1 : 0,
    ref: `deal:${String(field)}`,
    freshness: fresh,
    confidence: flag === null ? 0 : 1,
  });
  return [
    of("budget", "buafBudget", deal.buafBudget),
    of("urgency", "buafUrgency", deal.buafUrgency),
    of("access", "buafAccess", deal.buafAccess),
    of("fit", "buafFit", deal.buafFit),
  ];
}
