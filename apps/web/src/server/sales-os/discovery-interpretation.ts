import {
  createProvider,
  MODEL_PRICES_AED,
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
  excerpt: z.string().max(5_000),
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
    identityLineage?: DiscoveryIdentityLineage;
  };
};

export type DiscoveryModelReceipt = {
  provider: string;
  model: string | null;
  requestId: string | null;
  boundedExcerpt?: boolean;
  boundedExcerptBytes?: number;
  boundedRequestBytes?: number;
};

export type DiscoveryCompanyIdentityResult =
  | {
      ok: true;
      name: string;
      domain?: string;
      receipt: DiscoveryModelReceipt;
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
        | "DISCOVERY_PRICE_PROOF_STALE"
        | "DISCOVERY_METERING_REQUIRED"
        | "DISCOVERY_COST_RECEIPT_UNAVAILABLE"
        | "DISCOVERY_INTERPRETATION_INPUT_CEILING_REACHED"
        | "DISCOVERY_FREE_ROUTE_RUNTIME_PROOF_FAILED"
        | "INTERPRETATION_OUTCOME_UNCERTAIN";
      receipt?: DiscoveryModelReceipt;
    };

export class DiscoveryCostReceiptError extends Error {
  readonly code = "DISCOVERY_COST_RECEIPT_UNAVAILABLE" as const;
  constructor() {
    super("DISCOVERY_COST_RECEIPT_UNAVAILABLE");
    this.name = "DiscoveryCostReceiptError";
  }
}

export function isDiscoveryCostReceiptError(error: unknown) {
  return (
    error instanceof DiscoveryCostReceiptError ||
    (error instanceof Error && error.message === "DISCOVERY_COST_RECEIPT_UNAVAILABLE")
  );
}

/** Public-excerpt Discovery only. Do not reuse for private-context or shared development routing. */
export const DISCOVERY_INTERPRETATION_MODELS = [
  "nex-agi/nex-n2.5-pro:free",
] as const;
export const DISCOVERY_INTERPRETATION_UPSTREAM_PROVIDER = "Nex AGI" as const;
export const DISCOVERY_INTERPRETATION_BATCH_SIZE = 5;
export const DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB = 24;
export const DISCOVERY_INTERPRETATION_MAX_TOKENS_PER_JOB = 57_600;
export const DISCOVERY_INTERPRETATION_MAX_INPUT_BYTES_PER_CALL = 1_600;
export const DISCOVERY_INTERPRETATION_PROVIDER_FRAMING_BYTES_PER_CALL = 400;
export const DISCOVERY_INTERPRETATION_MAX_OUTPUT_TOKENS_PER_CALL = 400;
export const DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL =
  DISCOVERY_INTERPRETATION_MAX_INPUT_BYTES_PER_CALL +
  DISCOVERY_INTERPRETATION_PROVIDER_FRAMING_BYTES_PER_CALL +
  DISCOVERY_INTERPRETATION_MAX_OUTPUT_TOKENS_PER_CALL;
export const DISCOVERY_INTERPRETATION_MAX_MS_PER_TICK = 20_000;
export const DISCOVERY_INTERPRETATION_CLAIM_MS = 90_000;
export const DISCOVERY_PRICE_PROOF_MAX_AGE_MS = 48 * 60 * 60 * 1_000;
export const DISCOVERY_ZERO_PRICE = {
  prompt: 0,
  completion: 0,
  request: 0,
} as const;

const DISCOVERY_INTERPRETATION_SYSTEM =
  "Interpret only the supplied public excerpt. Return evidence-grounded company identity. Leave unknown or ambiguous identity unresolved. Do not invent a company from a headline. Reject already-awarded agency wins as open opportunities. Do not invent budget, authority, or intent.";

export function utf8ByteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

export function clipUtf8Prefix(value: string, maxBytes: number) {
  if (maxBytes <= 0) return "";
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;
  let end = Math.min(maxBytes, buffer.length);
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

export function buildDiscoveryInterpretationMessages(packet: {
  schemaVersion: 1;
  route: string;
  identity: { companyName: string; host: string | null };
  opportunityKind: string;
  eventDate: string | null;
  excerpt: string;
  evidenceId: string;
}) {
  const system = DISCOVERY_INTERPRETATION_SYSTEM;
  const mandatoryPacket = { ...packet, excerpt: "" };
  const mandatoryMessages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: JSON.stringify(mandatoryPacket) },
  ];
  const mandatoryBytes = utf8ByteLength(JSON.stringify(mandatoryMessages));
  if (mandatoryBytes >= DISCOVERY_INTERPRETATION_MAX_INPUT_BYTES_PER_CALL) {
    return {
      ok: false as const,
      reason: "DISCOVERY_INTERPRETATION_INPUT_CEILING_REACHED" as const,
      mandatoryBytes,
    };
  }
  let low = 0;
  let high = utf8ByteLength(packet.excerpt);
  let fitted = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = clipUtf8Prefix(packet.excerpt, mid);
    const messages = [
      { role: "system" as const, content: system },
      { role: "user" as const, content: JSON.stringify({ ...packet, excerpt: candidate }) },
    ];
    const bytes = utf8ByteLength(JSON.stringify(messages));
    if (bytes <= DISCOVERY_INTERPRETATION_MAX_INPUT_BYTES_PER_CALL) {
      fitted = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: JSON.stringify({ ...packet, excerpt: fitted }) },
  ];
  const requestBytes = utf8ByteLength(JSON.stringify(messages));
  if (!fitted || requestBytes > DISCOVERY_INTERPRETATION_MAX_INPUT_BYTES_PER_CALL) {
    return {
      ok: false as const,
      reason: "DISCOVERY_INTERPRETATION_INPUT_CEILING_REACHED" as const,
      mandatoryBytes,
      requestBytes,
    };
  }
  return {
    ok: true as const,
    messages,
    excerpt: fitted,
    boundedExcerpt: fitted !== packet.excerpt,
    requestBytes,
    mandatoryBytes,
  };
}


const zeroPriceField = z.union([z.literal(0), z.literal("0")]);
const discoveryZeroPriceProofSchema = z.object({
  model: z.string().min(1).max(180),
  prompt: zeroPriceField,
  completion: zeroPriceField,
  request: zeroPriceField.optional(),
  verifiedAt: z.string().datetime({ offset: true }),
  source: z.literal("openrouter_provider_catalog_and_runtime_probe"),
  endpoint: z.string().min(1).max(180),
  provider: z.literal(DISCOVERY_INTERPRETATION_UPSTREAM_PROVIDER),
  runtimeRequestId: z.string().min(1).max(180),
  actualCost: zeroPriceField,
});

export type DiscoveryIdentityLineage = {
  observationId: string;
  semantic: "model" | "manual" | "unavailable";
  provider: string;
  model: string | null;
  requestId: string | null;
  reason?: string;
  identity?: { name: string; domain?: string };
  sourceUrl: string;
  excerptHash: string;
  grounded: boolean;
  boundedExcerpt?: boolean;
  boundedExcerptBytes?: number;
  boundedRequestBytes?: number;
};

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
      identityLineage: evaluation.packet.identityLineage
        ? {
            ...evaluation.packet.identityLineage,
            sourceUrl: "",
          }
        : undefined,
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
  return DISCOVERY_INTERPRETATION_MODELS.some(
    (item) => item.toLowerCase() === value.toLowerCase(),
  );
}

export function parseDiscoveryZeroPriceProof(
  raw: string | null | undefined,
  now = new Date(),
):
  | { ok: true; proof: z.infer<typeof discoveryZeroPriceProofSchema> }
  | { ok: false; reason: "DISCOVERY_PRICE_PROOF_MISSING" | "DISCOVERY_PRICE_PROOF_STALE" } {
  if (!raw?.trim()) return { ok: false, reason: "DISCOVERY_PRICE_PROOF_MISSING" };
  const parsed = discoveryZeroPriceProofSchema.safeParse(safeJson(raw));
  if (!parsed.success) return { ok: false, reason: "DISCOVERY_PRICE_PROOF_MISSING" };
  const verifiedAt = Date.parse(parsed.data.verifiedAt);
  if (Number.isNaN(verifiedAt) || verifiedAt > now.getTime())
    return { ok: false, reason: "DISCOVERY_PRICE_PROOF_MISSING" };
  if (now.getTime() - verifiedAt > DISCOVERY_PRICE_PROOF_MAX_AGE_MS)
    return { ok: false, reason: "DISCOVERY_PRICE_PROOF_STALE" };
  return { ok: true, proof: parsed.data };
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
  if (!proof.ok) return { ok: false, reason: proof.reason };
  if (proof.proof.model !== model)
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
    observationId?: string | null;
  },
): Promise<void> {
  const db = getDb();
  if (!db) throw new DiscoveryCostReceiptError();
  try {
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
        observationId: context?.observationId ?? null,
      })}::jsonb,
      ${JSON.stringify({ provider: event.provider })}::jsonb,
      ${event.inputTokens},
      ${event.outputTokens},
      ${event.costAed.toFixed(4)},
      ${"not_applicable"}
    )
  `);
  } catch (error) {
    if (error instanceof DiscoveryCostReceiptError) throw error;
    throw new DiscoveryCostReceiptError();
  }
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
      // A token cannot represent less than one UTF-8 byte. This byte ceiling plus
      // the fixed output cap is therefore a conservative reservation without a
      // provider-specific tokenizer, and it is enforced before network I/O.
      const inputBytes = Buffer.byteLength(
        JSON.stringify(options.messages),
        "utf8",
      );
      if (inputBytes > DISCOVERY_INTERPRETATION_MAX_INPUT_BYTES_PER_CALL)
        throw new Error("DISCOVERY_INTERPRETATION_INPUT_CEILING_REACHED");
      const result = await inner.generate({
        ...options,
        model: input.model,
        maxTokens: DISCOVERY_INTERPRETATION_MAX_OUTPUT_TOKENS_PER_CALL,
        allowFreeFallback: false,
        allowPlugins: false,
        openRouterProviderOrder: [DISCOVERY_INTERPRETATION_UPSTREAM_PROVIDER],
        webSearch: false,
        maxPrice: DISCOVERY_ZERO_PRICE,
        task: "discovery_interpret",
      });
      const modelOk =
        result.model === input.model ||
        String(result.model ?? "").includes("nex-n2.5-pro");
      const providerOk =
        result.upstreamProvider === DISCOVERY_INTERPRETATION_UPSTREAM_PROVIDER;
      const zeroCost =
        result.providerCostUsd === 0 || result.providerCostUsd === ("0" as never);
      if (!modelOk || !providerOk || !zeroCost) {
        const error = new Error("DISCOVERY_FREE_ROUTE_RUNTIME_PROOF_FAILED");
        (error as Error & { requestId?: string | null }).requestId =
          result.requestId ?? null;
        throw error;
      }
      return result;
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
  requestId: string | null;
  boundedExcerpt?: boolean;
  boundedExcerptBytes?: number;
  boundedRequestBytes?: number;
  sentExcerpt?: string;
}> {
  const excerpt = input.excerpt.trim();
  if (!excerpt)
    return {
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
      provider: "unavailable",
      model: null,
      requestId: null,
      boundedExcerpt: false,
    };

  const provider = input.provider;
  const model = input.model?.trim() || null;
  if (!provider) {
    return {
      status: "unavailable",
      reason: "INTERPRETATION_PROVIDER_UNAVAILABLE",
      provider: "unavailable",
      model: null,
      requestId: null,
      boundedExcerpt: false,
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
  const fitted = buildDiscoveryInterpretationMessages(packet);
  if (!fitted.ok) {
    return {
      status: "unavailable",
      reason: fitted.reason,
      provider: "unavailable",
      model,
      requestId: null,
      boundedExcerpt: false,
    };
  }

  try {
    const generated = await provider.generate({
      task: "discovery_interpret",
      model: model ?? undefined,
      allowFreeFallback: false,
      allowPlugins: false,
      webSearch: false,
      privateContext: false,
      maxPrice: DISCOVERY_ZERO_PRICE,
      messages: fitted.messages,
    });
    const requestId = generated.requestId ?? null;
    const bounded = {
      boundedExcerpt: fitted.boundedExcerpt,
      boundedExcerptBytes: utf8ByteLength(fitted.excerpt),
      boundedRequestBytes: fitted.requestBytes,
      sentExcerpt: fitted.excerpt,
    };
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
        requestId,
        ...bounded,
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
          requestId,
          ...bounded,
        };
    }
    const parsed = coerceDiscoveryInterpretationResult(
      generated.object ?? unwrapDiscoveryInterpretationValue(generated.text),
    );
    if (!parsed)
      return {
        status: "malformed",
        reason: "INTERPRETATION_MALFORMED",
        provider: generated.provider,
        model: generated.model,
        requestId,
        ...bounded,
      };
    return {
      status: "completed",
      result: parsed,
      provider: generated.provider,
      model: generated.model,
      requestId,
      ...bounded,
    };
  } catch (error) {
    if (isDiscoveryCostReceiptError(error)) throw error;
    const message = error instanceof Error ? error.message : "";
    const requestId =
      error && typeof error === "object" && "requestId" in error
        ? (error as { requestId?: string | null }).requestId ?? null
        : null;
    return {
      status: "unavailable",
      reason: message.startsWith("DISCOVERY_")
        ? message
        : "INTERPRETATION_PROVIDER_UNAVAILABLE",
      provider: "unavailable",
      model: model,
      requestId,
      boundedExcerpt: fitted.boundedExcerpt,
      boundedExcerptBytes: utf8ByteLength(fitted.excerpt),
      boundedRequestBytes: fitted.requestBytes,
      sentExcerpt: fitted.excerpt,
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
  const receipt: DiscoveryModelReceipt = {
    provider: interpreted.provider,
    model: interpreted.model,
    requestId: interpreted.requestId,
    ...(interpreted.boundedExcerpt ? { boundedExcerpt: true } : {}),
    ...(typeof interpreted.boundedExcerptBytes === "number"
      ? { boundedExcerptBytes: interpreted.boundedExcerptBytes }
      : {}),
    ...(typeof interpreted.boundedRequestBytes === "number"
      ? { boundedRequestBytes: interpreted.boundedRequestBytes }
      : {}),
  };
  if (interpreted.status === "unavailable")
    return {
      ok: false,
      reason: identityFailureReason(interpreted.reason),
      receipt,
    };
  if (interpreted.status === "malformed" || !interpreted.result)
    return { ok: false, reason: "INTERPRETATION_MALFORMED", receipt };
  const identity = interpreted.result.companyIdentity;
  if (!identity)
    return { ok: false, reason: "COMPANY_IDENTITY_MISSING", receipt };
  if (identity.ambiguous)
    return { ok: false, reason: "COMPANY_IDENTITY_AMBIGUOUS", receipt };
  const name = identity.name?.trim().slice(0, 180) ?? "";
  const sentExcerpt = interpreted.sentExcerpt ?? excerpt;
  if (name.length < 2 || !isCompanyNameGroundedInExcerpt(name, sentExcerpt))
    return { ok: false, reason: "COMPANY_IDENTITY_MISSING", receipt };
  const domain = identity.domain?.trim().toLowerCase();
  return {
    ok: true,
    name,
    ...(domain ? { domain } : {}),
    receipt,
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
  identityLineage?: DiscoveryIdentityLineage;
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
          claim.grounded &&
          isClaimGroundedInExcerpt(claim.text, interpreted.sentExcerpt ?? excerpt);
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
      ...(input.identityLineage
        ? { identityLineage: input.identityLineage }
        : {}),
    },
  };
}

export function readStoredDiscoveryIdentityLineage(
  result: unknown,
  observationId: string,
  binding?: { sourceKey?: string | null },
): DiscoveryIdentityLineage | null {
  const outcomes = asUnknownRecord(asUnknownRecord(result).sourceOutcomes);
  const entries = binding?.sourceKey
    ? [[binding.sourceKey, outcomes[binding.sourceKey]] as [string, unknown]]
    : Object.entries(outcomes);
  for (const [, value] of entries) {
    const done = asUnknownRecord(asUnknownRecord(value).interpretation).done;
    if (!Array.isArray(done)) continue;
    for (const item of done) {
      const lineage = asStoredIdentityLineage(item);
      if (lineage?.observationId === observationId) return lineage;
    }
  }
  return null;
}

function asUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function asStoredIdentityLineage(value: unknown): DiscoveryIdentityLineage | null {
  const record = asUnknownRecord(value);
  if (typeof record.observationId !== "string") return null;
  if (
    record.semantic !== "model" &&
    record.semantic !== "manual" &&
    record.semantic !== "unavailable"
  )
    return null;
  return {
    observationId: record.observationId,
    semantic: record.semantic,
    provider: typeof record.provider === "string" ? record.provider : "unavailable",
    model: typeof record.model === "string" ? record.model : null,
    requestId: typeof record.requestId === "string" ? record.requestId : null,
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    ...(record.identity && typeof record.identity === "object"
      ? { identity: record.identity as { name: string; domain?: string } }
      : {}),
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : "",
    excerptHash: typeof record.excerptHash === "string" ? record.excerptHash : "",
    grounded: Boolean(record.grounded),
    ...(record.boundedExcerpt === true ? { boundedExcerpt: true } : {}),
    ...(typeof record.boundedExcerptBytes === "number"
      ? { boundedExcerptBytes: record.boundedExcerptBytes }
      : {}),
    ...(typeof record.boundedRequestBytes === "number"
      ? { boundedRequestBytes: record.boundedRequestBytes }
      : {}),
  };
}


function unwrapDiscoveryInterpretationValue(value: unknown): unknown {
  if (typeof value === "string") return unwrapDiscoveryInterpretationValue(safeJson(value));
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  for (const key of ["output", "result", "data", "json", "message"]) {
    const nested = row[key];
    if (nested && nested !== value) return unwrapDiscoveryInterpretationValue(nested);
  }
  if (typeof row.content === "string") return unwrapDiscoveryInterpretationValue(row.content);
  return value;
}

function coerceDiscoveryInterpretationResult(
  value: unknown,
): z.infer<typeof discoveryInterpretationResultSchema> | null {
  value = unwrapDiscoveryInterpretationValue(value);
  const direct = discoveryInterpretationResultSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const nested =
    row.companyIdentity && typeof row.companyIdentity === "object" && !Array.isArray(row.companyIdentity)
      ? (row.companyIdentity as Record<string, unknown>)
      : {};
  const hasIdentityShape =
    typeof nested.name === "string" ||
    typeof nested.domain === "string" ||
    typeof row.companyName === "string" ||
    typeof row.domain === "string" ||
    typeof row.host === "string";
  if (!hasIdentityShape) return null;
  const host =
    typeof row.host === "string"
      ? row.host
      : typeof nested.host === "string"
        ? nested.host
        : null;
  const coerced = {
    claims: Array.isArray(row.claims) ? row.claims : [],
    relevantService: typeof row.relevantService === "string" ? row.relevantService : null,
    opportunityKind: typeof row.opportunityKind === "string" ? row.opportunityKind : null,
    awardedAppointment: typeof row.awardedAppointment === "boolean" ? row.awardedAppointment : false,
    unsupported: typeof row.unsupported === "boolean" ? row.unsupported : false,
    companyIdentity: {
      name:
        typeof nested.name === "string"
          ? nested.name
          : typeof row.companyName === "string"
            ? row.companyName
            : null,
      domain:
        typeof nested.domain === "string"
          ? nested.domain
          : typeof row.domain === "string"
            ? row.domain
            : host && host.includes(".")
              ? host
              : null,
      ambiguous: typeof nested.ambiguous === "boolean" ? nested.ambiguous : false,
    },
  };
  const parsed = discoveryInterpretationResultSchema.safeParse(coerced);
  return parsed.success ? parsed.data : null;
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
    case "DISCOVERY_PRICE_PROOF_STALE":
    case "DISCOVERY_METERING_REQUIRED":
    case "DISCOVERY_COST_RECEIPT_UNAVAILABLE":
    case "DISCOVERY_INTERPRETATION_INPUT_CEILING_REACHED":
    case "DISCOVERY_FREE_ROUTE_RUNTIME_PROOF_FAILED":
    case "INTERPRETATION_OUTCOME_UNCERTAIN":
      return reason;
    default:
      return "INTERPRETATION_PROVIDER_UNAVAILABLE";
  }
}

function safeJson(text: string) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = Math.min(
      ...["{", "["].map((token) => {
        const index = trimmed.indexOf(token);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      }),
    );
    if (!Number.isFinite(start)) return null;
    try {
      return JSON.parse(trimmed.slice(start).replace(/\s*```$/, "")) as unknown;
    } catch {
      return null;
    }
  }
}
