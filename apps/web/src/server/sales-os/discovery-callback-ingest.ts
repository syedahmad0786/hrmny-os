import { createHash } from "node:crypto";
import type { LLMProvider } from "@hrmny/ai";
import { and, eq, scheduledJob, sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import {
  countDiscoveryCandidatesForRunTx,
  ingestCollectorObservationTx,
  type DiscoveryWriteTx,
} from "./discovery-candidates";
import {
  DISCOVERY_INTERPRETATION_BATCH_SIZE,
  DISCOVERY_INTERPRETATION_CLAIM_MS,
  DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB,
  DISCOVERY_INTERPRETATION_MAX_MS_PER_TICK,
  DISCOVERY_INTERPRETATION_MAX_TOKENS_PER_JOB,
  DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL,
  createLiveDiscoveryInterpretationProvider,
  discoveryMonthlySpendAed,
  evaluateDiscoveryEvidence,
  isCompanyNameGroundedInExcerpt,
  persistDiscoveryInterpretationCost,
  readStoredDiscoveryIdentityLineage,
  resolveDiscoveryInterpretationRoute,
  resolvePublicDiscoveryCompanyIdentity,
  type DiscoveryIdentityLineage,
  type DiscoveryModelReceipt,
} from "./discovery-interpretation";
import {
  DiscoveryRunPayloadV1Schema,
  isDiscoveryExecutionEnabled,
  promoteDeferredAfterTerminalTx,
  SALES_RESEARCH_RUN_JOB_KIND,
  type DiscoveryEffectiveSnapshotV1,
} from "./discovery-runs";
import type { DiscoveryRuntimeEnvelope } from "./discovery-runtime-contract";
import {
  normalizeResearchEvidence,
  ResearchEvidenceError,
} from "./research-evidence";

const REDIRECT_QUERY_KEYS = new Set([
  "continue",
  "dest",
  "destination",
  "next",
  "redirect",
  "redirect_uri",
  "redirecturl",
  "return",
  "returnurl",
  "target",
  "u",
  "url",
]);

export type DiscoveryCallbackSource = {
  bindingId: string;
  sourceKey: string;
  credentialGeneration: number;
  configuration: Record<string, unknown>;
};

export type DiscoveryObservationProvenanceResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export type DiscoveryObservationMapResult =
  | {
      ok: true;
      receipt?: DiscoveryModelReceipt;
      values: {
        requestId: string;
        companyName: string;
        website?: string;
        discoveryChannel:
          | "publication"
          | "hiring"
          | "leadership"
          | "government"
          | "intent_import";
        opportunityKind:
          | "company_signal"
          | "hiring"
          | "leadership"
          | "tender"
          | "intent";
        whyNow: string;
        sourceKey: string;
        sourceItemId: string;
        externalOpportunityId: string;
        sourceUrl: string;
        excerpt: string;
        eventDate?: string;
      visibilityScope: "public";
      strategicLane: "industry_scanning";
    };
  }
  | { ok: false; reason: string; receipt?: DiscoveryModelReceipt };

export type DiscoveryInterpretationItem = {
  observationId: string;
  sourceItemKey: string;
  excerpt: string;
  title: string;
  publishedAt: string | null;
  sourceUrl: string;
  kind: string;
  contentHash: string;
};

export type DiscoveryInterpretationQueue = {
  schemaVersion: 1;
  pending: DiscoveryInterpretationItem[];
  done: DiscoveryIdentityLineage[];
  inFlight: DiscoveryInterpretationItem[];
  calls: number;
  inputTokens: number;
  outputTokens: number;
  claimedAt: string | null;
  status:
    | "pending"
    | "continuing"
    | "completed"
    | "unavailable"
    | "cancelled"
    | "ceiling";
  lastError: string | null;
};

export function emptyDiscoveryInterpretationQueue(): DiscoveryInterpretationQueue {
  return {
    schemaVersion: 1,
    pending: [],
    done: [],
    inFlight: [],
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    claimedAt: null,
    status: "pending",
    lastError: null,
  };
}

export type DiscoveryInterpretationBudget = {
  schemaVersion: 1;
  costReceiptAvailable: boolean;
  observationIds: string[];
  reservedCalls: number;
  reservedTokens: number;
  settledCalls: number;
  settledTokens: number;
};

export function emptyDiscoveryInterpretationBudget(): DiscoveryInterpretationBudget {
  return {
    schemaVersion: 1,
    costReceiptAvailable: true,
    observationIds: [],
    reservedCalls: 0,
    reservedTokens: 0,
    settledCalls: 0,
    settledTokens: 0,
  };
}

export function readDiscoveryInterpretationBudget(
  result: unknown,
): DiscoveryInterpretationBudget {
  const reservations = asRecord(asRecord(result).budgetReservations);
  const raw = asRecord(reservations.interpretation);
  const observationIds = Array.isArray(raw.observationIds)
    ? raw.observationIds.filter((id): id is string => typeof id === "string")
    : [];
  const reservedCalls =
    typeof raw.reservedCalls === "number"
      ? raw.reservedCalls
      : observationIds.length;
  const reservedTokens =
    typeof raw.reservedTokens === "number"
      ? raw.reservedTokens
      : observationIds.length * DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL;
  return {
    ...emptyDiscoveryInterpretationBudget(),
    costReceiptAvailable: raw.costReceiptAvailable !== false,
    observationIds,
    reservedCalls,
    reservedTokens,
    settledCalls: typeof raw.settledCalls === "number" ? raw.settledCalls : 0,
    settledTokens: typeof raw.settledTokens === "number" ? raw.settledTokens : 0,
  };
}

export function resolveDiscoveryInterpretationJobLastError(input: {
  queueLastError: string | null;
  costReceiptAvailable: boolean;
  cancelled: boolean;
}) {
  if (!input.cancelled && !input.costReceiptAvailable)
    return "DISCOVERY_COST_RECEIPT_UNAVAILABLE";
  return input.queueLastError;
}

export function remainingDiscoveryInterpretationBudget(
  budget: DiscoveryInterpretationBudget,
) {
  const calls = Math.max(budget.reservedCalls, budget.settledCalls);
  const tokens = Math.max(budget.reservedTokens, budget.settledTokens);
  return {
    calls: Math.max(0, DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB - calls),
    tokens: Math.max(0, DISCOVERY_INTERPRETATION_MAX_TOKENS_PER_JOB - tokens),
  };
}

export function remainingDiscoveryInterpretationBudgetForQueue(
  budget: DiscoveryInterpretationBudget,
  observationIds: string[],
) {
  const remaining = remainingDiscoveryInterpretationBudget(budget);
  const alreadyReserved = observationIds.filter((id) =>
    budget.observationIds.includes(id),
  ).length;
  return {
    calls: remaining.calls + alreadyReserved,
    tokens:
      remaining.tokens +
      alreadyReserved * DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL,
  };
}

export function reserveDiscoveryInterpretationBudget(
  budget: DiscoveryInterpretationBudget,
  observationIds: string[],
):
  | { ok: true; budget: DiscoveryInterpretationBudget }
  | { ok: false; reason: "INTERPRETATION_CEILING_REACHED" } {
  const fresh = observationIds.filter(
    (id) => !budget.observationIds.includes(id),
  );
  if (fresh.length === 0) return { ok: true, budget };
  const remaining = remainingDiscoveryInterpretationBudget(budget);
  const tokens = fresh.length * DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL;
  if (remaining.calls < fresh.length || remaining.tokens < tokens)
    return { ok: false, reason: "INTERPRETATION_CEILING_REACHED" };
  return {
    ok: true,
    budget: {
      ...budget,
      observationIds: [...budget.observationIds, ...fresh],
      reservedCalls: budget.reservedCalls + fresh.length,
      reservedTokens: budget.reservedTokens + tokens,
    },
  };
}

export function settleDiscoveryInterpretationBudget(
  budget: DiscoveryInterpretationBudget,
  actual: { calls: number; tokens: number },
): DiscoveryInterpretationBudget {
  return {
    ...budget,
    settledCalls: Math.max(budget.settledCalls, budget.settledCalls + actual.calls),
    settledTokens: Math.max(budget.settledTokens, budget.settledTokens + actual.tokens),
  };
}

export function writeDiscoveryInterpretationBudget(
  result: Record<string, unknown>,
  budget: DiscoveryInterpretationBudget,
) {
  return {
    ...result,
    budgetReservations: {
      ...asRecord(result.budgetReservations),
      interpretation: budget,
    },
  };
}

export function readDiscoveryIdentityLineage(
  result: unknown,
  observationId: string,
  binding?: { sourceKey?: string | null },
): DiscoveryIdentityLineage | null {
  return readStoredDiscoveryIdentityLineage(result, observationId, binding);
}

function excerptSha256(excerpt: string) {
  return createHash("sha256").update(excerpt).digest("hex");
}

function identityReceipt(input: {
  item: DiscoveryInterpretationItem;
  reason?: string;
  semantic: DiscoveryIdentityLineage["semantic"];
  provider?: string;
  model?: string | null;
  requestId?: string | null;
  identity?: { name: string; domain?: string };
  grounded?: boolean;
}): DiscoveryIdentityLineage {
  return {
    observationId: input.item.observationId,
    semantic: input.semantic,
    provider: input.provider ?? "unavailable",
    model: input.model ?? null,
    requestId: input.requestId ?? null,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.identity ? { identity: input.identity } : {}),
    sourceUrl: input.item.sourceUrl,
    excerptHash: excerptSha256(input.item.excerpt),
    grounded: Boolean(input.grounded),
  };
}

export function admitDiscoveryCallbackObservations(input: {
  observations: Extract<
    DiscoveryRuntimeEnvelope,
    { event: "sales.discovery.observations.v1" }
  >["payload"]["observations"];
  sourceKey: string;
  configuration: Record<string, unknown>;
  maxObservations: number;
  alreadyUsed?: number;
}): {
  admitted: Array<Extract<DiscoveryObservationMapResult, { ok: true }>["values"]>;
  quarantined: number;
  pendingInterpretation: DiscoveryInterpretationItem[];
} {
  const admitted: Array<
    Extract<DiscoveryObservationMapResult, { ok: true }>["values"]
  > = [];
  const pendingInterpretation: DiscoveryInterpretationItem[] = [];
  let quarantined = 0;
  let used = input.alreadyUsed ?? 0;
  for (const observation of input.observations) {
    if (used >= input.maxObservations) {
      quarantined += 1;
      continue;
    }
    const mapped = mapDiscoveryObservationToSubmit(
      observation,
      input.sourceKey,
      input.configuration,
    );
    if (mapped.ok) {
      admitted.push(mapped.values);
      used += 1;
      continue;
    }
    quarantined += 1;
    if (mapped.reason !== "COMPANY_IDENTITY_MISSING") continue;
    if (observation.sourceReference.kind !== "public_url") continue;
    pendingInterpretation.push({
      observationId: observation.observationId,
      sourceItemKey: observation.sourceItemKey,
      excerpt: observation.excerpt,
      title: observation.title,
      publishedAt: observation.publishedAt,
      sourceUrl: observation.sourceReference.url,
      kind: observation.kind,
      contentHash: observation.contentHash,
    });
    used += 1;
  }
  return { admitted, quarantined, pendingInterpretation };
}

export function planDiscoveryInterpretationTick(input: {
  queue: DiscoveryInterpretationQueue;
  cancelled?: boolean;
  providerAvailable?: boolean;
  nowMs?: number;
  startedAtMs?: number;
  ignoreBusy?: boolean;
  remainingCalls?: number;
  remainingTokens?: number;
}):
  | { action: "done" }
  | { action: "cancel" }
  | { action: "unavailable"; reason: string }
  | { action: "ceiling" }
  | { action: "busy" }
  | { action: "uncertain"; items: DiscoveryInterpretationItem[] }
  | { action: "claim"; items: DiscoveryInterpretationItem[] } {
  if (input.cancelled) return { action: "cancel" };
  if (input.providerAvailable === false)
    return { action: "unavailable", reason: "INTERPRETATION_PROVIDER_UNAVAILABLE" };
  const nowMs = input.nowMs ?? Date.now();
  if (
    !input.ignoreBusy &&
    input.queue.inFlight.length > 0 &&
    input.queue.status === "continuing"
  ) {
    const claimedAt = input.queue.claimedAt
      ? Date.parse(input.queue.claimedAt)
      : 0;
    if (claimedAt && nowMs - claimedAt < DISCOVERY_INTERPRETATION_CLAIM_MS)
      return { action: "busy" };
    return { action: "uncertain", items: input.queue.inFlight };
  }
  const elapsed = nowMs - (input.startedAtMs ?? nowMs);
  if (elapsed >= DISCOVERY_INTERPRETATION_MAX_MS_PER_TICK)
    return { action: "ceiling" };
  const remainingCalls =
    input.remainingCalls ??
    DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB - input.queue.calls;
  const remainingTokens =
    input.remainingTokens ??
    DISCOVERY_INTERPRETATION_MAX_TOKENS_PER_JOB -
      (input.queue.inputTokens + input.queue.outputTokens);
  if (
    remainingCalls <= 0 ||
    remainingTokens < DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL
  )
    return { action: "ceiling" };
  const remaining = [
    ...input.queue.inFlight,
    ...input.queue.pending.filter(
      (item) =>
        !input.queue.done.some((done) => done.observationId === item.observationId),
    ),
  ];
  const unique = remaining.filter(
    (item, index, list) =>
      list.findIndex((other) => other.observationId === item.observationId) ===
      index,
  );
  if (unique.length === 0) return { action: "done" };
  return {
    action: "claim",
    items: unique.slice(
      0,
      Math.min(
        DISCOVERY_INTERPRETATION_BATCH_SIZE,
        remainingCalls,
        Math.floor(
          remainingTokens / DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL,
        ),
      ),
    ),
  };
}

export function applyDiscoveryInterpretationProgress(
  queue: DiscoveryInterpretationQueue,
  update: {
    claimed?: DiscoveryInterpretationItem[];
    results?: Array<Partial<DiscoveryIdentityLineage> & { observationId: string }>;
    calls?: number;
    inputTokens?: number;
    outputTokens?: number;
    status?: DiscoveryInterpretationQueue["status"];
    lastError?: string | null;
  },
): DiscoveryInterpretationQueue {
  const claimedIds = new Set(
    (update.claimed ?? []).map((item) => item.observationId),
  );
  const doneIds = new Set([
    ...queue.done.map((item) => item.observationId),
    ...(update.results ?? []).map((item) => item.observationId),
  ]);
  const next: DiscoveryInterpretationQueue = {
    ...queue,
    pending: queue.pending.filter((item) => !claimedIds.has(item.observationId) && !doneIds.has(item.observationId)),
    inFlight: update.claimed ?? [],
    done: [
      ...queue.done,
      ...(update.results ?? []).map((item) => ({
        observationId: item.observationId,
        semantic: item.semantic ?? "unavailable",
        provider: item.provider ?? "unavailable",
        model: item.model ?? null,
        requestId: item.requestId ?? null,
        ...(item.reason ? { reason: item.reason } : {}),
        ...(item.identity ? { identity: item.identity } : {}),
        sourceUrl: item.sourceUrl ?? "",
        excerptHash: item.excerptHash ?? "",
        grounded: Boolean(item.grounded),
      })),
    ],
    calls: queue.calls + (update.calls ?? 0),
    inputTokens: queue.inputTokens + (update.inputTokens ?? 0),
    outputTokens: queue.outputTokens + (update.outputTokens ?? 0),
    claimedAt:
      update.claimed && update.claimed.length
        ? new Date().toISOString()
        : update.status && update.status !== "continuing"
          ? null
          : queue.claimedAt,
    status: update.status ?? queue.status,
    lastError: update.lastError === undefined ? queue.lastError : update.lastError,
  };
  if (next.pending.length === 0 && next.inFlight.length === 0 && next.status === "continuing")
    next.status = "completed";
  return next;
}

export function resolveDiscoveryCallbackSource(
  effective: DiscoveryEffectiveSnapshotV1 | null | undefined,
  sourceId: string,
  credentialGeneration: number,
):
  | { ok: true; source: DiscoveryCallbackSource }
  | { ok: false; code: "RUN_FENCE_MISSING" | "SOURCE_NOT_IN_RUN" | "CREDENTIAL_GENERATION_MISMATCH" } {
  if (!effective) return { ok: false, code: "RUN_FENCE_MISSING" };
  const source = effective.sources.find((item) => item.bindingId === sourceId);
  if (!source) return { ok: false, code: "SOURCE_NOT_IN_RUN" };
  if (source.credentialGeneration !== credentialGeneration)
    return { ok: false, code: "CREDENTIAL_GENERATION_MISMATCH" };
  return {
    ok: true,
    source: {
      bindingId: source.bindingId,
      sourceKey: source.sourceKey,
      credentialGeneration: source.credentialGeneration,
      configuration: source.configuration,
    },
  };
}

function publicOriginHost(value: URL) {
  return value.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function permittedDiscoverySourceHosts(
  configuration: Record<string, unknown>,
): string[] {
  const hosts = new Set<string>();
  for (const key of ["url", "feedUrl"] as const) {
    const raw = configuration[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    try {
      hosts.add(publicOriginHost(new URL(normalizeResearchEvidence(raw))));
    } catch {
      continue;
    }
  }
  return [...hosts];
}

function embeddedRedirectHost(value: string): string | null {
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    return publicOriginHost(new URL(raw));
  } catch {
    return null;
  }
}

export function evaluateDiscoveryObservationProvenance(input: {
  url: string;
  configuration: Record<string, unknown>;
}): DiscoveryObservationProvenanceResult {
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    return { ok: false, reason: "SOURCE_URL_INVALID" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return { ok: false, reason: "SOURCE_URL_SCHEME_REJECTED" };
  if (parsed.username || parsed.password)
    return { ok: false, reason: "SOURCE_URL_CREDENTIALS_REJECTED" };
  let normalized: string;
  try {
    normalized = normalizeResearchEvidence(parsed.toString());
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof ResearchEvidenceError
          ? "SOURCE_URL_NOT_PUBLIC_HTTPS"
          : "SOURCE_URL_INVALID",
    };
  }
  const publicUrl = new URL(normalized);
  const permitted = permittedDiscoverySourceHosts(input.configuration);
  if (permitted.length === 0)
    return { ok: false, reason: "SOURCE_ORIGIN_UNCONFIGURED" };
  if (!permitted.includes(publicOriginHost(publicUrl)))
    return { ok: false, reason: "SOURCE_ORIGIN_MISMATCH" };
  for (const [key, value] of publicUrl.searchParams.entries()) {
    if (!REDIRECT_QUERY_KEYS.has(key.toLowerCase())) continue;
    const embedded = embeddedRedirectHost(value);
    if (embedded && !permitted.includes(embedded))
      return { ok: false, reason: "SOURCE_REDIRECT_PROVENANCE_REJECTED" };
  }
  const configuredUrl =
    typeof input.configuration.url === "string" ? input.configuration.url.trim() : "";
  if (configuredUrl) {
    try {
      const configuredPath = new URL(configuredUrl).pathname.toLowerCase();
      const requiresBusinessPath =
        configuredPath === "/business" || configuredPath.startsWith("/business/");
      if (
        requiresBusinessPath &&
        !publicUrl.pathname.toLowerCase().startsWith("/business/")
      ) {
        return { ok: false, reason: "SOURCE_PATH_MISMATCH" };
      }
    } catch {
      return { ok: false, reason: "SOURCE_URL_INVALID" };
    }
  }
  return { ok: true, url: normalized };
}

export function reviewerIdsFromEffective(
  effective: DiscoveryEffectiveSnapshotV1 | null | undefined,
) {
  const parsed = z
    .object({ reviewerEmployeeIds: z.array(z.string().uuid()).max(10) })
    .safeParse(effective?.config);
  return parsed.success ? parsed.data.reviewerEmployeeIds : [];
}

export function maxObservationsFromEffective(
  effective: DiscoveryEffectiveSnapshotV1 | null | undefined,
) {
  const limits = z
    .object({ maxObservations: z.number().int().min(1).max(200) })
    .safeParse(
      effective?.config && typeof effective.config === "object"
        ? (effective.config as { limits?: unknown }).limits
        : undefined,
    );
  return limits.success ? limits.data.maxObservations : 200;
}

type ObservationKind = Extract<
  DiscoveryRuntimeEnvelope,
  { event: "sales.discovery.observations.v1" }
>["payload"]["observations"][number]["kind"];

function observationKindMapping(kind: ObservationKind): {
  discoveryChannel:
    | "publication"
    | "hiring"
    | "leadership"
    | "government"
    | "intent_import";
  opportunityKind: "company_signal" | "hiring" | "leadership" | "tender" | "intent";
} {
  switch (kind) {
    case "news":
    case "relationship":
    case "inbound":
    case "other":
      return {
        discoveryChannel: "publication",
        opportunityKind: "company_signal",
      };
    case "job":
      return { discoveryChannel: "hiring", opportunityKind: "hiring" };
    case "leadership":
      return { discoveryChannel: "leadership", opportunityKind: "leadership" };
    case "tender":
      return { discoveryChannel: "government", opportunityKind: "tender" };
    case "company_intent":
      return { discoveryChannel: "intent_import", opportunityKind: "intent" };
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled observation kind: ${String(unhandled)}`);
    }
  }
}

export function mapDiscoveryObservationToSubmit(
  observation: Extract<
    DiscoveryRuntimeEnvelope,
    { event: "sales.discovery.observations.v1" }
  >["payload"]["observations"][number],
  sourceKey: string,
  configuration: Record<string, unknown>,
  resolvedIdentity?: { name: string; domain?: string },
): DiscoveryObservationMapResult {
  if (observation.sourceReference.kind !== "public_url")
    return { ok: false, reason: "AUTHORIZED_DOCUMENT_NOT_INGESTED" };
  const provenance = evaluateDiscoveryObservationProvenance({
    url: observation.sourceReference.url,
    configuration,
  });
  if (!provenance.ok) return provenance;
  const mapped = observationKindMapping(observation.kind);
  const hint = observation.companyHints[0];
  const companyName =
    hint?.name.trim().slice(0, 180) ||
    resolvedIdentity?.name.trim().slice(0, 180) ||
    "";
  if (companyName.length < 2)
    return { ok: false, reason: "COMPANY_IDENTITY_MISSING" };
  const excerpt = observation.excerpt.trim().slice(0, 2_000);
  if (excerpt.length < 8) return { ok: false, reason: "EXCERPT_TOO_SHORT" };
  const whyNow = observation.title.trim().slice(0, 2_000);
  if (whyNow.length < 8) return { ok: false, reason: "WHY_NOW_TOO_SHORT" };
  const eventDate = observation.publishedAt?.slice(0, 10);
  const domain = hint?.domain || resolvedIdentity?.domain;
  return {
    ok: true,
    values: {
      requestId: observation.observationId,
      companyName,
      ...(domain ? { website: `https://${domain}` } : {}),
      discoveryChannel: mapped.discoveryChannel,
      opportunityKind: mapped.opportunityKind,
      whyNow,
      sourceKey,
      sourceItemId: observation.sourceItemKey,
      externalOpportunityId: observation.sourceItemKey,
      sourceUrl: provenance.url,
      excerpt,
      ...(eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
        ? { eventDate }
        : {}),
      visibilityScope: "public",
      strategicLane: "industry_scanning",
    },
  };
}

export async function prepareDiscoveryObservationForSubmit(
  observation: Extract<
    DiscoveryRuntimeEnvelope,
    { event: "sales.discovery.observations.v1" }
  >["payload"]["observations"][number],
  sourceKey: string,
  configuration: Record<string, unknown>,
  provider?: LLMProvider,
): Promise<DiscoveryObservationMapResult> {
  const mapped = mapDiscoveryObservationToSubmit(
    observation,
    sourceKey,
    configuration,
  );
  if (mapped.ok || mapped.reason !== "COMPANY_IDENTITY_MISSING") return mapped;
  const resolved = await resolvePublicDiscoveryCompanyIdentity({
    excerpt: observation.excerpt,
    opportunityKind: observationKindMapping(observation.kind).opportunityKind,
    evidenceId: observation.observationId,
    eventDate: observation.publishedAt?.slice(0, 10),
    provider,
  });
  if (!resolved.ok)
    return { ok: false, reason: resolved.reason, receipt: resolved.receipt };
  return {
    ...mapDiscoveryObservationToSubmit(
      observation,
      sourceKey,
      configuration,
      resolved,
    ),
    receipt: resolved.receipt,
  };
}

export async function ingestDiscoveryCallbackObservations(input: {
  tx: DiscoveryWriteTx;
  envelope: Extract<
    DiscoveryRuntimeEnvelope,
    { event: "sales.discovery.observations.v1" }
  >;
  sourceKey: string;
  configuration: Record<string, unknown>;
  ownerEmployeeId: string;
  reviewerEmployeeIds: string[];
  programmeId: string;
  maxObservations: number;
}): Promise<{
  ingested: number;
  duplicate: number;
  replay: number;
  quarantined: number;
  interpretation: DiscoveryInterpretationQueue;
}> {
  const used = await countDiscoveryCandidatesForRunTx(
    input.tx,
    input.envelope.runId,
  );
  const admission = admitDiscoveryCallbackObservations({
    observations: input.envelope.payload.observations,
    sourceKey: input.sourceKey,
    configuration: input.configuration,
    maxObservations: input.maxObservations,
    alreadyUsed: used,
  });
  const counts = {
    ingested: 0,
    duplicate: 0,
    replay: 0,
    quarantined: admission.quarantined,
    interpretation: {
      ...emptyDiscoveryInterpretationQueue(),
      pending: admission.pendingInterpretation,
      status: admission.pendingInterpretation.length ? "pending" : "completed",
    } satisfies DiscoveryInterpretationQueue,
  };
  for (const values of admission.admitted) {
    const result = await ingestCollectorObservationTx(input.tx, {
      actorEmployeeId: input.ownerEmployeeId,
      ownerEmployeeId: input.ownerEmployeeId,
      reviewerEmployeeIds: input.reviewerEmployeeIds,
      programmeId: input.programmeId,
      scheduledJobId: input.envelope.runId,
      values,
    });
    counts[result.status] += 1;
  }
  return counts;
}

export async function continueDiscoveryInterpretationQueue(input: {
  queue: DiscoveryInterpretationQueue;
  cancelled?: boolean;
  provider?: LLMProvider;
  providerAvailable?: boolean;
  sourceKey: string;
  configuration: Record<string, unknown>;
  startedAtMs?: number;
  nowMs?: number;
  ignoreBusy?: boolean;
  remainingCalls?: number;
  remainingTokens?: number;
  onObservationStart?: (observationId: string) => void;
}): Promise<{
  queue: DiscoveryInterpretationQueue;
  resolved: Array<Extract<DiscoveryObservationMapResult, { ok: true }>["values"]>;
}> {
  const startedAtMs = input.startedAtMs ?? input.nowMs ?? Date.now();
  const plan = planDiscoveryInterpretationTick({
    queue: input.queue,
    cancelled: input.cancelled,
    providerAvailable: input.providerAvailable ?? Boolean(input.provider),
    nowMs: input.nowMs ?? Date.now(),
    startedAtMs,
    ignoreBusy: input.ignoreBusy,
    remainingCalls: input.remainingCalls,
    remainingTokens: input.remainingTokens,
  });
  if (plan.action === "busy")
    return { queue: input.queue, resolved: [] };
  if (plan.action === "uncertain")
    return {
      queue: applyDiscoveryInterpretationProgress(input.queue, {
        claimed: [],
        results: plan.items.map((item) =>
          identityReceipt({
            item,
            semantic: "unavailable",
            reason: "INTERPRETATION_OUTCOME_UNCERTAIN",
          }),
        ),
        status:
          input.queue.pending.filter(
            (item) =>
              !plan.items.some(
                (uncertain) => uncertain.observationId === item.observationId,
              ),
          ).length > 0
            ? "pending"
            : "unavailable",
        lastError: "INTERPRETATION_OUTCOME_UNCERTAIN",
      }),
      resolved: [],
    };
  if (plan.action === "done")
    return {
      queue: applyDiscoveryInterpretationProgress(input.queue, {
        status: "completed",
        lastError: null,
      }),
      resolved: [],
    };
  if (plan.action === "cancel")
    return {
      queue: applyDiscoveryInterpretationProgress(input.queue, {
        claimed: [],
        results: [...input.queue.pending, ...input.queue.inFlight].map((item) =>
          identityReceipt({
            item,
            semantic: "unavailable",
            reason: "RUN_CANCEL_REQUESTED",
          }),
        ),
        status: "cancelled",
        lastError: "RUN_CANCEL_REQUESTED",
      }),
      resolved: [],
    };
  if (plan.action === "unavailable")
    return {
      queue: applyDiscoveryInterpretationProgress(input.queue, {
        claimed: [],
        results: [...input.queue.pending, ...input.queue.inFlight].map((item) =>
          identityReceipt({
            item,
            semantic: "unavailable",
            reason: plan.reason,
          }),
        ),
        status: "unavailable",
        lastError: plan.reason,
      }),
      resolved: [],
    };
  if (plan.action === "ceiling")
    return {
      queue: applyDiscoveryInterpretationProgress(input.queue, {
        status: "ceiling",
        lastError: "INTERPRETATION_CEILING_REACHED",
      }),
      resolved: [],
    };
  const claimed = applyDiscoveryInterpretationProgress(input.queue, {
    claimed: plan.items,
    status: "continuing",
  });
  const resolved: Array<
    Extract<DiscoveryObservationMapResult, { ok: true }>["values"]
  > = [];
  const results: DiscoveryIdentityLineage[] = [];
  let calls = 0;
  for (const item of plan.items) {
    if (Date.now() - startedAtMs >= DISCOVERY_INTERPRETATION_MAX_MS_PER_TICK) {
      const remaining = plan.items.filter(
        (pending) => !results.some((done) => done.observationId === pending.observationId),
      );
      const progressed = applyDiscoveryInterpretationProgress(claimed, {
        claimed: [],
        results,
        calls,
        status: "pending",
        lastError: null,
      });
      return {
        queue: {
          ...progressed,
          pending: [...progressed.pending, ...remaining],
          inFlight: [],
          claimedAt: null,
        },
        resolved,
      };
    }
    let mapped: DiscoveryObservationMapResult;
    calls += 1;
    input.onObservationStart?.(item.observationId);
    try {
      mapped = await prepareDiscoveryObservationForSubmit(
        {
          observationId: item.observationId,
          sourceItemKey: item.sourceItemKey,
          contentHash: item.contentHash,
          sourceReference: { kind: "public_url", url: item.sourceUrl },
          observedAt: new Date().toISOString(),
          publishedAt: item.publishedAt,
          dateEvidence: { method: "feed", precision: "day" },
          kind: item.kind as Extract<
            DiscoveryRuntimeEnvelope,
            { event: "sales.discovery.observations.v1" }
          >["payload"]["observations"][number]["kind"],
          title: item.title,
          excerpt: item.excerpt,
          companyHints: [],
        },
        input.sourceKey,
        input.configuration,
        input.provider,
      );
    } catch {
      const failed = item;
      const unattempted = plan.items.filter(
        (pending) =>
          pending.observationId !== failed.observationId &&
          !results.some((done) => done.observationId === pending.observationId),
      );
      const progressed = applyDiscoveryInterpretationProgress(claimed, {
        claimed: [],
        results: [
          ...results,
          identityReceipt({
            item: failed,
            semantic: "unavailable",
            reason: "DISCOVERY_COST_RECEIPT_UNAVAILABLE",
          }),
        ],
        calls,
        status: "unavailable",
        lastError: "DISCOVERY_COST_RECEIPT_UNAVAILABLE",
      });
      return {
        queue: {
          ...progressed,
          pending: [...progressed.pending, ...unattempted],
          inFlight: [],
          claimedAt: null,
        },
        resolved,
      };
    }
    if (mapped.ok) {
      resolved.push(mapped.values);
      results.push(
        identityReceipt({
          item,
          semantic: mapped.receipt ? "model" : input.provider ? "model" : "manual",
          provider: mapped.receipt?.provider ?? input.provider?.name ?? "unavailable",
          model: mapped.receipt?.model ?? null,
          requestId: mapped.receipt?.requestId ?? null,
          identity: {
            name: mapped.values.companyName,
            ...(mapped.values.website
              ? { domain: new URL(mapped.values.website).hostname }
              : {}),
          },
          grounded: isCompanyNameGroundedInExcerpt(
            mapped.values.companyName,
            item.excerpt,
          ),
        }),
      );
    } else {
      results.push(
        identityReceipt({
          item,
          semantic: "unavailable",
          reason: mapped.reason,
          provider: mapped.receipt?.provider ?? input.provider?.name ?? "unavailable",
          model: mapped.receipt?.model ?? null,
          requestId: mapped.receipt?.requestId ?? null,
        }),
      );
    }
  }
  return {
    queue: applyDiscoveryInterpretationProgress(claimed, {
      claimed: [],
      results,
      calls,
      status:
        claimed.pending.filter(
          (item) => !plan.items.some((claimedItem) => claimedItem.observationId === item.observationId),
        ).length > 0
          ? "pending"
          : "completed",
    }),
    resolved,
  };
}

function readInterpretationQueue(value: unknown): DiscoveryInterpretationQueue {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const pending = Array.isArray(record.pending)
    ? (record.pending as DiscoveryInterpretationItem[])
    : [];
  return {
    ...emptyDiscoveryInterpretationQueue(),
    ...record,
    pending,
    done: Array.isArray(record.done)
      ? (record.done as DiscoveryInterpretationQueue["done"])
      : [],
    inFlight: Array.isArray(record.inFlight)
      ? (record.inFlight as DiscoveryInterpretationItem[])
      : [],
    calls: typeof record.calls === "number" ? record.calls : 0,
    inputTokens: typeof record.inputTokens === "number" ? record.inputTokens : 0,
    outputTokens: typeof record.outputTokens === "number" ? record.outputTokens : 0,
    claimedAt: typeof record.claimedAt === "string" ? record.claimedAt : null,
    status:
      record.status === "cancelled" ||
      record.status === "completed" ||
      record.status === "unavailable" ||
      record.status === "ceiling" ||
      record.status === "continuing"
        ? record.status
        : "pending",
    lastError: typeof record.lastError === "string" ? record.lastError : null,
  };
}

function hasOpenInterpretationQueue(outcomes: Record<string, unknown>) {
  return Object.values(outcomes).some((value) => {
    const interpretation = asRecord(value).interpretation;
    if (
      !interpretation ||
      typeof interpretation !== "object" ||
      Array.isArray(interpretation)
    )
      return false;
    const queue = readInterpretationQueue(interpretation);
    return (
      queue.status === "pending" ||
      queue.status === "continuing" ||
      queue.pending.length > 0 ||
      queue.inFlight.length > 0
    );
  });
}

export async function listPendingDiscoveryInterpretationJobs(input?: {
  limit?: number;
}): Promise<
  Array<{
    jobId: string;
    sourceKey: string;
    attemptToken: string;
    attemptGeneration: number;
  }>
> {
  const db = getDb();
  if (!db) return [];
  const limit = Math.min(Math.max(input?.limit ?? 25, 1), 25);
  const rows = await db
    .select({
      scheduledJobId: scheduledJob.scheduledJobId,
      attemptToken: scheduledJob.attemptToken,
      attempts: scheduledJob.attempts,
      status: scheduledJob.status,
      result: scheduledJob.result,
    })
    .from(scheduledJob)
    .where(
      sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
        and ${scheduledJob.status} in ('running', 'cancel_requested')
        and ${scheduledJob.attemptToken} is not null`,
    )
    .limit(200);
  const events: Array<{
    jobId: string;
    sourceKey: string;
    attemptToken: string;
    attemptGeneration: number;
  }> = [];
  for (const row of rows) {
    if (!row.attemptToken) continue;
    if (
      row.status !== "cancel_requested" &&
      !readDiscoveryInterpretationBudget(row.result).costReceiptAvailable
    )
      continue;
    const outcomes = asRecord(asRecord(row.result).sourceOutcomes);
    if (row.status === "cancel_requested") {
      const sources = Object.entries(outcomes);
      const selected =
        sources.find(([, value]) => {
          const queue = readInterpretationQueue(asRecord(value).interpretation);
          return ![
            "ceiling",
            "unavailable",
            "cancelled",
            "completed",
          ].includes(queue.status);
        }) ?? sources[0];
      if (!selected) continue;
      events.push({
        jobId: row.scheduledJobId,
        sourceKey: selected[0],
        attemptToken: row.attemptToken,
        attemptGeneration: row.attempts,
      });
      if (events.length >= limit) return events;
      continue;
    }
    for (const [sourceKey, value] of Object.entries(outcomes)) {
      const queue = readInterpretationQueue(asRecord(value).interpretation);
      if (
        queue.status === "unavailable" ||
        queue.status === "cancelled" ||
        queue.status === "completed"
      )
        continue;
      if (queue.pending.length === 0 && queue.inFlight.length === 0) continue;
      events.push({
        jobId: row.scheduledJobId,
        sourceKey,
        attemptToken: row.attemptToken,
        attemptGeneration: row.attempts,
      });
      if (events.length >= limit) return events;
    }
  }
  return events;
}

export async function continuePendingDiscoveryInterpretationJobs() {
  if (!isDiscoveryExecutionEnabled()) {
    return { status: "execution_disabled", results: [] };
  }
  const pending = await listPendingDiscoveryInterpretationJobs({ limit: 5 });
  const results: Array<{
    jobId: string;
    sourceKey: string;
    status: string;
    remaining: number;
  }> = [];
  for (const event of pending) {
    const result = await runDiscoveryInterpretationJob(event);
    results.push({
      jobId: event.jobId,
      sourceKey: event.sourceKey,
      status: result.status,
      remaining: result.remaining,
    });
  }
  return { status: pending.length ? "continued" : "idle", results };
}

export async function runDiscoveryInterpretationJob(input: {
  jobId: string;
  sourceKey: string;
  attemptToken: string;
  attemptGeneration: number;
  provider?: LLMProvider;
}): Promise<{ status: string; remaining: number }> {
  if (!isDiscoveryExecutionEnabled()) {
    return { status: "execution_disabled", remaining: 0 };
  }
  const db = getDb();
  if (!db) return { status: "unavailable", remaining: 0 };
  const route = resolveDiscoveryInterpretationRoute();
  const liveReady = isDiscoveryExecutionEnabled() && route.status === "ready";
  let provider = input.provider;
  const tickUsage = { inputTokens: 0, outputTokens: 0 };
  let currentObservationId: string | null = null;
  if (!provider && liveReady && route.status === "ready") {
    try {
      const cap = Number(process.env.LLM_MONTHLY_CAP_AED);
      provider = createLiveDiscoveryInterpretationProvider({
        model: route.model,
        onCost: async (event) => {
          await persistDiscoveryInterpretationCost(event, {
            jobId: input.jobId,
            sourceKey: input.sourceKey,
            attemptGeneration: input.attemptGeneration,
            observationId: currentObservationId,
          });
          tickUsage.inputTokens += event.inputTokens;
          tickUsage.outputTokens += event.outputTokens;
        },
        getMonthlySpendAed: discoveryMonthlySpendAed,
        monthlyCapAed: cap,
      });
    } catch {
      provider = undefined;
    }
  }
  const loaded = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(scheduledJob)
      .where(
        and(
          eq(scheduledJob.scheduledJobId, input.jobId),
          eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) return null;
    if (
      job.attemptToken !== input.attemptToken ||
      job.attempts !== input.attemptGeneration
    )
      return { blocked: true as const, reason: "RUN_ATTEMPT_MISMATCH" };
    const payload = DiscoveryRunPayloadV1Schema.safeParse(job.payload);
    const result = (job.result ?? {}) as Record<string, unknown>;
    const outcomes =
      result.sourceOutcomes && typeof result.sourceOutcomes === "object"
        ? { ...(result.sourceOutcomes as Record<string, unknown>) }
        : {};
    const source = asRecord(outcomes[input.sourceKey]);
    const queue = readInterpretationQueue(source.interpretation);
    const cancelled = job.status === "cancel_requested";
    const budget = readDiscoveryInterpretationBudget(result);
    if (!budget.costReceiptAvailable && !cancelled)
      return { blocked: true as const, reason: "DISCOVERY_COST_RECEIPT_UNAVAILABLE" };
    const remaining = remainingDiscoveryInterpretationBudgetForQueue(
      budget,
      [...queue.inFlight, ...queue.pending].map((item) => item.observationId),
    );
    let planned = planDiscoveryInterpretationTick({
      queue,
      cancelled,
      providerAvailable: Boolean(provider),
      remainingCalls: remaining.calls,
      remainingTokens: remaining.tokens,
    });
    let claimedQueue = queue;
    let nextBudget = budget;
    if (planned.action === "uncertain") {
      const uncertainItems = planned.items;
      claimedQueue = applyDiscoveryInterpretationProgress(queue, {
        claimed: [],
        results: uncertainItems.map((item) =>
          identityReceipt({
            item,
            semantic: "unavailable",
            reason: "INTERPRETATION_OUTCOME_UNCERTAIN",
          }),
        ),
        status:
          queue.pending.filter(
            (item) =>
              !uncertainItems.some(
                (uncertain) => uncertain.observationId === item.observationId,
              ),
          ).length > 0
            ? "pending"
            : "unavailable",
        lastError: "INTERPRETATION_OUTCOME_UNCERTAIN",
      });
      outcomes[input.sourceKey] = { ...source, interpretation: claimedQueue };
      await tx
        .update(scheduledJob)
        .set({
          result: writeDiscoveryInterpretationBudget(
            { ...result, sourceOutcomes: outcomes },
            nextBudget,
          ),
          updatedAt: new Date(),
        })
        .where(eq(scheduledJob.scheduledJobId, input.jobId));
    } else if (planned.action === "claim") {
      const reserved = reserveDiscoveryInterpretationBudget(
        budget,
        planned.items.map((item) => item.observationId),
      );
      if (!reserved.ok) {
        planned = { action: "ceiling" };
      } else {
        nextBudget = reserved.budget;
        claimedQueue = applyDiscoveryInterpretationProgress(queue, {
          claimed: planned.items,
          status: "continuing",
        });
        outcomes[input.sourceKey] = { ...source, interpretation: claimedQueue };
        await tx
          .update(scheduledJob)
          .set({
            result: writeDiscoveryInterpretationBudget(
              { ...result, sourceOutcomes: outcomes },
              nextBudget,
            ),
            updatedAt: new Date(),
          })
          .where(eq(scheduledJob.scheduledJobId, input.jobId));
      }
    }
    return {
      cancelled,
      open: job.status === "running",
      queue: claimedQueue,
      plan: planned,
      configuration:
        payload.success
          ? payload.data.effective?.sources.find(
              (item) => item.sourceKey === input.sourceKey,
            )?.configuration ?? {}
          : {},
      ownerEmployeeId: payload.success
        ? payload.data.effective?.runtime.ownerEmployeeId
        : undefined,
      reviewerEmployeeIds: payload.success
        ? reviewerIdsFromEffective(payload.data.effective)
        : [],
      programmeId: job.researchProgrammeId,
      remaining,
    };
  });
  if (!loaded || "blocked" in loaded) return { status: "blocked", remaining: 0 };
  if (!loaded.open && !loaded.cancelled)
    return { status: "not_open", remaining: loaded.queue.pending.length };
  let progressed =
    loaded.plan.action === "busy" || loaded.plan.action === "uncertain"
      ? { queue: loaded.queue, resolved: [] }
      : await continueDiscoveryInterpretationQueue({
          queue: loaded.queue,
          cancelled: loaded.cancelled,
          provider,
          providerAvailable: Boolean(provider),
          sourceKey: input.sourceKey,
          configuration: loaded.configuration,
          ignoreBusy: loaded.plan.action === "claim",
          remainingCalls:
            loaded.plan.action === "claim"
              ? loaded.plan.items.length
              : loaded.remaining.calls,
          remainingTokens:
            loaded.plan.action === "claim"
              ? loaded.plan.items.length *
                DISCOVERY_INTERPRETATION_RESERVED_TOKENS_PER_CALL
              : loaded.remaining.tokens,
          onObservationStart: (observationId) => {
            currentObservationId = observationId;
          },
        });
  if (tickUsage.inputTokens || tickUsage.outputTokens) {
    progressed = {
      ...progressed,
      queue: {
        ...progressed.queue,
        inputTokens: progressed.queue.inputTokens + tickUsage.inputTokens,
        outputTokens: progressed.queue.outputTokens + tickUsage.outputTokens,
      },
    };
  }
  const resolvedEvaluations = new Map<
    string,
    Awaited<ReturnType<typeof evaluateDiscoveryEvidence>>
  >();
  for (const values of progressed.resolved) {
    const identityLineage = progressed.queue.done.find(
      (item) => item.observationId === values.requestId,
    );
    resolvedEvaluations.set(
      values.requestId,
      await evaluateDiscoveryEvidence({
        opportunityKind: values.opportunityKind,
        excerpt: values.excerpt,
        whyNow: values.whyNow,
        eventDate: values.eventDate,
        visibilityScope: values.visibilityScope ?? "public",
        companyName: values.companyName,
        website: values.website,
        sourceUrl: values.sourceUrl,
        evidenceId: values.requestId,
        sourceKey: values.sourceKey,
        route: "automated",
        identityLineage,
      }),
    );
  }
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(scheduledJob)
      .where(
        and(
          eq(scheduledJob.scheduledJobId, input.jobId),
          eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) return;
    if (
      job.attemptToken !== input.attemptToken ||
      job.attempts !== input.attemptGeneration
    )
      return;
    const cancelledNow = job.status === "cancel_requested";
    if (
      loaded.programmeId &&
      loaded.ownerEmployeeId &&
      job.status === "running"
    ) {
      for (const values of progressed.resolved) {
        await ingestCollectorObservationTx(tx, {
          actorEmployeeId: loaded.ownerEmployeeId,
          ownerEmployeeId: loaded.ownerEmployeeId,
          reviewerEmployeeIds: loaded.reviewerEmployeeIds,
          programmeId: loaded.programmeId,
          scheduledJobId: input.jobId,
          values,
          evaluation: resolvedEvaluations.get(values.requestId),
        });
      }
    }
    const result = (job.result ?? {}) as Record<string, unknown>;
    const outcomes =
      result.sourceOutcomes && typeof result.sourceOutcomes === "object"
        ? { ...(result.sourceOutcomes as Record<string, unknown>) }
        : {};
    const queueToPersist = cancelledNow
      ? applyDiscoveryInterpretationProgress(progressed.queue, {
          claimed: [],
          results: [
            ...progressed.queue.pending,
            ...progressed.queue.inFlight,
          ].map((item) =>
            identityReceipt({
              item,
              semantic: "unavailable",
              reason: "RUN_CANCEL_REQUESTED",
            }),
          ),
          status: "cancelled",
          lastError: "RUN_CANCEL_REQUESTED",
        })
      : progressed.queue;
    outcomes[input.sourceKey] = {
      ...asRecord(outcomes[input.sourceKey]),
      interpretation: queueToPersist,
    };
    const settled = settleDiscoveryInterpretationBudget(
      readDiscoveryInterpretationBudget(result),
      {
        calls: queueToPersist.calls - loaded.queue.calls,
        tokens: tickUsage.inputTokens + tickUsage.outputTokens,
      },
    );
    if (queueToPersist.lastError === "DISCOVERY_COST_RECEIPT_UNAVAILABLE")
      settled.costReceiptAvailable = false;
    const providerTerminalStatus = result.providerTerminalStatus;
    const terminalQueue =
      queueToPersist.status === "completed" ||
      queueToPersist.status === "unavailable" ||
      queueToPersist.status === "ceiling" ||
      queueToPersist.status === "cancelled";
    const allowedTerminal = cancelledNow
      ? true
      : providerTerminalStatus === "completed" ||
        providerTerminalStatus === "partial" ||
        providerTerminalStatus === "failed" ||
        providerTerminalStatus === "cancelled";
    const terminal: string | null =
      terminalQueue &&
      !hasOpenInterpretationQueue(outcomes) &&
      allowedTerminal &&
      (cancelledNow || settled.costReceiptAvailable)
        ? cancelledNow
          ? "cancelled"
          : String(providerTerminalStatus)
        : null;
    const now = new Date();
    await tx
      .update(scheduledJob)
      .set({
        result: writeDiscoveryInterpretationBudget(
          { ...result, sourceOutcomes: outcomes },
          settled,
        ),
        lastError: resolveDiscoveryInterpretationJobLastError({
          queueLastError: queueToPersist.lastError,
          costReceiptAvailable: settled.costReceiptAvailable,
          cancelled: cancelledNow,
        }),
        ...(terminal
          ? {
              status: terminal,
              completedAt: now,
              attemptToken: null,
              leaseExpiresAt: null,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(scheduledJob.scheduledJobId, input.jobId));
    if (terminal && job.researchProgrammeId)
      await promoteDeferredAfterTerminalTx(tx, job.researchProgrammeId, now);
  });
  return {
    status: progressed.queue.status,
    remaining: progressed.queue.pending.length + progressed.queue.inFlight.length,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
