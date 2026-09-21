import { randomUUID } from "node:crypto";
import { and, eq, researchProgramme, scheduledJob, sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import {
  getDiscoveryProgramme,
  listDiscoveryProgrammes,
  publishDiscoveryProgramme,
  reconnectDiscoverySource,
  saveDiscoveryProgrammeDraft,
} from "./discovery-programmes";
import {
  DiscoveryCheckpointSchema,
} from "./discovery-runtime-contract";
import {
  getDiscoveryRun,
  getMemoryDiscoveryRun,
  listMemoryDiscoveryRuns,
  recordMemoryDiscoverySourceOutcomes,
} from "./discovery-run-queries";
import {
  DiscoveryRunError,
  SALES_RESEARCH_RUN_JOB_KIND,
  isDiscoveryExecutionEnabled,
} from "./discovery-runs";

export const DISCOVERY_SOURCE_OUTCOME_STATES = [
  "completed",
  "failed",
  "partial",
  "retry_queued",
] as const;

export const discoverySourceOutcomeSchema = z
  .object({
    sourceKey: z.string().min(1).max(80),
    status: z.enum(DISCOVERY_SOURCE_OUTCOME_STATES),
    lastEvent: z.string().max(120).nullable(),
    checkpoint: DiscoveryCheckpointSchema.nullable(),
    retryable: z.boolean(),
    retryCount: z.number().int().nonnegative().max(100),
    lastError: z.string().max(500).nullable(),
  })
  .strict();

export const discoveryBudgetReservationSchema = z
  .object({
    reservationId: z.string().uuid(),
    sourceKey: z.string().min(1).max(80),
    state: z.enum(["reserved", "pending_unknown", "settled", "released"]),
    units: z.number().nonnegative(),
    unitKind: z.enum(["request", "credit", "token"]),
    paidCallAuthorized: z.literal(false),
    createdAt: z.string(),
  })
  .strict();

export type DiscoverySourceOutcome = z.infer<
  typeof discoverySourceOutcomeSchema
>;
export type DiscoveryBudgetReservation = z.infer<
  typeof discoveryBudgetReservationSchema
>;

export class DiscoveryControlError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CONFLICT"
      | "INVALID_STATE"
      | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryControlError";
  }
}

type PolicySuggestion = {
  suggestionId: string;
  programmeId: string;
  kind: "max_observations";
  maxObservations: number;
  reason: string;
  status: "proposed" | "accepted" | "rejected";
  appliedVersion: number | null;
};

const policySuggestions = new Map<string, PolicySuggestion>();
const retryLocks = new Map<string, Promise<void>>();

export function resetMemoryDiscoveryControl() {
  policySuggestions.clear();
}

function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = retryLocks.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  retryLocks.set(key, tail);
  return run;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseOutcome(
  sourceKey: string,
  value: unknown,
): DiscoverySourceOutcome | null {
  const parsed = discoverySourceOutcomeSchema.safeParse({
    ...asRecord(value),
    sourceKey,
  });
  return parsed.success ? parsed.data : null;
}

function parseOutcomes(raw: Record<string, unknown>) {
  const outcomes: Record<string, DiscoverySourceOutcome> = {};
  for (const [sourceKey, value] of Object.entries(raw)) {
    const parsed = parseOutcome(sourceKey, value);
    if (parsed) outcomes[sourceKey] = parsed;
  }
  return outcomes;
}

function parseReservations(raw: Record<string, unknown>) {
  const reservations: Record<string, DiscoveryBudgetReservation> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = discoveryBudgetReservationSchema.safeParse(value);
    if (parsed.success) reservations[key] = parsed.data;
  }
  return reservations;
}

function pushRetryItems(
  items: Array<{
    id: string;
    kind: "source_retry" | "source_reconnect" | "source_blocked" | "policy_suggestion";
    programmeId: string;
    runId: string | null;
    sourceKey: string;
    title: string;
    reason: string;
  }>,
  runId: string,
  programmeId: string,
  rawOutcomes: Record<string, unknown>,
) {
  for (const outcome of Object.values(parseOutcomes(rawOutcomes))) {
    if (outcome.status !== "failed" || !outcome.retryable || !outcome.checkpoint)
      continue;
    items.push({
      id: `${runId}:${outcome.sourceKey}:retry`,
      kind: "source_retry",
      programmeId,
      runId,
      sourceKey: outcome.sourceKey,
      title: outcome.sourceKey.replaceAll("_", " "),
      reason:
        outcome.lastError ??
        "Failed source can resume from its saved checkpoint",
    });
  }
}

export function recordDiscoverySourceOutcomesForTest(
  runId: string,
  outcomes: DiscoverySourceOutcome[],
) {
  const recorded: Record<string, unknown> = {};
  for (const outcome of outcomes) {
    recorded[outcome.sourceKey] = discoverySourceOutcomeSchema.parse(outcome);
  }
  recordMemoryDiscoverySourceOutcomes(runId, recorded);
}

export async function listDiscoveryControlQueue(input: {
  actorEmployeeId: string;
  isAdmin: boolean;
}) {
  const programmes = await listDiscoveryProgrammes(input);
  const items: Array<{
    id: string;
    kind: "source_retry" | "source_reconnect" | "source_blocked" | "policy_suggestion";
    programmeId: string;
    runId: string | null;
    sourceKey: string;
    title: string;
    reason: string;
  }> = [];
  for (const programme of programmes) {
    const detail = await getDiscoveryProgramme({
      programmeId: programme.id,
      actorEmployeeId: input.actorEmployeeId,
      isAdmin: input.isAdmin,
    });
    for (const blocker of detail.readiness.blockers) {
      if (!blocker.sourceKey || blocker.code === "EXECUTION_DISABLED") continue;
      items.push({
        id: `${programme.id}:${blocker.sourceKey}:${blocker.code}`,
        kind:
          blocker.code === "SOURCE_CONNECTION_REQUIRED"
            ? "source_reconnect"
            : "source_blocked",
        programmeId: programme.id,
        runId: null,
        sourceKey: blocker.sourceKey,
        title: blocker.sourceKey.replaceAll("_", " "),
        reason: blocker.message,
      });
    }
  }
  const db = getDb();
  if (!db) {
    for (const run of listMemoryDiscoveryRuns().filter(
      (run) =>
        input.isAdmin ||
        run.ownerEmployeeId === input.actorEmployeeId ||
        run.reviewerEmployeeIds.includes(input.actorEmployeeId),
    )) {
      pushRetryItems(items, run.runId, run.programmeId, run.sourceOutcomes);
    }
  } else {
    const access = input.isAdmin
      ? undefined
      : sql`(${researchProgramme.ownerEmployeeId} = ${input.actorEmployeeId}::uuid or ${input.actorEmployeeId}::uuid = any(${researchProgramme.reviewerEmployeeIds}::uuid[]))`;
    const predicates = [
      eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
      access,
    ].filter(Boolean);
    const rows = await db
      .select({
        runId: scheduledJob.scheduledJobId,
        programmeId: scheduledJob.researchProgrammeId,
        result: scheduledJob.result,
      })
      .from(scheduledJob)
      .innerJoin(
        researchProgramme,
        eq(
          scheduledJob.researchProgrammeId,
          researchProgramme.researchProgrammeId,
        ),
      )
      .where(and(...predicates));
    for (const row of rows) {
      if (!row.programmeId) continue;
      pushRetryItems(
        items,
        row.runId,
        row.programmeId,
        asRecord(asRecord(row.result).sourceOutcomes),
      );
    }
  }
  const visibleProgrammeIds = new Set(programmes.map((programme) => programme.id));
  for (const suggestion of policySuggestions.values()) {
    if (suggestion.status !== "proposed") continue;
    if (!input.isAdmin && !visibleProgrammeIds.has(suggestion.programmeId))
      continue;
    items.push({
      id: suggestion.suggestionId,
      kind: "policy_suggestion",
      programmeId: suggestion.programmeId,
      runId: null,
      sourceKey: suggestion.kind,
      title: "Observation cap suggestion",
      reason: suggestion.reason,
    });
  }
  return {
    executionEnabled: isDiscoveryExecutionEnabled(),
    collectorStarted: false as const,
    items,
    health: {
      retryableFailures: items.filter((item) => item.kind === "source_retry")
        .length,
      reconnects: items.filter((item) => item.kind === "source_reconnect")
        .length,
      blockedRequired: items.filter((item) => item.kind === "source_blocked")
        .length,
      policySuggestions: items.filter((item) => item.kind === "policy_suggestion")
        .length,
    },
  };
}

export async function retryDiscoverySource(input: {
  runId: string;
  sourceKey: string;
  actorEmployeeId: string;
  isAdmin: boolean;
  requestId: string;
}) {
  return withLock(`${input.runId}:${input.sourceKey}`, async () => {
    const run = await getDiscoveryRun({
      runId: input.runId,
      actorEmployeeId: input.actorEmployeeId,
      isAdmin: input.isAdmin,
    });
    const db = getDb();
    if (!db) {
      const memory = getMemoryDiscoveryRun(input.runId);
      if (!memory) throw new DiscoveryControlError("NOT_FOUND", "RUN_NOT_FOUND");
      return applyRetry(memory.sourceOutcomes, memory.budgetReservations, input, {
        persist(outcomes, reservations) {
          memory.sourceOutcomes = outcomes;
          memory.budgetReservations = reservations;
          memory.updatedAt = new Date().toISOString();
          memory.stateVersion += 1;
        },
      });
    }
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`discovery-source-retry:${input.runId}:${input.sourceKey}`}, 0))`,
      );
      const [job] = await tx
        .select()
        .from(scheduledJob)
        .where(eq(scheduledJob.scheduledJobId, input.runId))
        .limit(1)
        .for("update");
      if (!job) throw new DiscoveryControlError("NOT_FOUND", "RUN_NOT_FOUND");
      const result = asRecord(job.result);
      const applied = applyRetry(
        asRecord(result.sourceOutcomes),
        asRecord(result.budgetReservations),
        input,
        { persist() {} },
      );
      await tx
        .update(scheduledJob)
        .set({
          result: {
            ...result,
            sourceOutcomes: applied.sourceOutcomes,
            budgetReservations: applied.budgetReservations,
          },
          stateVersion: sql`${scheduledJob.stateVersion} + 1`,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(scheduledJob.scheduledJobId, input.runId));
      return applied;
    });
  }).catch((error) => {
    if (error instanceof DiscoveryRunError)
      throw new DiscoveryControlError(error.code === "FORBIDDEN" ? "FORBIDDEN" : "NOT_FOUND", error.message);
    throw error;
  });
}

function applyRetry(
  rawOutcomes: Record<string, unknown>,
  rawReservations: Record<string, unknown>,
  input: {
    sourceKey: string;
    requestId: string;
  },
  hooks: {
    persist: (
      outcomes: Record<string, unknown>,
      reservations: Record<string, unknown>,
    ) => void;
  },
) {
  const outcomes = parseOutcomes(rawOutcomes);
  const reservations = parseReservations(rawReservations);
  const target = outcomes[input.sourceKey];
  if (!target)
    throw new DiscoveryControlError("NOT_FOUND", "SOURCE_OUTCOME_NOT_FOUND");
  if (target.status === "completed")
    throw new DiscoveryControlError("INVALID_STATE", "SOURCE_ALREADY_COMPLETED");
  if (target.status === "retry_queued")
    throw new DiscoveryControlError("CONFLICT", "SOURCE_RETRY_ALREADY_QUEUED");
  if (target.status !== "failed" && target.status !== "partial")
    throw new DiscoveryControlError("INVALID_STATE", "SOURCE_NOT_RETRYABLE");
  if (!target.retryable || !target.checkpoint)
    throw new DiscoveryControlError("INVALID_STATE", "SOURCE_CHECKPOINT_REQUIRED");
  const reservationKey = `${input.requestId}:${input.sourceKey}`;
  if (reservations[reservationKey])
    throw new DiscoveryControlError("CONFLICT", "BUDGET_RESERVATION_REPLAY");
  const reservation: DiscoveryBudgetReservation = {
    reservationId: randomUUID(),
    sourceKey: input.sourceKey,
    state: "pending_unknown",
    units: 0,
    unitKind: "request",
    paidCallAuthorized: false,
    createdAt: new Date().toISOString(),
  };
  const nextTarget: DiscoverySourceOutcome = {
    ...target,
    status: "retry_queued",
    retryCount: target.retryCount + 1,
    lastEvent: "sales.discovery.source.retry.v1",
    lastError: null,
  };
  const nextOutcomes = { ...outcomes, [input.sourceKey]: nextTarget };
  const nextReservations = { ...reservations, [reservationKey]: reservation };
  hooks.persist(nextOutcomes, nextReservations);
  return {
    executionEnabled: isDiscoveryExecutionEnabled(),
    collectorStarted: false as const,
    paidCallAuthorized: false as const,
    sourceKey: input.sourceKey,
    checkpoint: nextTarget.checkpoint,
    sourceOutcomes: nextOutcomes,
    budgetReservations: nextReservations,
    reservation,
    siblings: Object.values(nextOutcomes)
      .filter((outcome) => outcome.sourceKey !== input.sourceKey)
      .map((outcome) => ({
        sourceKey: outcome.sourceKey,
        status: outcome.status,
        checkpoint: outcome.checkpoint,
      })),
  };
}

export async function reconnectDiscoveryControlSource(input: {
  programmeId: string;
  sourceKey: string;
  actorEmployeeId: string;
  isAdmin: boolean;
  reason: string;
}) {
  const programme = await reconnectDiscoverySource(input);
  const source = programme.draft.sources.find(
    (item) => item.sourceKey === input.sourceKey,
  );
  if (!source)
    throw new DiscoveryControlError("NOT_FOUND", "SOURCE_NOT_FOUND");
  return {
    executionEnabled: isDiscoveryExecutionEnabled(),
    collectorStarted: false as const,
    programmeId: programme.id,
    sourceKey: input.sourceKey,
    credentialGeneration: source.credentialGeneration,
    connectionState: source.connectionState,
  };
}

export const discoveryControlRetrySchema = z.object({
  runId: z.string().uuid(),
  sourceKey: z.string().min(1).max(80),
  requestId: z.string().uuid(),
});

export const discoveryControlReconnectSchema = z.object({
  programmeId: z.string().uuid(),
  sourceKey: z.string().min(1).max(80),
  reason: z.string().trim().min(8).max(500),
});

export const discoveryPolicyProposeSchema = z.object({
  programmeId: z.string().uuid(),
  maxObservations: z.number().int().min(1).max(200),
  reason: z.string().trim().min(8).max(500),
});

export const discoveryPolicyAcceptSchema = z.object({
  suggestionId: z.string().uuid(),
});

export async function proposeDiscoveryPolicySuggestion(input: {
  programmeId: string;
  maxObservations: number;
  reason: string;
  actorEmployeeId: string;
  isAdmin: boolean;
}) {
  const values = discoveryPolicyProposeSchema.parse(input);
  await getDiscoveryProgramme({
    programmeId: values.programmeId,
    actorEmployeeId: input.actorEmployeeId,
    isAdmin: input.isAdmin,
  });
  const suggestion: PolicySuggestion = {
    suggestionId: randomUUID(),
    programmeId: values.programmeId,
    kind: "max_observations",
    maxObservations: values.maxObservations,
    reason: values.reason,
    status: "proposed",
    appliedVersion: null,
  };
  policySuggestions.set(suggestion.suggestionId, suggestion);
  return suggestion;
}

export async function acceptDiscoveryPolicySuggestion(input: {
  suggestionId: string;
  actorEmployeeId: string;
  isAdmin: boolean;
}) {
  if (!input.isAdmin)
    throw new DiscoveryControlError("FORBIDDEN", "SALES_ADMIN_REQUIRED");
  const suggestion = policySuggestions.get(input.suggestionId);
  if (!suggestion)
    throw new DiscoveryControlError("NOT_FOUND", "POLICY_SUGGESTION_NOT_FOUND");
  if (suggestion.status === "accepted") {
    return {
      ...suggestion,
      executionEnabled: isDiscoveryExecutionEnabled(),
      collectorStarted: false as const,
      publishedVersion: suggestion.appliedVersion,
      maxObservations: suggestion.maxObservations,
    };
  }
  if (suggestion.status !== "proposed")
    throw new DiscoveryControlError("INVALID_STATE", "POLICY_SUGGESTION_NOT_OPEN");
  const programme = await getDiscoveryProgramme({
    programmeId: suggestion.programmeId,
    actorEmployeeId: input.actorEmployeeId,
    isAdmin: input.isAdmin,
  });
  const saved = await saveDiscoveryProgrammeDraft({
    programmeId: programme.id,
    expectedVersion: programme.version,
    actorEmployeeId: input.actorEmployeeId,
    isAdmin: input.isAdmin,
    config: {
      ...programme.draft.config,
      limits: {
        ...programme.draft.config.limits,
        maxObservations: suggestion.maxObservations,
      },
    },
    sources: programme.draft.sources.map((source) => ({
      sourceKey: source.sourceKey,
      enabled: source.enabled,
      required: source.required,
      accountReferenceId: source.accountReferenceId ?? null,
      configuration: {
        url: source.configuration.url,
        feedUrl: source.configuration.feedUrl,
        notes: source.configuration.notes,
      },
    })),
  });
  const published = await publishDiscoveryProgramme({
    programmeId: saved.id,
    expectedVersion: saved.version,
    actorEmployeeId: input.actorEmployeeId,
  });
  suggestion.status = "accepted";
  suggestion.appliedVersion = published.publishedVersion;
  policySuggestions.set(suggestion.suggestionId, suggestion);
  return {
    ...suggestion,
    executionEnabled: isDiscoveryExecutionEnabled(),
    collectorStarted: false as const,
    appliedVersion: published.publishedVersion,
    publishedVersion: published.publishedVersion,
    maxObservations:
      published.published?.config.limits.maxObservations ??
      suggestion.maxObservations,
  };
}
