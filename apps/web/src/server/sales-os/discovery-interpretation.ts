import {
  createProvider,
  MODEL_PRICES_AED,
  OPENROUTER_FREE_PREVIEW_MODELS,
  withMetering,
  type CostEvent,
  type LLMProvider,
  type LLMProviderName,
} from "@hrmny/ai";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import {
  classifyDiscoveryDisposition,
  discoveryIdentityKey,
  DISCOVERY_DISPOSITIONS,
  DISCOVERY_EVIDENCE_ROUTES,
  isClaimGroundedInExcerpt,
  parseDiscoveryEventDate,
  type DiscoveryDisposition,
  type DiscoveryEvidenceRoute,
} from "./discovery-evidence";

export const discoveryInterpretationClaimSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["fact", "interpretation"]),
  text: z.string().min(1).max(500),
  evidenceId: z.string().min(1).max(80),
  grounded: z.boolean(),
  disposition: z.enum(DISCOVERY_DISPOSITIONS),
});

export const discoveryCompanyIdentitySchema = z.object({
  name: z.string().max(180).nullable(),
  domain: z.string().max(180).nullable(),
  ambiguous: z.boolean(),
});

export const discoveryInterpretationResultSchema = z.object({
  claims: z.array(discoveryInterpretationClaimSchema).max(8),
  relevantService: z.string().max(180).nullable(),
  opportunityKind: z.string().max(80).nullable(),
  awardedAppointment: z.boolean(),
  unsupported: z.boolean(),
  companyIdentity: discoveryCompanyIdentitySchema.optional(),
});

export const discoveryInterpretationPacketSchema = z.object({
  schemaVersion: z.literal(1),
  route: z.enum(DISCOVERY_EVIDENCE_ROUTES),
  identity: z.object({
    companyName: z.string(),
    host: z.string().nullable(),
  }),
  opportunityKind: z.string(),
  eventDate: z.string().nullable(),
  excerpt: z.string().max(2_000),
  evidenceId: z.string(),
});

export type DiscoveryInterpretationProviderName =
  | LLMProviderName
  | "unavailable";

export type DiscoveryInterpretationStatus =
  | "completed"
  | "skipped_private"
  | "unavailable"
  | "malformed";

export type DiscoveryEvidenceEvaluation = {
  disposition: DiscoveryDisposition;
  reviewState: "needs_review" | "needs_evidence" | "parked";
  reasons: string[];
  identity: { companyName: string; host: string | null };
  eventDate: string | null;
  facts: Array<{ id: string; text: string }>;
  interpretations: Array<{ id: string; text: string; grounded: boolean }>;
  packet: {
    schemaVersion: 1;
    provider: DiscoveryInterpretationProviderName;
    model: string | null;
    interpretationStatus: DiscoveryInterpretationStatus;
    webSearch: false;
    privateContext: false;
    excerptIncluded: boolean;
    route: DiscoveryEvidenceRoute;
  };
};

export type DiscoveryCompanyIdentityResult =
  | {
      ok: true;
      name: string;
      domain?: string;
    }
  | {
      ok: false;
      reason:
        | "COMPANY_IDENTITY_MISSING"
        | "COMPANY_IDENTITY_AMBIGUOUS"
        | "INTERPRETATION_PROVIDER_UNAVAILABLE"
        | "INTERPRETATION_MALFORMED"
        | "DISCOVERY_PAID_ROUTE_REFUSED"
        | "DISCOVERY_MODEL_REQUIRED"
        | "DISCOVERY_LOCAL_INFERENCE_REFUSED"
        | "DISCOVERY_PRICE_PROOF_MISSING"
        | "DISCOVERY_METERING_REQUIRED";
    };

export const DISCOVERY_INTERPRETATION_BATCH_SIZE = 5;
export const DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB = 8;
export const DISCOVERY_INTERPRETATION_MAX_TOKENS_PER_JOB = 12_000;
export const DISCOVERY_INTERPRETATION_MAX_MS_PER_TICK = 20_000;
export const DISCOVERY_INTERPRETATION_CLAIM_MS = 90_000;
export const DISCOVERY_PRICE_PROOF_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
export const DISCOVERY_ZERO_PRICE = {
  prompt: 0,
  completion: 0,
  request: 0,
} as const;

const discoveryZeroPriceProofSchema = z.object({
  model: z.string().min(1).max(180),
  prompt: z.literal(0),
  completion: z.literal(0),
  request: z.literal(0),
  verifiedAt: z.string().datetime({ offset: true }),
  source: z.literal("openrouter_provider_catalog"),
});

export function discoveryEvidenceRoute(
  sourceKey: string | null | undefined,
): DiscoveryEvidenceRoute {
  if (sourceKey === "intent_import") return "import";
  if (sourceKey === "collector" || sourceKey === "automated") return "automated";
  return "manual";
}

export function markDuplicateEvaluation(
  evaluation: DiscoveryEvidenceEvaluation,
): DiscoveryEvidenceEvaluation {
  return {
    ...evaluation,
    disposition: "duplicate",
    reasons: [
      "An open candidate already holds this opportunity key",
      ...evaluation.reasons,
    ],
  };
}

export function redactHiddenEvaluation(
  evaluation: DiscoveryEvidenceEvaluation,
): DiscoveryEvidenceEvaluation {
  return {
    ...evaluation,
    interpretations: [],
    packet: {
      ...evaluation.packet,
      excerptIncluded: false,
      interpretationStatus: "skipped_private",
    },
  };
}

export function isCompanyNameGroundedInExcerpt(
  name: string,
  excerpt: string | null | undefined,
) {
  const normalized = name.trim().toLowerCase();
  const haystack = (excerpt ?? "").toLowerCase();
  if (normalized.length < 2 || !haystack.trim()) return false;
  if (haystack.includes(normalized)) return true;
  const tokens = normalized
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.every((token) => haystack.includes(token));
}

export function isPermittedDiscoveryInterpretationModel(model: string) {
  const value = model.trim();
  if (!value) return false;
  if (value.toLowerCase() === "openrouter/free") return false;
  return OPENROUTER_FREE_PREVIEW_MODELS.some(
    (item) => item.toLowerCase() === value.toLowerCase(),
  );
}

export function parseDiscoveryZeroPriceProof(
  raw: string | null | undefined,
  now = new Date(),
) {
  if (!raw?.trim()) return null;
  const parsed = discoveryZeroPriceProofSchema.safeParse(safeJson(raw));
  if (!parsed.success) return null;
  const verifiedAt = Date.parse(parsed.data.verifiedAt);
  if (Number.isNaN(verifiedAt) || verifiedAt > now.getTime()) return null;
  if (now.getTime() - verifiedAt > DISCOVERY_PRICE_PROOF_MAX_AGE_MS) return null;
  return parsed.data;
}

export function verifyDiscoveryZeroPriceRoute(
  model: string,
  proofRaw?: string | null,
  now?: Date,
): {
  ok: boolean;
  reason?: string;
} {
  if (!isPermittedDiscoveryInterpretationModel(model))
    return { ok: false, reason: "DISCOVERY_PAID_ROUTE_REFUSED" };
  const proof = parseDiscoveryZeroPriceProof(
    proofRaw ?? process.env.DISCOVERY_INTERPRETATION_PRICE_PROOF_JSON,
    now,
  );
  if (!proof) return { ok: false, reason: "DISCOVERY_PRICE_PROOF_MISSING" };
  if (proof.model !== model)
    return { ok: false, reason: "DISCOVERY_PAID_ROUTE_REFUSED" };
  const exact = MODEL_PRICES_AED[model];
  if (exact && (exact.inputPerMTokAed > 0 || exact.outputPerMTokAed > 0))
    return { ok: false, reason: "DISCOVERY_PAID_ROUTE_REFUSED" };
  return { ok: true };
}

export function resolveDiscoveryInterpretationRoute(input?: {
  enabled?: boolean;
  model?: string;
  providerName?: string | null;
  proofJson?: string | null;
  monthlyCapAed?: number | null;
  now?: Date;
}):
  | { status: "ready"; model: string }
  | { status: "unavailable"; reason: string } {
  const enabled =
    input?.enabled ?? process.env.DISCOVERY_INTERPRETATION_ENABLED === "true";
  if (!enabled)
    return {
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    };
  const model = (
    input?.model ??
    process.env.DISCOVERY_INTERPRETATION_MODEL ??
    ""
  ).trim();
  if (!model) return { status: "unavailable", reason: "DISCOVERY_MODEL_REQUIRED" };
  const providerName = (
    input?.providerName ??
    process.env.LLM_PROVIDER ??
    ""
  )
    .trim()
    .toLowerCase();
  if (providerName === "ollama")
    return {
      status: "unavailable",
      reason: "DISCOVERY_LOCAL_INFERENCE_REFUSED",
    };
  if (providerName === "anthropic")
    return { status: "unavailable", reason: "DISCOVERY_PAID_ROUTE_REFUSED" };
  if (providerName !== "openrouter")
    return {
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    };
  const priced = verifyDiscoveryZeroPriceRoute(model, input?.proofJson, input?.now);
  if (!priced.ok)
    return {
      status: "unavailable",
      reason: priced.reason ?? "DISCOVERY_PAID_ROUTE_REFUSED",
    };
  if (!process.env.OPENROUTER_API_KEY?.trim())
    return {
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
    };
  const cap =
    input?.monthlyCapAed ??
    Number(process.env.LLM_MONTHLY_CAP_AED?.trim() ?? "");
  if (!Number.isFinite(cap) || cap <= 0)
    return { status: "unavailable", reason: "DISCOVERY_METERING_REQUIRED" };
  return { status: "ready", model };
}

export async function discoveryMonthlySpendAed(): Promise<number> {
  const db = getDb();
  if (!db) throw new Error("DISCOVERY_METERING_REQUIRED");
  const [row] = await db.execute<{ spend: number }>(
    sql`select coalesce(sum(cost_aed), 0)::float8 as spend from public.agent_runs where created_at >= date_trunc('month', now())`,
  );
  return Number(row?.spend ?? 0);
}

export async function persistDiscoveryInterpretationCost(
  event: CostEvent,
  context?: {
    jobId: string;
    sourceKey: string;
    attemptGeneration: number;
  },
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("DISCOVERY_COST_RECEIPT_UNAVAILABLE");
  await db.execute(sql`
    insert into public.agent_runs (
      agent, model, input, output, tokens_in, tokens_out, cost_aed, gate_outcome
    ) values (
      ${event.agent ?? "research"},
      ${event.model},
      ${JSON.stringify({
        discovery: true,
        requestId: event.requestId ?? null,
        jobId: context?.jobId ?? null,
        sourceKey: context?.sourceKey ?? null,
        attemptGeneration: context?.attemptGeneration ?? null,
      })}::jsonb,
      ${JSON.stringify({ provider: event.provider })}::jsonb,
      ${event.inputTokens},
      ${event.outputTokens},
      ${event.costAed.toFixed(4)},
      ${"not_applicable"}
    )
  `);
}

export function createLiveDiscoveryInterpretationProvider(input: {
  model: string;
  onCost: (event: CostEvent) => void | Promise<void>;
  getMonthlySpendAed: () => number | Promise<number>;
  monthlyCapAed: number;
}): LLMProvider {
  if (!input.onCost || !input.getMonthlySpendAed)
    throw new Error("DISCOVERY_METERING_REQUIRED");
  if (!Number.isFinite(input.monthlyCapAed) || input.monthlyCapAed <= 0)
    throw new Error("DISCOVERY_METERING_REQUIRED");
  const priced = verifyDiscoveryZeroPriceRoute(input.model);
  if (!priced.ok) throw new Error(priced.reason ?? "DISCOVERY_PAID_ROUTE_REFUSED");
  const inner = createProvider({
    provider: "openrouter",
    defaultModel: input.model,
  });
  const pinned: LLMProvider = {
    name: inner.name,
    async generate(options) {
      return inner.generate({
        ...options,
        model: input.model,
        allowFreeFallback: false,
        allowPlugins: false,
        webSearch: false,
        maxPrice: DISCOVERY_ZERO_PRICE,
        task: "discovery_interpret",
      });
    },
  };
  return withMetering(pinned, {
    agent: "research",
    onCost: input.onCost,
    getMonthlySpendAed: input.getMonthlySpendAed,
    monthlyCapAed: input.monthlyCapAed,
  });
}

export async function interpretPublicDiscoveryExcerpt(input: {
  excerpt: string;
  opportunityKind: string;
  evidenceId: string;
  eventDate?: string | null;
  identity?: { companyName: string; host: string | null };
  route?: DiscoveryEvidenceRoute;
  provider?: LLMProvider;
  model?: string;
}): Promise<{
  status: "completed" | "unavailable" | "malformed";
  reason?: string;
  result?: z.infer<typeof discoveryInterpretationResultSchema>;
  provider: DiscoveryInterpretationProviderName;
  model: string | null;
}> {
  const excerpt = input.excerpt.trim();
  if (!excerpt)
    return {
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
      provider: "unavailable",
      model: null,
    };

  let provider = input.provider;
  let model = input.model?.trim() || null;
  if (!provider) {
    return {
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
      provider: "unavailable",
      model: null,
    };
  }

  const packet = discoveryInterpretationPacketSchema.parse({
    schemaVersion: 1,
    route: input.route ?? "automated",
    identity: input.identity ?? { companyName: "", host: null },
    opportunityKind: input.opportunityKind,
    eventDate: parseDiscoveryEventDate(input.eventDate),
    excerpt,
    evidenceId: input.evidenceId,
  });

  try {
    const generated = await provider.generate({
      task: "discovery_interpret",
      model: model ?? undefined,
      allowFreeFallback: false,
      allowPlugins: false,
      webSearch: false,
      privateContext: false,
      maxPrice: DISCOVERY_ZERO_PRICE,
      schema: discoveryInterpretationResultSchema,
      messages: [
        {
          role: "system",
          content:
            "Interpret only the supplied public excerpt. Return evidence-grounded company identity. Leave unknown or ambiguous identity unresolved. Do not invent a company from a headline. Reject already-awarded agency wins as open opportunities. Do not invent budget, authority, or intent.",
        },
        { role: "user", content: JSON.stringify(packet) },
      ],
    });
    if (
      generated.provider !== "mock" &&
      model &&
      generated.model &&
      generated.model !== model
    ) {
      return {
        status: "unavailable",
        reason: "DISCOVERY_PAID_ROUTE_REFUSED",
        provider: "unavailable",
        model: generated.model,
      };
    }
    if (generated.provider !== "mock" && generated.model) {
      const priced = verifyDiscoveryZeroPriceRoute(generated.model);
      if (!priced.ok)
        return {
          status: "unavailable",
          reason: priced.reason,
          provider: "unavailable",
          model: generated.model,
        };
    }
    const parsed = discoveryInterpretationResultSchema.safeParse(
      generated.object ?? safeJson(generated.text),
    );
    if (!parsed.success)
      return {
        status: "malformed",
        reason: "INTERPRETATION_MALFORMED",
        provider: generated.provider,
        model: generated.model,
      };
    return {
      status: "completed",
      result: parsed.data,
      provider: generated.provider,
      model: generated.model,
    };
  } catch {
    return {
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
      provider: "unavailable",
      model: model,
    };
  }
}

export async function resolvePublicDiscoveryCompanyIdentity(input: {
  excerpt: string;
  opportunityKind?: string;
  evidenceId?: string;
  eventDate?: string | null;
  provider?: LLMProvider;
  model?: string;
}): Promise<DiscoveryCompanyIdentityResult> {
  const excerpt = input.excerpt.trim();
  if (excerpt.length < 8)
    return { ok: false, reason: "COMPANY_IDENTITY_MISSING" };
  if (!input.provider) {
    const route = resolveDiscoveryInterpretationRoute({ model: input.model });
    if (route.status !== "ready")
      return {
        ok: false,
        reason:
          route.status === "unavailable"
            ? identityFailureReason(route.reason)
            : "INTERPRETATION_PROVIDER_UNAVAILABLE",
      };
  }
  const interpreted = await interpretPublicDiscoveryExcerpt({
    excerpt,
    opportunityKind: input.opportunityKind ?? "company_signal",
    evidenceId: input.evidenceId ?? "evidence",
    eventDate: input.eventDate,
    identity: { companyName: "", host: null },
    route: "automated",
    provider: input.provider,
    model: input.model,
  });
  if (interpreted.status === "unavailable")
    return {
      ok: false,
      reason: identityFailureReason(interpreted.reason),
    };
  if (interpreted.status === "malformed" || !interpreted.result)
    return { ok: false, reason: "INTERPRETATION_MALFORMED" };
  const identity = interpreted.result.companyIdentity;
  if (!identity) return { ok: false, reason: "COMPANY_IDENTITY_MISSING" };
  if (identity.ambiguous)
    return { ok: false, reason: "COMPANY_IDENTITY_AMBIGUOUS" };
  const name = identity.name?.trim().slice(0, 180) ?? "";
  if (name.length < 2 || !isCompanyNameGroundedInExcerpt(name, excerpt))
    return { ok: false, reason: "COMPANY_IDENTITY_MISSING" };
  const domain = identity.domain?.trim().toLowerCase();
  return {
    ok: true,
    name,
    ...(domain ? { domain } : {}),
  };
}

export async function evaluateDiscoveryEvidence(input: {
  opportunityKind: string;
  excerpt: string;
  whyNow: string;
  eventDate?: string | null;
  visibilityScope?: "public" | "restricted" | "private";
  companyName: string;
  website?: string | null;
  sourceUrl?: string | null;
  evidenceId?: string;
  sourceKey?: string | null;
  route?: DiscoveryEvidenceRoute;
  now?: Date;
  provider?: LLMProvider;
  model?: string;
}): Promise<DiscoveryEvidenceEvaluation> {
  const excerpt = input.excerpt.trim();
  const whyNow = input.whyNow.trim();
  const visibility = input.visibilityScope ?? "public";
  const eventDate = parseDiscoveryEventDate(input.eventDate);
  const identity = discoveryIdentityKey({
    companyName: input.companyName,
    website: input.website,
    sourceUrl: input.sourceUrl,
  });
  const route = input.route ?? discoveryEvidenceRoute(input.sourceKey);
  const classified = classifyDiscoveryDisposition({
    opportunityKind: input.opportunityKind,
    excerpt,
    whyNow,
    eventDate,
    now: input.now,
  });
  const excerptIncluded = visibility === "public" && excerpt.length > 0;
  const facts = [
    { id: "fact-company", text: `Company name: ${input.companyName.trim()}` },
    ...(eventDate
      ? [{ id: "fact-date", text: `Event date: ${eventDate}` }]
      : [{ id: "fact-date-missing", text: "Event date: missing" }]),
    ...(input.sourceUrl
      ? [{ id: "fact-source", text: `Source: ${input.sourceUrl}` }]
      : []),
    ...(identity.host
      ? [{ id: "fact-host", text: `Host: ${identity.host}` }]
      : []),
  ];
  const interpretations: DiscoveryEvidenceEvaluation["interpretations"] = [];
  let disposition = classified.disposition;
  let reviewState = classified.reviewState;
  const reasons = [...classified.reasons];
  let packetProvider: DiscoveryInterpretationProviderName = "unavailable";
  let packetModel: string | null = null;
  let interpretationStatus: DiscoveryInterpretationStatus = excerptIncluded
    ? "unavailable"
    : "skipped_private";

  if (excerptIncluded && input.provider) {
    const interpreted = await interpretPublicDiscoveryExcerpt({
      excerpt,
      opportunityKind: input.opportunityKind,
      evidenceId: input.evidenceId ?? "evidence",
      eventDate,
      identity,
      route,
      provider: input.provider,
      model: input.model,
    });
    packetProvider = interpreted.provider;
    packetModel = interpreted.model;
    interpretationStatus = interpreted.status;
    if (interpreted.status === "unavailable") {
      reasons.push("Interpretation provider is unavailable; claims were not added");
    } else if (interpreted.status === "malformed") {
      reasons.push("Model result was malformed; claims were discarded");
    } else if (interpreted.result) {
      if (
        interpreted.result.awardedAppointment &&
        disposition !== "awarded"
      ) {
        disposition = "awarded";
        reviewState = "parked";
        reasons.unshift(
          "Already-awarded appointment is intelligence, not an open pitch",
        );
      }
      for (const claim of interpreted.result.claims) {
        const grounded =
          claim.grounded && isClaimGroundedInExcerpt(claim.text, excerpt);
        if (claim.kind === "fact" && grounded) {
          facts.push({ id: claim.id, text: claim.text });
          continue;
        }
        interpretations.push({
          id: claim.id,
          text: claim.text,
          grounded,
        });
      }
    }
  }

  if (
    whyNow &&
    !isClaimGroundedInExcerpt(whyNow, excerpt) &&
    disposition !== "actionable"
  ) {
    interpretations.push({
      id: "claim-why-now",
      text: "Operator why-now is not fully grounded in the stored excerpt.",
      grounded: false,
    });
  }

  return {
    disposition,
    reviewState,
    reasons,
    identity,
    eventDate,
    facts,
    interpretations,
    packet: {
      schemaVersion: 1,
      provider: packetProvider,
      model: packetModel,
      interpretationStatus,
      webSearch: false,
      privateContext: false,
      excerptIncluded,
      route,
    },
  };
}

function identityFailureReason(
  reason: string | undefined,
): Extract<DiscoveryCompanyIdentityResult, { ok: false }>["reason"] {
  switch (reason) {
    case "COMPANY_IDENTITY_MISSING":
    case "COMPANY_IDENTITY_AMBIGUOUS":
    case "INTERPRETATION_MALFORMED":
    case "DISCOVERY_PAID_ROUTE_REFUSED":
    case "DISCOVERY_MODEL_REQUIRED":
    case "DISCOVERY_LOCAL_INFERENCE_REFUSED":
    case "DISCOVERY_PRICE_PROOF_MISSING":
    case "DISCOVERY_METERING_REQUIRED":
      return reason;
    default:
      return "INTERPRETATION_PROVIDER_UNAVAILABLE";
  }
}

function safeJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
