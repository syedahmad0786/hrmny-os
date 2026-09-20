import { and, eq, integrationInbox, scheduledJob, sql } from "@hrmny/db";
import { getDb } from "../db";
import {
  ingestDiscoveryCallbackObservations,
  maxObservationsFromEffective,
  resolveDiscoveryCallbackSource,
  reviewerIdsFromEffective,
  type DiscoveryInterpretationQueue,
} from "./discovery-callback-ingest";
import { scheduleDiscoveryInterpretation } from "../inngest/discovery";
import { DiscoveryCandidateError } from "./discovery-candidates";
import {
  DiscoveryRunError,
  DiscoveryRunPayloadV1Schema,
  DISCOVERY_HEARTBEAT_LEASE_MS,
  promoteDeferredAfterTerminalTx,
  SALES_RESEARCH_RUN_JOB_KIND,
} from "./discovery-runs";
import {
  loadDiscoveryN8nCallbackKeys,
  validateDiscoveryRuntimeCallback,
  type DiscoveryRuntimeEnvelope,
} from "./discovery-runtime-contract";

const DISCOVERY_CALLBACK_PROVIDER = "n8n-discovery";

function asOutcomeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function mergeInterpretationQueue(
  previous: unknown,
  incoming?: DiscoveryInterpretationQueue,
): DiscoveryInterpretationQueue | unknown {
  if (!incoming) return previous;
  const current = asOutcomeRecord(previous);
  const pending = Array.isArray(current.pending)
    ? (current.pending as DiscoveryInterpretationQueue["pending"])
    : [];
  const seen = new Set(pending.map((item) => item.observationId));
  return {
    schemaVersion: 1,
    pending: [
      ...pending,
      ...incoming.pending.filter((item) => !seen.has(item.observationId)),
    ],
    done: Array.isArray(current.done)
      ? current.done
      : incoming.done,
    inFlight: Array.isArray(current.inFlight) ? current.inFlight : incoming.inFlight,
    calls: typeof current.calls === "number" ? current.calls : incoming.calls,
    inputTokens:
      typeof current.inputTokens === "number"
        ? current.inputTokens
        : incoming.inputTokens,
    outputTokens:
      typeof current.outputTokens === "number"
        ? current.outputTokens
        : incoming.outputTokens,
    status:
      incoming.pending.length || pending.length
        ? "pending"
        : incoming.status,
    claimedAt:
      typeof current.claimedAt === "string" || current.claimedAt === null
        ? (current.claimedAt as string | null)
        : incoming.claimedAt,
    lastError:
      typeof current.lastError === "string" || current.lastError === null
        ? current.lastError
        : incoming.lastError,
  } satisfies DiscoveryInterpretationQueue;
}

function hasPendingInterpretation(result: Record<string, unknown>) {
  const outcomes = asOutcomeRecord(result.sourceOutcomes);
  return Object.values(outcomes).some((value) => {
    const queue = asOutcomeRecord(asOutcomeRecord(value).interpretation);
    const status = queue.status;
    const pending = Array.isArray(queue.pending) ? queue.pending.length : 0;
    const inFlight = Array.isArray(queue.inFlight) ? queue.inFlight.length : 0;
    return (
      status === "pending" ||
      status === "continuing" ||
      pending > 0 ||
      inFlight > 0
    );
  });
}

export type DiscoveryCallbackAcceptResult =
  | { status: "accepted" | "replay"; eventId: string }
  | { status: "rejected"; code: string; httpStatus: number };

export function admitDiscoveryCallbackForRunStatus(input: {
  status: string;
  event: DiscoveryRuntimeEnvelope["event"];
  completionStatus?: "completed" | "partial" | "failed" | "cancelled";
}):
  | { ok: true }
  | { ok: false; code: "RUN_NOT_OPEN" | "RUN_CANCEL_REQUESTED" } {
  switch (input.status) {
    case "running":
      return { ok: true };
    case "cancel_requested":
      switch (input.event) {
        case "sales.discovery.observations.v1":
        case "sales.discovery.checkpoint.v1":
          return { ok: false, code: "RUN_CANCEL_REQUESTED" };
        case "sales.discovery.completion.v1":
          if (input.completionStatus !== "cancelled")
            return { ok: false, code: "RUN_CANCEL_REQUESTED" };
          return { ok: true };
        default: {
          const unhandled: never = input.event;
          void unhandled;
          return { ok: false, code: "RUN_CANCEL_REQUESTED" };
        }
      }
    default:
      return { ok: false, code: "RUN_NOT_OPEN" };
  }
}

function database() {
  const db = getDb();
  if (!db)
    throw new DiscoveryRunError(
      "DEPENDENCY_UNAVAILABLE",
      "DATABASE_URL is required for Discovery callbacks",
    );
  return db;
}

function rejection(
  code: string,
  httpStatus: number,
): DiscoveryCallbackAcceptResult {
  return { status: "rejected", code, httpStatus };
}

function mapValidationCode(
  code:
    | "body_too_large"
    | "missing_token"
    | "invalid_token"
    | "unknown_key"
    | "invalid_body"
    | "event_id_mismatch",
): DiscoveryCallbackAcceptResult {
  switch (code) {
    case "body_too_large":
      return rejection(code, 413);
    case "invalid_body":
      return rejection(code, 400);
    case "missing_token":
    case "invalid_token":
    case "unknown_key":
    case "event_id_mismatch":
      return rejection(code, 401);
    default: {
      const unhandled: never = code;
      return rejection(String(unhandled), 400);
    }
  }
}

function applyEnvelope(
  result: Record<string, unknown>,
  envelope: DiscoveryRuntimeEnvelope,
  bodyHash: string,
  sourceKey: string,
  ingest?: {
    ingested: number;
    duplicate: number;
    replay: number;
    quarantined: number;
    interpretation?: DiscoveryInterpretationQueue;
  },
): { result: Record<string, unknown>; terminalStatus: string | null } {
  const sourceOutcomes =
    result.sourceOutcomes && typeof result.sourceOutcomes === "object"
      ? { ...(result.sourceOutcomes as Record<string, unknown>) }
      : {};
  const previous = asOutcomeRecord(sourceOutcomes[sourceKey]);
  sourceOutcomes[sourceKey] = {
    ...previous,
    sourceKey,
    bindingId: envelope.sourceId,
    lastEvent: envelope.event,
    eventId: envelope.eventId,
    attemptGeneration: envelope.attemptGeneration,
    credentialGeneration: envelope.credentialGeneration,
    ...(ingest
      ? {
          ingest: {
            ingested: ingest.ingested,
            duplicate: ingest.duplicate,
            replay: ingest.replay,
            quarantined: ingest.quarantined,
          },
          interpretation: mergeInterpretationQueue(
            previous.interpretation,
            ingest.interpretation,
          ),
        }
      : {}),
    payload: envelope.payload,
  };
  const next = {
    ...result,
    sourceOutcomes,
    n8nClaim: result.n8nClaim ?? {
      executionId: envelope.eventId,
      eventId: envelope.eventId,
      bodyHash,
      claimedAt: new Date().toISOString(),
    },
  };
  switch (envelope.event) {
    case "sales.discovery.observations.v1":
    case "sales.discovery.checkpoint.v1":
      return { result: next, terminalStatus: null };
    case "sales.discovery.completion.v1": {
      const completed = {
        ...next,
        outcome: envelope.payload.status,
        providerTerminalStatus: envelope.payload.status,
      };
      return {
        result: completed,
        terminalStatus: hasPendingInterpretation(completed)
          ? null
          : envelope.payload.status,
      };
    }
    default: {
      const unhandled: never = envelope;
      throw new DiscoveryRunError(
        "UNSUPPORTED_EVENT",
        `Unhandled discovery callback: ${String(unhandled)}`,
      );
    }
  }
}

export async function acceptDiscoveryRuntimeCallback(input: {
  rawBody: string;
  headers: Pick<Headers, "get">;
}): Promise<DiscoveryCallbackAcceptResult> {
  const keys = loadDiscoveryN8nCallbackKeys();
  if (!keys) return rejection("CALLBACK_KEYS_UNAVAILABLE", 503);
  const validated = validateDiscoveryRuntimeCallback({
    rawBody: input.rawBody,
    headers: input.headers,
    keys,
  });
  if (!validated.ok) return mapValidationCode(validated.code);
  const envelope = validated.envelope;
  try {
    const accepted = await database().transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(integrationInbox)
        .where(
          and(
            eq(integrationInbox.provider, DISCOVERY_CALLBACK_PROVIDER),
            eq(integrationInbox.externalEventId, envelope.eventId),
          ),
        )
        .limit(1)
        .for("update");
      if (existing) {
        if (existing.payloadHash !== validated.bodyHash)
          return rejection("EVENT_ID_REPLAY_CONFLICT", 409);
        return { status: "replay" as const, eventId: envelope.eventId };
      }
      const [job] = await tx
        .select()
        .from(scheduledJob)
        .where(
          and(
            eq(scheduledJob.scheduledJobId, envelope.runId),
            eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
          ),
        )
        .limit(1)
        .for("update");
      if (!job) return rejection("RUN_NOT_FOUND", 404);
      if (
        !job.attemptToken ||
        job.attemptToken !== envelope.attemptToken ||
        job.attempts !== envelope.attemptGeneration
      )
        return rejection("RUN_ATTEMPT_MISMATCH", 409);
      const admission = admitDiscoveryCallbackForRunStatus({
        status: job.status,
        event: envelope.event,
        completionStatus:
          envelope.event === "sales.discovery.completion.v1"
            ? envelope.payload.status
            : undefined,
      });
      if (!admission.ok) return rejection(admission.code, 409);
      const payload = DiscoveryRunPayloadV1Schema.safeParse(job.payload);
      if (!payload.success) return rejection("RUN_FENCE_MISSING", 409);
      const resolved = resolveDiscoveryCallbackSource(
        payload.data.effective,
        envelope.sourceId,
        envelope.credentialGeneration,
      );
      if (!resolved.ok) return rejection(resolved.code, 409);
      const now = new Date();
      let ingest:
        | {
            ingested: number;
            duplicate: number;
            replay: number;
            quarantined: number;
            interpretation: DiscoveryInterpretationQueue;
          }
        | undefined;
      if (
        job.status === "running" &&
        envelope.event === "sales.discovery.observations.v1"
      ) {
        if (!job.researchProgrammeId)
          return rejection("RUN_PROGRAMME_MISSING", 409);
        ingest = await ingestDiscoveryCallbackObservations({
          tx,
          envelope,
          sourceKey: resolved.source.sourceKey,
          configuration: resolved.source.configuration,
          ownerEmployeeId: payload.data.effective!.runtime.ownerEmployeeId,
          reviewerEmployeeIds: reviewerIdsFromEffective(payload.data.effective),
          programmeId: job.researchProgrammeId,
          maxObservations: maxObservationsFromEffective(payload.data.effective),
        });
      }
      const applied = applyEnvelope(
        (job.result ?? {}) as Record<string, unknown>,
        envelope,
        validated.bodyHash,
        resolved.source.sourceKey,
        ingest,
      );
      const terminal =
        job.status === "cancel_requested"
          ? "cancelled"
          : applied.terminalStatus;
      const leaseExpiresAt =
        terminal || !job.overallDeadlineAt
          ? null
          : new Date(
              Math.min(
                job.overallDeadlineAt.getTime(),
                now.getTime() + DISCOVERY_HEARTBEAT_LEASE_MS,
              ),
            );
      await tx.insert(integrationInbox).values({
        provider: DISCOVERY_CALLBACK_PROVIDER,
        externalEventId: envelope.eventId,
        operation: envelope.event,
        payloadHash: validated.bodyHash,
        payload: envelope as unknown as Record<string, unknown>,
        status: "completed",
        processedAt: now,
        result: {
          runId: envelope.runId,
          sourceId: envelope.sourceId,
          sourceKey: resolved.source.sourceKey,
          ...(ingest ? { ingest } : {}),
        },
      });
      await tx
        .update(scheduledJob)
        .set({
          result: applied.result,
          ...(terminal
            ? {
                status: terminal,
                completedAt: now,
                attemptToken: null,
                leaseExpiresAt: null,
              }
            : { leaseExpiresAt }),
          stateVersion: sql`${scheduledJob.stateVersion} + 1`,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(scheduledJob.scheduledJobId, job.scheduledJobId));
      if (terminal && job.researchProgrammeId)
        await promoteDeferredAfterTerminalTx(
          tx,
          job.researchProgrammeId,
          now,
        );
      return {
        status: "accepted" as const,
        eventId: envelope.eventId,
        scheduleInterpretation: Boolean(
          ingest?.interpretation && ingest.interpretation.pending.length > 0,
        ),
        jobId: envelope.runId,
        sourceKey: resolved.source.sourceKey,
        attemptToken: envelope.attemptToken,
        attemptGeneration: envelope.attemptGeneration,
      };
    });
    if (
      accepted.status === "accepted" &&
      "scheduleInterpretation" in accepted &&
      accepted.scheduleInterpretation
    )
      await scheduleDiscoveryInterpretation({
        jobId: accepted.jobId,
        sourceKey: accepted.sourceKey,
        attemptToken: accepted.attemptToken,
        attemptGeneration: accepted.attemptGeneration,
      });
    return accepted.status === "accepted" || accepted.status === "replay"
      ? { status: accepted.status, eventId: accepted.eventId }
      : accepted;
  } catch (error) {
    if (error instanceof DiscoveryRunError) {
      const httpStatus =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "DEPENDENCY_UNAVAILABLE"
            ? 503
            : error.code === "FORBIDDEN"
              ? 403
              : 409;
      return rejection(error.code, httpStatus);
    }
    if (error instanceof DiscoveryCandidateError) {
      const httpStatus =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "INVALID_INPUT"
              ? 400
              : 409;
      return rejection(error.code, httpStatus);
    }
    return rejection("DISCOVERY_CALLBACK_FAILED", 503);
  }
}
