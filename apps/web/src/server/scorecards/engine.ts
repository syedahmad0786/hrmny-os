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

function freshnessFrom(iso: string, now = Date.now()): number {
  const ageDays = (now - Date.parse(iso)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return 0;
  return clamp01(1 - ageDays / FRESHNESS_WINDOW_DAYS);
}

export const LEAD_FIT_V1: ScorecardDefinition = {
  scorecardDefinitionId: "b0af0000-0000-4000-8000-000000000002",
  key: "lead-fit-v1",
  entityKind: "lead",
  version: 1,
  weights: [
    { key: "email_verified", label: "Email verified", weight: 0.4 },
    { key: "has_company", label: "Company linked", weight: 0.3 },
    { key: "temperature", label: "Temperature", weight: 0.3 },
  ],
  active: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

export const CLIENT_HEALTH_V1: ScorecardDefinition = {
  scorecardDefinitionId: "b0af0000-0000-4000-8000-000000000003",
  key: "client-health-v1",
  entityKind: "client",
  version: 1,
  weights: [
    { key: "active", label: "Active lifecycle", weight: 0.5 },
    { key: "engagement", label: "Retainer engagement", weight: 0.3 },
    { key: "contract", label: "Contracted fee", weight: 0.2 },
  ],
  active: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

export const CAMPAIGN_DELIVERY_V1: ScorecardDefinition = {
  scorecardDefinitionId: "b0af0000-0000-4000-8000-000000000004",
  key: "campaign-delivery-v1",
  entityKind: "campaign",
  version: 1,
  weights: [
    { key: "progress", label: "Status progress", weight: 0.5 },
    { key: "scheduled", label: "Scheduled", weight: 0.25 },
    { key: "client_linked", label: "Client linked", weight: 0.25 },
  ],
  active: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

export const VENDOR_PROFILE_V1: ScorecardDefinition = {
  scorecardDefinitionId: "b0af0000-0000-4000-8000-000000000005",
  key: "vendor-profile-v1",
  entityKind: "vendor",
  version: 1,
  weights: [
    { key: "identified", label: "Named vendor", weight: 0.4 },
    { key: "web_presence", label: "Website", weight: 0.3 },
    { key: "notes", label: "Notes on file", weight: 0.3 },
  ],
  active: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

export const SYSTEM_HEALTH_V1: ScorecardDefinition = {
  scorecardDefinitionId: "b0af0000-0000-4000-8000-000000000006",
  key: "system-health-v1",
  entityKind: "system_health",
  version: 1,
  weights: [
    { key: "xero_write_lock", label: "Xero write lock", weight: 0.4 },
    { key: "llm_safe_default", label: "LLM default mock-safe", weight: 0.3 },
    { key: "dam_safe_default", label: "DAM default memory-safe", weight: 0.3 },
  ],
  active: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

export const SEEDED_DEFINITIONS: ScorecardDefinition[] = [
  DEAL_BUAF_V1,
  LEAD_FIT_V1,
  CLIENT_HEALTH_V1,
  CAMPAIGN_DELIVERY_V1,
  VENDOR_PROFILE_V1,
  SYSTEM_HEALTH_V1,
];

function temperatureValue(temp: DealRow["buafTemperature"]): number {
  if (temp === "hot") return 1;
  if (temp === "warm") return 0.66;
  if (temp === "cool") return 0.33;
  return 0;
}

export function leadFitEvidence(deal: DealRow, now = Date.now()): Evidence[] {
  const fresh = freshnessFrom(deal.updatedAt, now);
  return [
    {
      factor: "email_verified",
      value: deal.emailVerified ? 1 : 0,
      ref: `deal:${deal.dealId}:emailVerified`,
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "has_company",
      value: deal.companyId ? 1 : 0,
      ref: `deal:${deal.dealId}:companyId`,
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "temperature",
      value: temperatureValue(deal.buafTemperature),
      ref: `deal:${deal.dealId}:buafTemperature`,
      freshness: fresh,
      confidence: deal.buafTemperature ? 1 : 0,
    },
  ];
}

export function clientHealthEvidence(input: {
  clientId: string;
  lifecycleStatus: string;
  engagementType: string;
  fee?: string | null;
  contractValue?: string | null;
  updatedAt?: string;
}): Evidence[] {
  const fresh = freshnessFrom(input.updatedAt ?? new Date().toISOString());
  const fee = Number(input.fee || input.contractValue || 0);
  return [
    {
      factor: "active",
      value: input.lifecycleStatus === "active" ? 1 : 0,
      ref: `client:${input.clientId}:lifecycleStatus`,
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "engagement",
      value:
        input.lifecycleStatus === "churned"
          ? 0
          : input.engagementType === "retainer"
            ? 1
            : 0.5,
      ref: `client:${input.clientId}:engagementType`,
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "contract",
      value: fee > 0 ? 1 : 0,
      ref: `client:${input.clientId}:fee`,
      freshness: fresh,
      confidence: 1,
    },
  ];
}

export function campaignDeliveryEvidence(input: {
  campaignItemId: string;
  status: string;
  scheduledFor: string | null;
  clientId: string | null;
  updatedAt?: string;
}): Evidence[] {
  const fresh = freshnessFrom(input.updatedAt ?? new Date().toISOString());
  const progress =
    input.status === "published"
      ? 1
      : input.status === "approved"
        ? 0.75
        : input.status === "draft"
          ? 0.25
          : 0.1;
  return [
    {
      factor: "progress",
      value: progress,
      ref: `campaign:${input.campaignItemId}:status`,
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "scheduled",
      value: input.scheduledFor ? 1 : 0,
      ref: `campaign:${input.campaignItemId}:scheduledFor`,
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "client_linked",
      value: input.clientId ? 1 : 0,
      ref: `campaign:${input.campaignItemId}:clientId`,
      freshness: fresh,
      confidence: 1,
    },
  ];
}

export function vendorProfileEvidence(input: {
  companyId: string;
  name: string;
  website: string | null;
  notes: string | null;
  updatedAt?: string;
}): Evidence[] {
  const fresh = freshnessFrom(input.updatedAt ?? new Date().toISOString());
  return [
    {
      factor: "identified",
      value: input.name.trim() ? 1 : 0,
      ref: `company:${input.companyId}:name`,
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "web_presence",
      value: input.website ? 1 : 0,
      ref: `company:${input.companyId}:website`,
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "notes",
      value: input.notes ? 1 : 0,
      ref: `company:${input.companyId}:notes`,
      freshness: fresh,
      confidence: 1,
    },
  ];
}

export function systemHealthEvidence(now = Date.now()): Evidence[] {
  const fresh = 1;
  void now;
  return [
    {
      factor: "xero_write_lock",
      value: process.env.XERO_WRITE_ENABLED?.toLowerCase() === "true" ? 0 : 1,
      ref: "env:XERO_WRITE_ENABLED",
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "llm_safe_default",
      value: (process.env.LLM_PROVIDER ?? "mock").toLowerCase() === "mock" ? 1 : 0.5,
      ref: "env:LLM_PROVIDER",
      freshness: fresh,
      confidence: 1,
    },
    {
      factor: "dam_safe_default",
      value: (process.env.DAM_STORAGE ?? "memory").toLowerCase() === "memory" ? 1 : 0.5,
      ref: "env:DAM_STORAGE",
      freshness: fresh,
      confidence: 1,
    },
  ];
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
