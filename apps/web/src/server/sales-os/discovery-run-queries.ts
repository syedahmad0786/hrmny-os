import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  researchProgramme,
  scheduledJob,
  sql,
} from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import {
  DiscoveryRunError,
  promoteDeferredAfterTerminalTx,
  SALES_RESEARCH_RUN_JOB_KIND,
} from "./discovery-runs";

const UuidSchema = z.string().uuid();
const RunStatusSchema = z.enum([
  "pending",
  "running",
  "deferred",
  "cancel_requested",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "coalesced",
  "dead_letter",
]);
const TriggerSchema = z.enum(["scheduled", "manual", "deferred"]);
const DispatchStateSchema = z.enum([
  "unarmed",
  "dispatching",
  "dispatched",
  "repair_needed",
]);

export type DiscoveryRunStatus = z.infer<typeof RunStatusSchema>;
export type DiscoveryRunTrigger = z.infer<typeof TriggerSchema>;

export type DiscoveryRunView = {
  runId: string;
  programmeId: string;
  programmeName: string;
  status: DiscoveryRunStatus;
  trigger: DiscoveryRunTrigger;
  runAt: string;
  scheduleGeneration: number;
  publishedVersion: number | null;
  maxObservations: number | null;
  dispatchState: z.infer<typeof DispatchStateSchema>;
  executionEnabled: false;
  collectorStarted: boolean;
  sourceCount: number;
  sourceOutcomeCount: number;
  missedCount: number;
  lastError: string | null;
  outcome: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  stateVersion: number;
};

export type DiscoveryRunDetail = DiscoveryRunView & {
  jobKey: string;
  attempts: number;
  overallDeadlineAt: string | null;
  leaseExpiresAt: string | null;
  n8nClaimed: boolean;
  sourceKeys: string[];
  sourceEvents: Array<{ sourceKey: string; lastEvent: string | null }>;
};

type MemoryRun = {
  runId: string;
  jobKey: string;
  programmeId: string;
  programmeName: string;
  ownerEmployeeId: string;
  reviewerEmployeeIds: string[];
  status: DiscoveryRunStatus;
  trigger: DiscoveryRunTrigger;
  runAt: string;
  scheduleGeneration: number;
  publishedVersion: number | null;
  maxObservations: number | null;
  requestId: string | null;
  coalescedRequestIds: string[];
  missedCount: number;
  sourceCount: number;
  sourceKeys: string[];
  dispatchState: z.infer<typeof DispatchStateSchema>;
  lastError: string | null;
  outcome: string | null;
  cancelReason: string | null;
  stateVersion: number;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sourceOutcomes: Record<string, unknown>;
  budgetReservations: Record<string, unknown>;
};

const memoryRuns = new Map<string, MemoryRun>();

export function resetMemoryDiscoveryRuns() {
  memoryRuns.clear();
}

export function getMemoryDiscoveryRun(runId: string) {
  return memoryRuns.get(runId);
}

export function listMemoryDiscoveryRuns() {
  return [...memoryRuns.values()];
}

export function recordMemoryDiscoverySourceOutcomes(
  runId: string,
  outcomes: Record<string, unknown>,
) {
  const run = memoryRuns.get(runId);
  if (!run) throw new DiscoveryRunError("NOT_FOUND", "RUN_NOT_FOUND");
  run.sourceOutcomes = { ...run.sourceOutcomes, ...outcomes };
  run.updatedAt = new Date().toISOString();
  run.stateVersion += 1;
  return run;
}

export function setMemoryDiscoveryRunStatusForTest(
  runId: string,
  status: DiscoveryRunStatus,
) {
  const run = memoryRuns.get(runId);
  if (!run) throw new Error("RUN_NOT_FOUND");
  run.status = status;
  run.updatedAt = new Date().toISOString();
  run.stateVersion += 1;
  if (status === "cancelled") promoteMemoryDeferred(run.programmeId);
}

function promoteMemoryDeferred(programmeId: string) {
  const hasActive = [...memoryRuns.values()].some(
    (run) =>
      run.programmeId === programmeId &&
      (run.status === "running" || run.status === "cancel_requested"),
  );
  if (hasActive) return;
  const deferred = [...memoryRuns.values()].find(
    (run) => run.programmeId === programmeId && run.status === "deferred",
  );
  if (!deferred) return;
  const now = new Date().toISOString();
  for (const run of memoryRuns.values()) {
    if (run.programmeId === programmeId && run.status === "pending") {
      run.status = "cancelled";
      run.outcome = "superseded_by_deferred_promotion";
      run.completedAt = now;
      run.updatedAt = now;
      run.stateVersion += 1;
    }
  }
  deferred.status = "pending";
  deferred.trigger = "deferred";
  deferred.runAt = now;
  deferred.updatedAt = now;
  deferred.stateVersion += 1;
}

function canAccess(
  run: Pick<MemoryRun, "ownerEmployeeId" | "reviewerEmployeeIds">,
  actorEmployeeId: string,
  isAdmin: boolean,
) {
  return (
    isAdmin ||
    run.ownerEmployeeId === actorEmployeeId ||
    run.reviewerEmployeeIds.includes(actorEmployeeId)
  );
}

function viewFromMemory(run: MemoryRun): DiscoveryRunView {
  return {
    runId: run.runId,
    programmeId: run.programmeId,
    programmeName: run.programmeName,
    status: run.status,
    trigger: run.trigger,
    runAt: run.runAt,
    scheduleGeneration: run.scheduleGeneration,
    publishedVersion: run.publishedVersion,
    maxObservations: run.maxObservations,
    dispatchState: run.dispatchState,
    executionEnabled: false,
    collectorStarted: false,
    sourceCount: run.sourceCount,
    sourceOutcomeCount: Object.keys(run.sourceOutcomes).length,
    missedCount: run.missedCount,
    lastError: run.lastError,
    outcome: run.outcome,
    cancelReason: run.cancelReason,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    stateVersion: run.stateVersion,
  };
}

function detailFromMemory(run: MemoryRun): DiscoveryRunDetail {
  return {
    ...viewFromMemory(run),
    jobKey: run.jobKey,
    attempts: run.attempts,
    overallDeadlineAt: null,
    leaseExpiresAt: null,
    n8nClaimed: false,
    sourceKeys: run.sourceKeys,
    sourceEvents: Object.entries(run.sourceOutcomes).map(([sourceKey, value]) => ({
      sourceKey,
      lastEvent: text(asRecord(value).lastEvent) ?? text(asRecord(value).status),
    })),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function viewFromJob(input: {
  job: typeof scheduledJob.$inferSelect;
  programmeName: string;
}): DiscoveryRunView {
    const payload = asRecord(input.job.payload);
    const slot = asRecord(payload.slot);
    const result = asRecord(input.job.result);
    const dispatch = asRecord(result.dispatch);
    const effective = asRecord(payload.effective);
    const payloadName = text(payload.programmeName);
  const sources = Array.isArray(effective.sources) ? effective.sources : [];
  const sourceOutcomes = asRecord(result.sourceOutcomes);
  const cancel = asRecord(result.cancel);
  const trigger = TriggerSchema.catch("scheduled").parse(slot.trigger);
  return {
    runId: input.job.scheduledJobId,
    programmeId: input.job.researchProgrammeId ?? "",
    programmeName: payloadName ?? input.programmeName,
    status: RunStatusSchema.catch("pending").parse(input.job.status),
    trigger,
    runAt: input.job.runAt.toISOString(),
    scheduleGeneration:
      typeof payload.scheduleGeneration === "number"
        ? payload.scheduleGeneration
        : 0,
    publishedVersion:
      typeof effective.versionNumber === "number"
        ? effective.versionNumber
        : null,
    maxObservations: (() => {
      const limits = asRecord(asRecord(effective.config).limits);
      return typeof limits.maxObservations === "number"
        ? limits.maxObservations
        : null;
    })(),
    dispatchState: DispatchStateSchema.catch("unarmed").parse(dispatch.state),
    executionEnabled: false,
    collectorStarted: Boolean(result.n8nClaim),
    sourceCount: sources.length,
    sourceOutcomeCount: Object.keys(sourceOutcomes).length,
    missedCount:
      typeof slot.missedCount === "number" && slot.missedCount > 0
        ? slot.missedCount
        : 1,
    lastError: input.job.lastError,
    outcome: text(result.outcome),
    cancelReason: text(cancel.reason),
    createdAt: input.job.createdAt.toISOString(),
    updatedAt: input.job.updatedAt.toISOString(),
    completedAt: input.job.completedAt?.toISOString() ?? null,
    stateVersion: input.job.stateVersion,
  };
}

function detailFromJob(input: {
  job: typeof scheduledJob.$inferSelect;
  programmeName: string;
}): DiscoveryRunDetail {
  const payload = asRecord(input.job.payload);
  const effective = asRecord(payload.effective);
  const sources = Array.isArray(effective.sources) ? effective.sources : [];
  const sourceOutcomes = asRecord(asRecord(input.job.result).sourceOutcomes);
  const sourceKeys = sources.flatMap((source) => {
    const key = asRecord(source).sourceKey;
    return typeof key === "string" ? [key] : [];
  });
  return {
    ...viewFromJob(input),
    jobKey: input.job.jobKey,
    attempts: input.job.attempts,
    overallDeadlineAt: input.job.overallDeadlineAt?.toISOString() ?? null,
    leaseExpiresAt: input.job.leaseExpiresAt?.toISOString() ?? null,
    n8nClaimed: Boolean(asRecord(input.job.result).n8nClaim),
    sourceKeys,
    sourceEvents: Object.entries(sourceOutcomes).map(([sourceKey, value]) => ({
      sourceKey,
      lastEvent: text(asRecord(value).lastEvent),
    })),
  };
}

export function armMemoryPublishedSlot(input: {
  programmeId: string;
  programmeName: string;
  ownerEmployeeId: string;
  reviewerEmployeeIds: string[];
  scheduleGeneration: number;
  publishedVersion: number;
  maxObservations: number;
  runAt: string;
  sourceKeys: string[];
}): DiscoveryRunView {
  const now = new Date().toISOString();
  for (const run of memoryRuns.values()) {
    if (
      run.programmeId === input.programmeId &&
      (run.status === "pending" || run.status === "deferred")
    ) {
      run.status = "cancelled";
      run.outcome = "superseded_by_publish";
      run.completedAt = now;
      run.updatedAt = now;
      run.stateVersion += 1;
    }
  }
  const runId = randomUUID();
  const run: MemoryRun = {
    runId,
    jobKey: `discovery:${input.programmeId}:g${input.scheduleGeneration}:${input.runAt}`,
    programmeId: input.programmeId,
    programmeName: input.programmeName,
    ownerEmployeeId: input.ownerEmployeeId,
    reviewerEmployeeIds: input.reviewerEmployeeIds,
    status: "pending",
    trigger: "scheduled",
    runAt: input.runAt,
    scheduleGeneration: input.scheduleGeneration,
    publishedVersion: input.publishedVersion,
    maxObservations: input.maxObservations,
    requestId: null,
    coalescedRequestIds: [],
    missedCount: 1,
    sourceCount: input.sourceKeys.length,
    sourceKeys: input.sourceKeys,
    dispatchState: "unarmed",
    lastError: null,
    outcome: null,
    cancelReason: null,
    stateVersion: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    sourceOutcomes: {},
    budgetReservations: {},
  };
  memoryRuns.set(runId, run);
  return viewFromMemory(run);
}

export function pauseMemoryProgrammeRuns(input: {
  programmeId: string;
  actorEmployeeId: string;
  reason: string;
}): void {
  const now = new Date().toISOString();
  for (const run of memoryRuns.values()) {
    if (run.programmeId !== input.programmeId) continue;
    if (run.status === "running") {
      run.status = "cancel_requested";
      run.cancelReason = input.reason;
      run.updatedAt = now;
      run.stateVersion += 1;
      continue;
    }
    if (run.status === "pending" || run.status === "deferred") {
      run.status = "cancelled";
      run.cancelReason = input.reason;
      run.completedAt = now;
      run.updatedAt = now;
      run.stateVersion += 1;
    }
  }
}

export function requestMemoryDiscoveryRun(input: {
  programmeId: string;
  programmeName: string;
  ownerEmployeeId: string;
  reviewerEmployeeIds: string[];
  expectedVersion: number;
  programmeVersion: number;
  programmeState: "draft" | "active" | "paused" | "archived";
  publishedVersion: number | null;
  maxObservations: number;
  scheduleGeneration: number;
  sourceKeys: string[];
  requestId: string;
  overlap: "defer" | "defer_scheduled" | "cancel_and_restart";
  actorEmployeeId: string;
  isAdmin: boolean;
}): { status: "pending" | "deferred"; runId: string; nextWakeAt: string } {
  if (
    !input.isAdmin &&
    input.ownerEmployeeId !== input.actorEmployeeId &&
    !input.reviewerEmployeeIds.includes(input.actorEmployeeId)
  )
    throw new DiscoveryRunError("FORBIDDEN", "PROGRAMME_ACCESS_DENIED");
  if (input.programmeVersion !== input.expectedVersion)
    throw new DiscoveryRunError("STALE_FENCE", "PROGRAMME_VERSION_CONFLICT");
  if (input.programmeState !== "active")
    throw new DiscoveryRunError("INVALID_STATE", "PROGRAMME_NOT_ACTIVE");
  const now = new Date().toISOString();
  const manualKey = `discovery:${input.programmeId}:manual:${input.requestId}`;
  const replayed = [...memoryRuns.values()].find(
    (run) => run.jobKey === manualKey,
  );
  if (replayed) {
    if (replayed.status === "pending")
      return {
        status: "pending",
        runId: replayed.runId,
        nextWakeAt: replayed.runAt,
      };
    if (
      replayed.status === "deferred" ||
      replayed.status === "running" ||
      replayed.status === "cancel_requested"
    )
      return {
        status: "deferred",
        runId: replayed.runId,
        nextWakeAt: replayed.runAt,
      };
    throw new DiscoveryRunError(
      "REPLAY_CONFLICT",
      "MANUAL_REQUEST_ALREADY_TERMINAL",
    );
  }
  const active = [...memoryRuns.values()].find(
    (run) =>
      run.programmeId === input.programmeId &&
      (run.status === "running" || run.status === "cancel_requested"),
  );
  const scheduledPending =
    !active && input.overlap === "defer_scheduled"
      ? [...memoryRuns.values()].find(
          (run) =>
            run.programmeId === input.programmeId && run.status === "pending",
        )
      : undefined;
  if (active || scheduledPending) {
    if (
      input.overlap === "cancel_and_restart" &&
      active?.status === "running"
    ) {
      active.status = "cancel_requested";
      active.cancelReason = "manual_restart";
      active.updatedAt = now;
      active.stateVersion += 1;
    }
    const deferred = [...memoryRuns.values()].find(
      (run) =>
        run.programmeId === input.programmeId && run.status === "deferred",
    );
    if (deferred) {
      if (
        deferred.requestId !== input.requestId &&
        !deferred.coalescedRequestIds.includes(input.requestId)
      ) {
        deferred.coalescedRequestIds = [
          ...deferred.coalescedRequestIds,
          input.requestId,
        ].slice(-100);
        deferred.missedCount += 1;
        deferred.updatedAt = now;
      }
      return { status: "deferred", runId: deferred.runId, nextWakeAt: now };
    }
    const runId = randomUUID();
    memoryRuns.set(runId, {
      runId,
      jobKey: manualKey,
      programmeId: input.programmeId,
      programmeName: input.programmeName,
      ownerEmployeeId: input.ownerEmployeeId,
      reviewerEmployeeIds: input.reviewerEmployeeIds,
      status: "deferred",
      trigger: "deferred",
      runAt: now,
      scheduleGeneration: input.scheduleGeneration,
      publishedVersion: input.publishedVersion,
      maxObservations: input.maxObservations,
      requestId: input.requestId,
      coalescedRequestIds: [input.requestId],
      missedCount: 1,
      sourceCount: input.sourceKeys.length,
      sourceKeys: input.sourceKeys,
      dispatchState: "unarmed",
      lastError: null,
      outcome: null,
      cancelReason: null,
      stateVersion: 0,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      sourceOutcomes: {},
      budgetReservations: {},
    });
    return { status: "deferred", runId, nextWakeAt: now };
  }
  for (const run of memoryRuns.values()) {
    if (run.programmeId === input.programmeId && run.status === "pending") {
      run.status = "cancelled";
      run.outcome = "replaced_by_manual_run";
      run.completedAt = now;
      run.updatedAt = now;
      run.stateVersion += 1;
    }
  }
  const runId = randomUUID();
  memoryRuns.set(runId, {
    runId,
    jobKey: manualKey,
    programmeId: input.programmeId,
    programmeName: input.programmeName,
    ownerEmployeeId: input.ownerEmployeeId,
    reviewerEmployeeIds: input.reviewerEmployeeIds,
    status: "pending",
    trigger: "manual",
    runAt: now,
    scheduleGeneration: input.scheduleGeneration,
    publishedVersion: input.publishedVersion,
    maxObservations: input.maxObservations,
    requestId: input.requestId,
    coalescedRequestIds: [input.requestId],
    missedCount: 1,
    sourceCount: input.sourceKeys.length,
    sourceKeys: input.sourceKeys,
    dispatchState: "unarmed",
    lastError: null,
    outcome: null,
    cancelReason: null,
    stateVersion: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    sourceOutcomes: {},
    budgetReservations: {},
  });
  return { status: "pending", runId, nextWakeAt: now };
}

export async function listDiscoveryRuns(input: {
  actorEmployeeId: string;
  isAdmin: boolean;
  programmeId?: string;
  status?: DiscoveryRunStatus;
}): Promise<DiscoveryRunView[]> {
  const parsed = z
    .object({
      actorEmployeeId: UuidSchema,
      isAdmin: z.boolean(),
      programmeId: UuidSchema.optional(),
      status: RunStatusSchema.optional(),
    })
    .parse(input);
  const db = getDb();
  if (!db) {
    return [...memoryRuns.values()]
      .filter(
        (run) =>
          canAccess(run, parsed.actorEmployeeId, parsed.isAdmin) &&
          (!parsed.programmeId || run.programmeId === parsed.programmeId) &&
          (!parsed.status || run.status === parsed.status),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(viewFromMemory);
  }
  const access = parsed.isAdmin
    ? undefined
    : sql`(${researchProgramme.ownerEmployeeId} = ${parsed.actorEmployeeId}::uuid or ${parsed.actorEmployeeId}::uuid = any(${researchProgramme.reviewerEmployeeIds}::uuid[]))`;
  const programmeFilter = parsed.programmeId
    ? eq(scheduledJob.researchProgrammeId, parsed.programmeId)
    : undefined;
  const statusFilter = parsed.status
    ? eq(scheduledJob.status, parsed.status)
    : undefined;
  const predicates = [
    eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
    access,
    programmeFilter,
    statusFilter,
  ].filter(Boolean);
  const rows = await db
    .select({ job: scheduledJob })
    .from(scheduledJob)
    .innerJoin(
      researchProgramme,
      eq(
        scheduledJob.researchProgrammeId,
        researchProgramme.researchProgrammeId,
      ),
    )
    .where(and(...predicates))
    .orderBy(desc(scheduledJob.updatedAt));
  return rows.map(({ job }) => {
    const payload = asRecord(job.payload);
    const config = asRecord(asRecord(payload.effective).config);
    return viewFromJob({
      job,
      programmeName:
        text(config.name) ?? `Programme ${job.researchProgrammeId ?? ""}`,
    });
  });
}

export async function getDiscoveryRun(input: {
  runId: string;
  actorEmployeeId: string;
  isAdmin: boolean;
}): Promise<DiscoveryRunDetail> {
  const parsed = z
    .object({
      runId: UuidSchema,
      actorEmployeeId: UuidSchema,
      isAdmin: z.boolean(),
    })
    .parse(input);
  const db = getDb();
  if (!db) {
    const run = memoryRuns.get(parsed.runId);
    if (!run) throw new DiscoveryRunError("NOT_FOUND", "RUN_NOT_FOUND");
    if (!canAccess(run, parsed.actorEmployeeId, parsed.isAdmin))
      throw new DiscoveryRunError("FORBIDDEN", "PROGRAMME_ACCESS_DENIED");
    return detailFromMemory(run);
  }
  const [row] = await db
    .select({ job: scheduledJob, programme: researchProgramme })
    .from(scheduledJob)
    .innerJoin(
      researchProgramme,
      eq(scheduledJob.researchProgrammeId, researchProgramme.researchProgrammeId),
    )
    .where(
      and(
        eq(scheduledJob.scheduledJobId, parsed.runId),
        eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
      ),
    )
    .limit(1);
  if (!row) throw new DiscoveryRunError("NOT_FOUND", "RUN_NOT_FOUND");
  if (
    !parsed.isAdmin &&
    row.programme.ownerEmployeeId !== parsed.actorEmployeeId &&
    !row.programme.reviewerEmployeeIds.includes(parsed.actorEmployeeId)
  )
    throw new DiscoveryRunError("FORBIDDEN", "PROGRAMME_ACCESS_DENIED");
  const payload = asRecord(row.job.payload);
  const config = asRecord(asRecord(payload.effective).config);
  return detailFromJob({
    job: row.job,
    programmeName:
      text(config.name) ?? `Programme ${row.programme.researchProgrammeId}`,
  });
}

export async function cancelDiscoveryRun(input: {
  runId: string;
  expectedStateVersion: number;
  reason: string;
  actorEmployeeId: string;
  isAdmin: boolean;
}): Promise<DiscoveryRunDetail> {
  const parsed = z
    .object({
      runId: UuidSchema,
      expectedStateVersion: z.number().int().nonnegative(),
      reason: z.string().trim().min(3).max(500),
      actorEmployeeId: UuidSchema,
      isAdmin: z.boolean(),
    })
    .parse(input);
  const db = getDb();
  if (!db) {
    const run = memoryRuns.get(parsed.runId);
    if (!run) throw new DiscoveryRunError("NOT_FOUND", "RUN_NOT_FOUND");
    if (!canAccess(run, parsed.actorEmployeeId, parsed.isAdmin))
      throw new DiscoveryRunError("FORBIDDEN", "PROGRAMME_ACCESS_DENIED");
    if (run.stateVersion !== parsed.expectedStateVersion)
      throw new DiscoveryRunError("STALE_FENCE", "RUN_STATE_CONFLICT");
    const now = new Date().toISOString();
    switch (run.status) {
      case "pending":
      case "deferred":
        run.status = "cancelled";
        run.cancelReason = parsed.reason;
        run.completedAt = now;
        break;
      case "running":
        run.status = "cancel_requested";
        run.cancelReason = parsed.reason;
        break;
      case "cancel_requested":
      case "completed":
      case "partial":
      case "failed":
      case "cancelled":
      case "coalesced":
      case "dead_letter":
        throw new DiscoveryRunError("INVALID_STATE", "RUN_NOT_CANCELLABLE");
      default: {
        const unhandled: never = run.status;
        throw new DiscoveryRunError(
          "UNSUPPORTED_EVENT",
          `Unhandled run status: ${String(unhandled)}`,
        );
      }
    }
    run.updatedAt = now;
    run.stateVersion += 1;
    if (run.status === "cancelled") promoteMemoryDeferred(run.programmeId);
    return detailFromMemory(run);
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ job: scheduledJob, programme: researchProgramme })
      .from(scheduledJob)
      .innerJoin(
        researchProgramme,
        eq(
          scheduledJob.researchProgrammeId,
          researchProgramme.researchProgrammeId,
        ),
      )
      .where(
        and(
          eq(scheduledJob.scheduledJobId, parsed.runId),
          eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw new DiscoveryRunError("NOT_FOUND", "RUN_NOT_FOUND");
    if (
      !parsed.isAdmin &&
      row.programme.ownerEmployeeId !== parsed.actorEmployeeId &&
      !row.programme.reviewerEmployeeIds.includes(parsed.actorEmployeeId)
    )
      throw new DiscoveryRunError("FORBIDDEN", "PROGRAMME_ACCESS_DENIED");
    if (row.job.stateVersion !== parsed.expectedStateVersion)
      throw new DiscoveryRunError("STALE_FENCE", "RUN_STATE_CONFLICT");
    const status = RunStatusSchema.catch("pending").parse(row.job.status);
    let nextStatus: DiscoveryRunStatus;
    switch (status) {
      case "pending":
      case "deferred":
        nextStatus = "cancelled";
        break;
      case "running":
        nextStatus = "cancel_requested";
        break;
      case "cancel_requested":
      case "completed":
      case "partial":
      case "failed":
      case "cancelled":
      case "coalesced":
      case "dead_letter":
        throw new DiscoveryRunError("INVALID_STATE", "RUN_NOT_CANCELLABLE");
      default: {
        const unhandled: never = status;
        throw new DiscoveryRunError(
          "UNSUPPORTED_EVENT",
          `Unhandled run status: ${String(unhandled)}`,
        );
      }
    }
    const now = new Date();
    const result = asRecord(row.job.result);
    result.cancel = {
      requestedAt: now.toISOString(),
      reason: parsed.reason,
      actorEmployeeId: parsed.actorEmployeeId,
    };
    const [updated] = await tx
      .update(scheduledJob)
      .set({
        status: nextStatus,
        result,
        completedAt: nextStatus === "cancelled" ? now : row.job.completedAt,
        stateVersion: sql`${scheduledJob.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledJob.scheduledJobId, parsed.runId),
          eq(scheduledJob.stateVersion, parsed.expectedStateVersion),
        ),
      )
      .returning();
    if (!updated) throw new DiscoveryRunError("STALE_FENCE", "RUN_STATE_CONFLICT");
    if (nextStatus === "cancelled" && updated.researchProgrammeId)
      await promoteDeferredAfterTerminalTx(
        tx,
        updated.researchProgrammeId,
        now,
      );
    const payload = asRecord(updated.payload);
    const config = asRecord(asRecord(payload.effective).config);
    return detailFromJob({
      job: updated,
      programmeName:
        text(config.name) ??
        `Programme ${updated.researchProgrammeId ?? parsed.runId}`,
    });
  });
}
