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
  createLiveDiscoveryInterpretationProvider,
  discoveryMonthlySpendAed,
  persistDiscoveryInterpretationCost,
  resolveDiscoveryInterpretationRoute,
  resolvePublicDiscoveryCompanyIdentity,
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
  | { ok: false; reason: string };

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
  done: Array<{ observationId: string; status: string; reason?: string }>;
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
}):
  | { action: "done" }
  | { action: "cancel" }
  | { action: "unavailable"; reason: string }
  | { action: "ceiling" }
  | { action: "busy" }
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
  }
  const elapsed = nowMs - (input.startedAtMs ?? nowMs);
  if (elapsed >= DISCOVERY_INTERPRETATION_MAX_MS_PER_TICK)
    return { action: "ceiling" };
  if (
    input.queue.calls >= DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB ||
    input.queue.inputTokens + input.queue.outputTokens >=
      DISCOVERY_INTERPRETATION_MAX_TOKENS_PER_JOB
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
  const remainingCalls =
    DISCOVERY_INTERPRETATION_MAX_CALLS_PER_JOB - input.queue.calls;
  if (remainingCalls <= 0) return { action: "ceiling" };
  return {
    action: "claim",
    items: unique.slice(
      0,
      Math.min(DISCOVERY_INTERPRETATION_BATCH_SIZE, remainingCalls),
    ),
  };
}

export function applyDiscoveryInterpretationProgress(
  queue: DiscoveryInterpretationQueue,
  update: {
    claimed?: DiscoveryInterpretationItem[];
    results?: Array<{ observationId: string; status: string; reason?: string }>;
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
    done: [...queue.done, ...(update.results ?? [])],
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
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  return mapDiscoveryObservationToSubmit(
    observation,
    sourceKey,
    configuration,
    resolved,
  );
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
  });
  if (plan.action === "busy")
    return { queue: input.queue, resolved: [] };
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
        results: [...input.queue.pending, ...input.queue.inFlight].map((item) => ({
          observationId: item.observationId,
          status: "cancelled",
          reason: "RUN_CANCEL_REQUESTED",
        })),
        status: "cancelled",
        lastError: "RUN_CANCEL_REQUESTED",
      }),
      resolved: [],
    };
  if (plan.action === "unavailable")
    return {
      queue: applyDiscoveryInterpretationProgress(input.queue, {
        claimed: [],
        results: [...input.queue.pending, ...input.queue.inFlight].map((item) => ({
          observationId: item.observationId,
          status: "unavailable",
          reason: plan.reason,
        })),
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
  const results: Array<{ observationId: string; status: string; reason?: string }> =
    [];
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
      const retry = plan.items.filter(
        (pending) =>
          !results.some((done) => done.observationId === pending.observationId),
      );
      const progressed = applyDiscoveryInterpretationProgress(claimed, {
        claimed: [],
        results,
        calls,
        status: "pending",
        lastError: "DISCOVERY_COST_RECEIPT_UNAVAILABLE",
      });
      return {
        queue: {
          ...progressed,
          pending: [...progressed.pending, ...retry],
          inFlight: [],
          claimedAt: null,
        },
        resolved,
      };
    }
    if (mapped.ok) {
      resolved.push(mapped.values);
      results.push({ observationId: item.observationId, status: "resolved" });
    } else {
      results.push({
        observationId: item.observationId,
        status: "unresolved",
        reason: mapped.reason,
      });
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
    const outcomes = asRecord(asRecord(row.result).sourceOutcomes);
    for (const [sourceKey, value] of Object.entries(outcomes)) {
      const queue = readInterpretationQueue(asRecord(value).interpretation);
      if (
        queue.status === "ceiling" ||
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
    const planned = planDiscoveryInterpretationTick({
      queue,
      cancelled,
      providerAvailable: Boolean(provider),
    });
    let claimedQueue = queue;
    if (planned.action === "claim") {
      claimedQueue = applyDiscoveryInterpretationProgress(queue, {
        claimed: planned.items,
        status: "continuing",
      });
      outcomes[input.sourceKey] = { ...source, interpretation: claimedQueue };
      await tx
        .update(scheduledJob)
        .set({
          result: { ...result, sourceOutcomes: outcomes },
          updatedAt: new Date(),
        })
        .where(eq(scheduledJob.scheduledJobId, input.jobId));
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
    };
  });
  if (!loaded || "blocked" in loaded) return { status: "blocked", remaining: 0 };
  if (!loaded.open && !loaded.cancelled)
    return { status: "not_open", remaining: loaded.queue.pending.length };
  let progressed =
    loaded.plan.action === "busy"
      ? { queue: loaded.queue, resolved: [] }
      : await continueDiscoveryInterpretationQueue({
          queue: loaded.queue,
          cancelled: loaded.cancelled,
          provider,
          providerAvailable: Boolean(provider),
          sourceKey: input.sourceKey,
          configuration: loaded.configuration,
          ignoreBusy: loaded.plan.action === "claim",
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
    if (job.status === "cancel_requested") return;
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
        });
      }
    }
    const result = (job.result ?? {}) as Record<string, unknown>;
    const outcomes =
      result.sourceOutcomes && typeof result.sourceOutcomes === "object"
        ? { ...(result.sourceOutcomes as Record<string, unknown>) }
        : {};
    outcomes[input.sourceKey] = {
      ...asRecord(outcomes[input.sourceKey]),
      interpretation: progressed.queue,
    };
    const providerTerminalStatus = result.providerTerminalStatus;
    const terminalQueue =
      progressed.queue.status === "completed" ||
      progressed.queue.status === "unavailable" ||
      progressed.queue.status === "ceiling" ||
      progressed.queue.status === "cancelled";
    const terminal =
      terminalQueue &&
      !hasOpenInterpretationQueue(outcomes) &&
      (providerTerminalStatus === "completed" ||
        providerTerminalStatus === "partial" ||
        providerTerminalStatus === "failed" ||
        providerTerminalStatus === "cancelled")
        ? providerTerminalStatus
        : null;
    const now = new Date();
    await tx
      .update(scheduledJob)
      .set({
        result: { ...result, sourceOutcomes: outcomes },
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
