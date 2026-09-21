import { randomUUID } from "node:crypto";
import {
  and,
  auditEvent,
  connectionAccount,
  desc,
  employee,
  eq,
  integrationInbox,
  researchProgramme,
  researchProgrammeSourceBinding,
  researchProgrammeVersion,
  scheduledJob,
  sql,
  type Db,
} from "@hrmny/db";
import { z } from "zod";
import { previewDiscoverySchedule } from "@/lib/discovery-schedule";
import { getDb } from "../db";
import type {
  DiscoveryProgrammeSnapshot,
  DiscoveryProgrammeSnapshotSource,
} from "./discovery-programmes";

export const SALES_RESEARCH_RUN_JOB_KIND = "sales_research_run" as const;
export const DISCOVERY_RUN_SCHEMA_VERSION = 1 as const;
export const DISCOVERY_DISPATCH_HORIZON_MS = 24 * 60 * 60 * 1_000;
export const DISCOVERY_OVERALL_DEADLINE_MS = 30 * 60 * 1_000;
export const DISCOVERY_HEARTBEAT_LEASE_MS = 2 * 60 * 1_000;
export const DISCOVERY_DISPATCH_LEASE_MS = 60 * 1_000;
export const DISCOVERY_DISPATCH_REPAIR_AFTER_MS = 5 * 60 * 1_000;

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type JsonObject = Record<string, unknown>;

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });
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

const SlotSchema = z
  .object({
    trigger: z.enum(["scheduled", "manual", "deferred"]),
    nominalDueAt: IsoDateSchema,
    requestId: UuidSchema.nullable().optional(),
    deferredFrom: IsoDateSchema.nullable().optional(),
    deferredThrough: IsoDateSchema.nullable().optional(),
    missedCount: z.number().int().positive().max(10_000).default(1),
    coalescedRequestIds: z.array(UuidSchema).max(100).default([]),
  })
  .strict();

const EffectiveSourceSchema = z
  .object({
    bindingId: UuidSchema,
    sourceKey: z.string().min(1).max(120),
    adapter: z.string().min(1).max(120),
    adapterVersion: z.string().min(1).max(120),
    configuration: z.record(z.unknown()),
    accountReferenceId: UuidSchema.nullable(),
    credentialGeneration: z.number().int().nonnegative(),
    enabled: z.boolean(),
    required: z.boolean(),
    executionMode: z.enum(["automatic", "manual"]),
  })
  .strict();

export const DiscoveryEffectiveSnapshotV1Schema = z
  .object({
    programmeVersionId: UuidSchema,
    versionNumber: z.number().int().positive(),
    configHash: z.string().regex(/^[a-f0-9]{64}$/),
    config: z.record(z.unknown()),
    sources: z.array(EffectiveSourceSchema).max(100),
    runtime: z
      .object({
        ownerEmployeeId: UuidSchema,
        n8nConnectionAccountId: UuidSchema,
        n8nConnectionOwnerEmployeeId: UuidSchema,
        n8nCredentialVersion: z.string().min(1).max(100),
      })
      .strict(),
  })
  .strict();

export type DiscoveryEffectiveSnapshotV1 = z.infer<
  typeof DiscoveryEffectiveSnapshotV1Schema
>;

export const DiscoveryRunPayloadV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    programmeId: UuidSchema,
    programmeName: z.string().trim().min(1).max(180).optional(),
    scheduleGeneration: z.number().int().nonnegative(),
    slot: SlotSchema,
    effective: DiscoveryEffectiveSnapshotV1Schema.nullable(),
  })
  .strict();

export type DiscoveryRunPayloadV1 = z.infer<
  typeof DiscoveryRunPayloadV1Schema
>;

const DispatchResultSchema = z
  .object({
    state: z.enum([
      "unarmed",
      "dispatching",
      "dispatched",
      "repair_needed",
    ]),
    eventId: z.string().min(1).max(500).nullable(),
    attempts: z.number().int().nonnegative(),
    lastAttemptAt: IsoDateSchema.nullable(),
    providerReceiptId: z.string().max(500).nullable(),
    errorCode: z.string().max(200).nullable(),
    token: UuidSchema.nullable(),
    leaseExpiresAt: IsoDateSchema.nullable(),
  })
  .strict();

const DiscoveryRunResultSchema = z
  .object({
    dispatch: DispatchResultSchema,
    n8nClaim: z
      .object({
        executionId: z.string().min(1).max(300),
        eventId: UuidSchema,
        bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
        claimedAt: IsoDateSchema,
      })
      .strict()
      .nullable()
      .default(null),
    n8nRuntimeRevision: z
      .object({
        credentialVersion: z.string().min(1).max(100),
        secretVersion: z.string().min(1).max(200),
        authorizedAt: IsoDateSchema,
      })
      .strict()
      .nullable()
      .default(null),
    sourceOutcomes: z.record(z.unknown()).default({}),
    budgetReservations: z.record(z.unknown()).default({}),
    outcome: z.string().max(120).nullable().default(null),
    cancel: z.record(z.unknown()).nullable().default(null),
    providerTerminalStatus: z
      .enum(["completed", "partial", "failed", "cancelled"])
      .nullable()
      .optional(),
  })
  .strict();

type DiscoveryRunResult = z.infer<typeof DiscoveryRunResultSchema>;

export type DiscoveryWakeEventV1 = {
  schemaVersion: 1;
  jobId: string;
  programmeId: string;
  scheduleGeneration: number;
  runAt: string;
};

export type DiscoveryN8nTriggerSourceV1 = {
  bindingId: string;
  sourceKey: string;
  adapter: string;
  adapterVersion: string;
  credentialGeneration: number;
  executionMode: "automatic" | "manual";
  configuration: { url?: string; feedUrl?: string };
};

export type DiscoveryN8nTriggerV1 = {
  schemaVersion: 1;
  dispatchId: string;
  runId: string;
  programmeId: string;
  attemptToken: string;
  attemptGeneration: number;
  overallDeadlineAt: string;
  maxObservations: number;
  sources: DiscoveryN8nTriggerSourceV1[];
};

export type DiscoveryWakeResult =
  | {
      status: "claimed";
      nextWakeAt: string | null;
      trigger: DiscoveryN8nTriggerV1;
    }
  | {
      status:
        | "deferred"
        | "stale"
        | "paused"
        | "not_due"
        | "replay"
        | "blocked"
        | "cancelled";
      nextWakeAt: string | null;
      reason?: string;
    };

export type DiscoveryRunErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "REPLAY_CONFLICT"
  | "STALE_FENCE"
  | "ALREADY_CLAIMED"
  | "INVALID_STATE"
  | "UNSUPPORTED_EVENT"
  | "DEPENDENCY_UNAVAILABLE";

export class DiscoveryRunError extends Error {
  constructor(
    readonly code: DiscoveryRunErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryRunError";
  }
}

function database(): Db {
  const db = getDb();
  if (!db)
    throw new DiscoveryRunError(
      "DEPENDENCY_UNAVAILABLE",
      "DATABASE_URL is required for Discovery runs",
    );
  return db;
}

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function parsePayload(value: unknown): DiscoveryRunPayloadV1 {
  return DiscoveryRunPayloadV1Schema.parse(value);
}

function emptyResult(): DiscoveryRunResult {
  return {
    dispatch: {
      state: "unarmed",
      eventId: null,
      attempts: 0,
      lastAttemptAt: null,
      providerReceiptId: null,
      errorCode: null,
      token: null,
      leaseExpiresAt: null,
    },
    n8nClaim: null,
    n8nRuntimeRevision: null,
    sourceOutcomes: {},
    budgetReservations: {},
    outcome: null,
    cancel: null,
  };
}

function parseResult(value: unknown): DiscoveryRunResult {
  return DiscoveryRunResultSchema.parse(value ?? emptyResult());
}

function concurrencyKey(programmeId: string) {
  return `discovery:programme:${programmeId}`;
}

function scheduledJobKey(
  programmeId: string,
  generation: number,
  runAt: Date,
) {
  return `discovery:${programmeId}:g${generation}:${runAt.toISOString()}`;
}

function dispatchEventId(jobId: string, generation: number) {
  return `discovery-due:${jobId}:g${generation}`;
}

export function isDiscoveryExecutionEnabled() {
  return process.env.DISCOVERY_EXECUTION_ENABLED?.trim() === "true";
}

function runtimeConfiguration() {
  const parsed = z
    .object({ ownerId: UuidSchema, connectionId: UuidSchema })
    .safeParse({
      ownerId: process.env.DISCOVERY_N8N_OWNER_EMPLOYEE_ID?.trim(),
      connectionId:
        process.env.DISCOVERY_N8N_CONNECTION_ACCOUNT_ID?.trim(),
    });
  if (!parsed.success)
    throw new DiscoveryRunError(
      "DEPENDENCY_UNAVAILABLE",
      "Discovery n8n execution connection is not configured",
    );
  return parsed.data;
}

async function databaseNow(tx: DbTransaction): Promise<Date> {
  const [clock] = await tx.execute<{ now: Date | string }>(
    sql`select statement_timestamp() as now`,
  );
  if (!clock?.now)
    throw new DiscoveryRunError(
      "DEPENDENCY_UNAVAILABLE",
      "Database clock is unavailable",
    );
  return new Date(clock.now);
}

function nextScheduledAt(snapshot: DiscoveryProgrammeSnapshot, after: Date) {
  const [next] = previewDiscoverySchedule(snapshot.config.schedule, after, 1);
  if (!next)
    throw new DiscoveryRunError("INVALID_STATE", "Schedule has no next slot");
  return new Date(next);
}

function jobPayload(input: {
  programmeId: string;
  programmeName?: string;
  scheduleGeneration: number;
  trigger: "scheduled" | "manual" | "deferred";
  nominalDueAt: Date;
  requestId?: string | null;
  deferredFrom?: Date | null;
  deferredThrough?: Date | null;
  missedCount?: number;
}): DiscoveryRunPayloadV1 {
  return {
    schemaVersion: 1,
    programmeId: input.programmeId,
    ...(input.programmeName ? { programmeName: input.programmeName } : {}),
    scheduleGeneration: input.scheduleGeneration,
    slot: {
      trigger: input.trigger,
      nominalDueAt: input.nominalDueAt.toISOString(),
      requestId: input.requestId ?? null,
      deferredFrom: input.deferredFrom?.toISOString() ?? null,
      deferredThrough: input.deferredThrough?.toISOString() ?? null,
      missedCount: input.missedCount ?? 1,
      coalescedRequestIds: input.requestId ? [input.requestId] : [],
    },
    effective: null,
  };
}

async function insertPendingSlotTx(
  tx: DbTransaction,
  input: {
    programmeId: string;
    programmeName?: string;
    programmeVersionId: string;
    scheduleGeneration: number;
    runAt: Date;
    trigger: "scheduled" | "manual";
    requestId?: string | null;
  },
) {
  const [row] = await tx
    .insert(scheduledJob)
    .values({
      jobKey:
        input.trigger === "manual"
          ? `discovery:${input.programmeId}:manual:${input.requestId}`
          : scheduledJobKey(
              input.programmeId,
              input.scheduleGeneration,
              input.runAt,
            ),
      kind: SALES_RESEARCH_RUN_JOB_KIND,
      runAt: input.runAt,
      payload: jobPayload({
        programmeId: input.programmeId,
        programmeName: input.programmeName,
        scheduleGeneration: input.scheduleGeneration,
        trigger: input.trigger,
        nominalDueAt: input.runAt,
        requestId: input.requestId,
      }),
      status: "pending",
      concurrencyKey: concurrencyKey(input.programmeId),
      researchProgrammeId: input.programmeId,
      researchProgrammeVersionId: input.programmeVersionId,
      attempts: 0,
      stateVersion: 0,
      result: emptyResult(),
    })
    .onConflictDoNothing({ target: scheduledJob.jobKey })
    .returning({ id: scheduledJob.scheduledJobId });
  if (row) return row.id;
  const [existing] = await tx
    .select({ id: scheduledJob.scheduledJobId })
    .from(scheduledJob)
    .where(eq(scheduledJob.jobKey, input.trigger === "manual"
      ? `discovery:${input.programmeId}:manual:${input.requestId}`
      : scheduledJobKey(input.programmeId, input.scheduleGeneration, input.runAt)))
    .limit(1);
  if (!existing)
    throw new DiscoveryRunError("INVALID_STATE", "Pending slot conflict");
  return existing.id;
}

export async function schedulePublishedSlotTx(
  tx: DbTransaction,
  input: {
    programmeId: string;
    programmeVersionId: string;
    scheduleGeneration: number;
    snapshot: DiscoveryProgrammeSnapshot;
    now: Date;
  },
): Promise<{ jobId: string; nextWakeAt: string }> {
  await tx
    .update(scheduledJob)
    .set({
      status: "cancelled",
      completedAt: input.now,
      attemptToken: null,
      leaseExpiresAt: null,
      overallDeadlineAt: null,
      stateVersion: sql`${scheduledJob.stateVersion} + 1`,
      result: sql`coalesce(${scheduledJob.result}, '{}'::jsonb) || ${JSON.stringify({ outcome: "superseded_by_publish" })}::jsonb`,
      updatedAt: input.now,
    })
    .where(
      sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
        and ${scheduledJob.researchProgrammeId} = ${input.programmeId}::uuid
        and ${scheduledJob.status} in ('pending', 'deferred')`,
    );
  const next = nextScheduledAt(input.snapshot, input.now);
  const jobId = await insertPendingSlotTx(tx, {
    programmeId: input.programmeId,
    programmeName: input.snapshot.config.name,
    programmeVersionId: input.programmeVersionId,
    scheduleGeneration: input.scheduleGeneration,
    runAt: next,
    trigger: "scheduled",
  });
  await tx
    .update(researchProgramme)
    .set({ nextDueAt: next, updatedAt: input.now })
    .where(eq(researchProgramme.researchProgrammeId, input.programmeId));
  return { jobId, nextWakeAt: next.toISOString() };
}

export async function pauseProgrammeRunsTx(
  tx: DbTransaction,
  input: { programmeId: string; actorEmployeeId: string; reason: string; now: Date },
): Promise<void> {
  const requestedAt = input.now.toISOString();
  await tx.execute(sql`
    update public.scheduled_job
    set status = case when status = 'running' then 'cancel_requested' else 'cancelled' end,
        state_version = state_version + 1,
        completed_at = case when status in ('pending', 'deferred') then ${requestedAt}::timestamptz else completed_at end,
        result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
          'cancel', jsonb_build_object(
            'requestedAt', (${requestedAt})::text,
            'reason', (${input.reason})::text,
            'actorEmployeeId', (${input.actorEmployeeId})::text
          )
        ),
        updated_at = ${requestedAt}::timestamptz
    where kind = ${SALES_RESEARCH_RUN_JOB_KIND}::text
      and research_programme_id = ${input.programmeId}::uuid
      and status in ('pending', 'deferred', 'running')
  `);
  await tx
    .update(researchProgramme)
    .set({ nextDueAt: null, updatedAt: input.now })
    .where(eq(researchProgramme.researchProgrammeId, input.programmeId));
}

export async function promoteDeferredAfterTerminalTx(
  tx: DbTransaction,
  programmeId: string,
  now: Date,
): Promise<{ promotedRunId: string | null }> {
  const [active] = await tx
    .select({ id: scheduledJob.scheduledJobId })
    .from(scheduledJob)
    .where(
      sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
        and ${scheduledJob.researchProgrammeId} = ${programmeId}::uuid
        and ${scheduledJob.status} in ('running', 'cancel_requested')`,
    )
    .limit(1)
    .for("update");
  if (active) return { promotedRunId: null };
  const [deferred] = await tx
    .select()
    .from(scheduledJob)
    .where(
      sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
        and ${scheduledJob.researchProgrammeId} = ${programmeId}::uuid
        and ${scheduledJob.status} = 'deferred'`,
    )
    .limit(1)
    .for("update");
  if (!deferred) return { promotedRunId: null };
  await tx
    .update(scheduledJob)
    .set({
      status: "cancelled",
      completedAt: now,
      stateVersion: sql`${scheduledJob.stateVersion} + 1`,
      result: sql`coalesce(${scheduledJob.result}, '{}'::jsonb) || ${JSON.stringify({ outcome: "superseded_by_deferred_promotion" })}::jsonb`,
      updatedAt: now,
    })
    .where(
      sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
        and ${scheduledJob.researchProgrammeId} = ${programmeId}::uuid
        and ${scheduledJob.status} = 'pending'`,
    );
  const payload = parsePayload(deferred.payload);
  payload.slot.trigger = "deferred";
  payload.slot.deferredThrough = now.toISOString();
  const context = await currentPublishedContextTx(tx, programmeId);
  await tx
    .update(scheduledJob)
    .set({
      status: "pending",
      runAt: now,
      payload,
      researchProgrammeVersionId: context.version.researchProgrammeVersionId,
      stateVersion: sql`${scheduledJob.stateVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(scheduledJob.scheduledJobId, deferred.scheduledJobId),
        eq(scheduledJob.status, "deferred"),
      ),
    );
  return { promotedRunId: deferred.scheduledJobId };
}

type ProgrammeVersionContext = {
  programme: typeof researchProgramme.$inferSelect;
  version: typeof researchProgrammeVersion.$inferSelect;
  snapshot: DiscoveryProgrammeSnapshot;
};

async function currentPublishedContextTx(
  tx: DbTransaction,
  programmeId: string,
): Promise<ProgrammeVersionContext> {
  const [programme] = await tx
    .select()
    .from(researchProgramme)
    .where(eq(researchProgramme.researchProgrammeId, programmeId))
    .limit(1)
    .for("update");
  if (!programme)
    throw new DiscoveryRunError("NOT_FOUND", "PROGRAMME_NOT_FOUND");
  if (!programme.publishedVersion)
    throw new DiscoveryRunError("INVALID_STATE", "PROGRAMME_NOT_PUBLISHED");
  const [version] = await tx
    .select()
    .from(researchProgrammeVersion)
    .where(
      and(
        eq(researchProgrammeVersion.researchProgrammeId, programmeId),
        eq(
          researchProgrammeVersion.versionNumber,
          programme.publishedVersion,
        ),
      ),
    )
    .limit(1);
  if (!version)
    throw new DiscoveryRunError(
      "INVALID_STATE",
      "PUBLISHED_SNAPSHOT_MISSING",
    );
  return {
    programme,
    version,
    snapshot: version.configuration as DiscoveryProgrammeSnapshot,
  };
}

function canAccessProgramme(
  programme: { ownerEmployeeId: string; reviewerEmployeeIds: string[] },
  actorEmployeeId: string,
  isAdmin: boolean,
) {
  return (
    isAdmin ||
    programme.ownerEmployeeId === actorEmployeeId ||
    programme.reviewerEmployeeIds.includes(actorEmployeeId)
  );
}

export async function requestDiscoveryRun(input: {
  programmeId: string;
  expectedVersion: number;
  requestId: string;
  overlap: "defer" | "cancel_and_restart";
  actorEmployeeId: string;
  isAdmin: boolean;
}): Promise<{
  status: "pending" | "deferred";
  runId: string;
  nextWakeAt: string;
}> {
  const parsed = z
    .object({
      programmeId: UuidSchema,
      expectedVersion: z.number().int().positive(),
      requestId: UuidSchema,
      overlap: z.enum(["defer", "cancel_and_restart"]),
      actorEmployeeId: UuidSchema,
      isAdmin: z.boolean(),
    })
    .parse(input);
  return database().transaction(async (tx) => {
    const context = await currentPublishedContextTx(tx, parsed.programmeId);
    if (
      !canAccessProgramme(
        context.programme,
        parsed.actorEmployeeId,
        parsed.isAdmin,
      )
    )
      throw new DiscoveryRunError("FORBIDDEN", "PROGRAMME_ACCESS_DENIED");
    if (context.programme.version !== parsed.expectedVersion)
      throw new DiscoveryRunError("STALE_FENCE", "PROGRAMME_VERSION_CONFLICT");
    if (context.programme.state !== "active")
      throw new DiscoveryRunError("INVALID_STATE", "PROGRAMME_NOT_ACTIVE");
    const now = await databaseNow(tx);
    const manualKey = `discovery:${parsed.programmeId}:manual:${parsed.requestId}`;
    const [replayed] = await tx
      .select()
      .from(scheduledJob)
      .where(eq(scheduledJob.jobKey, manualKey))
      .limit(1)
      .for("update");
    if (replayed) {
      if (replayed.status === "pending")
        return {
          status: "pending" as const,
          runId: replayed.scheduledJobId,
          nextWakeAt: replayed.runAt.toISOString(),
        };
      if (
        replayed.status === "deferred" ||
        replayed.status === "running" ||
        replayed.status === "cancel_requested"
      )
        return {
          status: "deferred" as const,
          runId: replayed.scheduledJobId,
          nextWakeAt: now.toISOString(),
        };
      throw new DiscoveryRunError(
        "REPLAY_CONFLICT",
        "MANUAL_REQUEST_ALREADY_TERMINAL",
      );
    }
    const [active] = await tx
      .select()
      .from(scheduledJob)
      .where(
        sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
          and ${scheduledJob.researchProgrammeId} = ${parsed.programmeId}::uuid
          and ${scheduledJob.status} in ('running', 'cancel_requested')`,
      )
      .limit(1)
      .for("update");
    if (active) {
      if (parsed.overlap === "cancel_and_restart" && active.status === "running")
        await tx
          .update(scheduledJob)
          .set({
            status: "cancel_requested",
            stateVersion: sql`${scheduledJob.stateVersion} + 1`,
            result: sql`coalesce(${scheduledJob.result}, '{}'::jsonb) || ${JSON.stringify({ cancel: { requestedAt: now.toISOString(), reason: "manual_restart", actorEmployeeId: parsed.actorEmployeeId } })}::jsonb`,
            updatedAt: now,
          })
          .where(eq(scheduledJob.scheduledJobId, active.scheduledJobId));
      const [deferred] = await tx
        .select()
        .from(scheduledJob)
        .where(
          sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
            and ${scheduledJob.researchProgrammeId} = ${parsed.programmeId}::uuid
            and ${scheduledJob.status} = 'deferred'`,
        )
        .limit(1)
        .for("update");
      if (deferred) {
        const payload = parsePayload(deferred.payload);
        const alreadyRecorded =
          payload.slot.requestId === parsed.requestId ||
          payload.slot.coalescedRequestIds.includes(parsed.requestId);
        if (!alreadyRecorded) {
          payload.slot.deferredThrough = now.toISOString();
          payload.slot.missedCount += 1;
          payload.slot.coalescedRequestIds = [
            ...payload.slot.coalescedRequestIds,
            parsed.requestId,
          ].slice(-100);
          await tx
            .update(scheduledJob)
            .set({ payload, updatedAt: now })
            .where(eq(scheduledJob.scheduledJobId, deferred.scheduledJobId));
        }
        return {
          status: "deferred" as const,
          runId: deferred.scheduledJobId,
          nextWakeAt: now.toISOString(),
        };
      }
      const [created] = await tx
        .insert(scheduledJob)
        .values({
          jobKey: `discovery:${parsed.programmeId}:manual:${parsed.requestId}`,
          kind: SALES_RESEARCH_RUN_JOB_KIND,
          runAt: now,
          payload: jobPayload({
            programmeId: parsed.programmeId,
            programmeName: context.snapshot.config.name,
            scheduleGeneration: context.programme.scheduleGeneration,
            trigger: "deferred",
            nominalDueAt: now,
            requestId: parsed.requestId,
            deferredFrom: now,
            deferredThrough: now,
          }),
          status: "deferred",
          concurrencyKey: concurrencyKey(parsed.programmeId),
          researchProgrammeId: parsed.programmeId,
          researchProgrammeVersionId: null,
          result: emptyResult(),
        })
        .returning({ id: scheduledJob.scheduledJobId });
      return {
        status: "deferred" as const,
        runId: created!.id,
        nextWakeAt: now.toISOString(),
      };
    }
    await tx
      .update(scheduledJob)
      .set({
        status: "cancelled",
        completedAt: now,
        stateVersion: sql`${scheduledJob.stateVersion} + 1`,
        result: sql`coalesce(${scheduledJob.result}, '{}'::jsonb) || ${JSON.stringify({ outcome: "replaced_by_manual_run" })}::jsonb`,
        updatedAt: now,
      })
      .where(
        sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
          and ${scheduledJob.researchProgrammeId} = ${parsed.programmeId}::uuid
          and ${scheduledJob.status} = 'pending'`,
      );
    const jobId = await insertPendingSlotTx(tx, {
      programmeId: parsed.programmeId,
      programmeName: context.snapshot.config.name,
      programmeVersionId: context.version.researchProgrammeVersionId,
      scheduleGeneration: context.programme.scheduleGeneration,
      runAt: now,
      trigger: "manual",
      requestId: parsed.requestId,
    });
    return {
      status: "pending" as const,
      runId: jobId,
      nextWakeAt: now.toISOString(),
    };
  });
}

function wakeEvent(row: {
  scheduledJobId: string;
  researchProgrammeId: string | null;
  runAt: Date;
  payload: JsonObject;
}): DiscoveryWakeEventV1 {
  const payload = parsePayload(row.payload);
  if (!row.researchProgrammeId)
    throw new DiscoveryRunError("INVALID_STATE", "RUN_PROGRAMME_MISSING");
  return {
    schemaVersion: 1,
    jobId: row.scheduledJobId,
    programmeId: row.researchProgrammeId,
    scheduleGeneration: payload.scheduleGeneration,
    runAt: row.runAt.toISOString(),
  };
}

export async function prepareDiscoveryDispatch(jobIdInput: string): Promise<
  | {
      status: "ready";
      eventId: string;
      dispatchToken: string;
      event: DiscoveryWakeEventV1;
    }
  | {
      status:
        | "outside_horizon"
        | "already_dispatched"
        | "already_dispatching"
        | "terminal"
        | "missing";
      nextWakeAt: string | null;
    }
> {
  const jobId = UuidSchema.parse(jobIdInput);
  return database().transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(scheduledJob)
      .where(
        and(
          eq(scheduledJob.scheduledJobId, jobId),
          eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) return { status: "missing" as const, nextWakeAt: null };
    if (job.status !== "pending")
      return { status: "terminal" as const, nextWakeAt: null };
    const now = await databaseNow(tx);
    if (job.runAt.getTime() > now.getTime() + DISCOVERY_DISPATCH_HORIZON_MS)
      return {
        status: "outside_horizon" as const,
        nextWakeAt: job.runAt.toISOString(),
      };
    const payload = parsePayload(job.payload);
    const result = parseResult(job.result);
    const repairDueAt = new Date(
      job.runAt.getTime() + DISCOVERY_DISPATCH_REPAIR_AFTER_MS,
    );
    if (
      result.dispatch.state === "dispatched" &&
      now.getTime() < repairDueAt.getTime()
    )
      return {
        status: "already_dispatched" as const,
        nextWakeAt: repairDueAt.toISOString(),
      };
    if (
      result.dispatch.state === "dispatching" &&
      result.dispatch.leaseExpiresAt &&
      new Date(result.dispatch.leaseExpiresAt).getTime() > now.getTime()
    )
      return {
        status: "already_dispatching" as const,
        nextWakeAt: result.dispatch.leaseExpiresAt,
      };
    const attempt = result.dispatch.attempts + 1;
    const token = randomUUID();
    const eventId = `${dispatchEventId(job.scheduledJobId, payload.scheduleGeneration)}:d${attempt}`;
    result.dispatch = {
      state: "dispatching",
      eventId,
      attempts: attempt,
      lastAttemptAt: now.toISOString(),
      providerReceiptId: result.dispatch.providerReceiptId,
      errorCode: null,
      token,
      leaseExpiresAt: new Date(
        now.getTime() + DISCOVERY_DISPATCH_LEASE_MS,
      ).toISOString(),
    };
    const [updated] = await tx
      .update(scheduledJob)
      .set({
        result,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledJob.scheduledJobId, job.scheduledJobId),
          eq(scheduledJob.stateVersion, job.stateVersion),
        ),
      )
      .returning({ stateVersion: scheduledJob.stateVersion });
    if (!updated)
      throw new DiscoveryRunError("STALE_FENCE", "RUN_STATE_CONFLICT");
    return {
      status: "ready" as const,
      eventId,
      dispatchToken: token,
      event: wakeEvent(job),
    };
  });
}

export async function recordDiscoveryDispatch(input: {
  jobId: string;
  dispatchToken: string;
  eventId: string;
  providerReceiptId?: string;
  ok: boolean;
  errorCode?: string;
}): Promise<void> {
  const parsed = z
    .object({
      jobId: UuidSchema,
      dispatchToken: UuidSchema,
      eventId: z.string().min(1).max(500),
      providerReceiptId: z.string().max(500).optional(),
      ok: z.boolean(),
      errorCode: z.string().max(200).optional(),
    })
    .parse(input);
  await database().transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(scheduledJob)
      .where(eq(scheduledJob.scheduledJobId, parsed.jobId))
      .limit(1)
      .for("update");
    if (!job) throw new DiscoveryRunError("NOT_FOUND", "RUN_NOT_FOUND");
    const result = parseResult(job.result);
    if (
      result.dispatch.eventId !== parsed.eventId ||
      result.dispatch.token !== parsed.dispatchToken
    )
      throw new DiscoveryRunError("STALE_FENCE", "DISPATCH_EVENT_MISMATCH");
    result.dispatch = {
      ...result.dispatch,
      state: parsed.ok ? "dispatched" : "repair_needed",
      providerReceiptId: parsed.providerReceiptId ?? null,
      errorCode: parsed.ok ? null : (parsed.errorCode ?? "DISPATCH_FAILED"),
      token: null,
      leaseExpiresAt: null,
    };
    await tx
      .update(scheduledJob)
      .set({ result, updatedAt: new Date() })
      .where(eq(scheduledJob.scheduledJobId, parsed.jobId));
  });
}

export async function listPendingDiscoveryDispatchHorizon(input: {
  now?: Date;
  limit?: number;
} = {}): Promise<{
  status: "ready" | "nothing_due" | "repair_needed";
  events: DiscoveryWakeEventV1[];
  nextWakeAt: string | null;
}> {
  const now = input.now ?? new Date();
  const limit = z.number().int().min(1).max(200).parse(input.limit ?? 100);
  const db = database();
  const rows = await db
    .select()
    .from(scheduledJob)
    .where(
      sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
        and ${scheduledJob.status} = 'pending'
        and ${scheduledJob.runAt} <= ${new Date(now.getTime() + DISCOVERY_DISPATCH_HORIZON_MS).toISOString()}::timestamptz`,
    )
    .orderBy(scheduledJob.runAt)
    .limit(limit);
  const events = rows.map((row) => wakeEvent(row));
  const repair = rows.some(
    (row) => parseResult(row.result).dispatch.state === "repair_needed",
  );
  const [next] = await db
    .select({ runAt: scheduledJob.runAt })
    .from(scheduledJob)
    .where(
      and(
        eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
        eq(scheduledJob.status, "pending"),
      ),
    )
    .orderBy(scheduledJob.runAt)
    .limit(1);
  return {
    status: repair ? "repair_needed" : events.length ? "ready" : "nothing_due",
    events,
    nextWakeAt: next?.runAt.toISOString() ?? null,
  };
}

const CONNECTION_TOOLKITS_BY_ADAPTER: Readonly<
  Record<string, readonly string[]>
> = {
  apollo_api: ["apollo"],
  authorised_csv_upload: ["apollo"],
  licensed_search: ["linkedin", "composio:linkedin"],
  licensed_or_announcement: ["linkedin", "composio:linkedin"],
  authenticated_portal: ["tejari"],
};

function sourceToolkitMatches(
  source: DiscoveryProgrammeSnapshotSource,
  toolkit: string,
) {
  return (
    CONNECTION_TOOLKITS_BY_ADAPTER[source.adapter]?.includes(toolkit) ?? false
  );
}

async function buildEffectiveSnapshotTx(
  tx: DbTransaction,
  context: ProgrammeVersionContext,
): Promise<DiscoveryEffectiveSnapshotV1> {
  const principalIds = [
    ...new Set([
      context.snapshot.config.ownerEmployeeId,
      ...context.snapshot.config.reviewerEmployeeIds,
    ]),
  ];
  const principals = await tx
    .select({ id: employee.employeeId })
    .from(employee)
    .where(
      sql`${employee.employeeId} in (select jsonb_array_elements_text(${JSON.stringify(principalIds)}::jsonb)::uuid)
        and ${employee.isActive} = true
        and ${employee.lifecycleStatus} = 'active'`,
    )
    .for("share");
  if (principals.length !== principalIds.length)
    throw new DiscoveryRunError("INVALID_STATE", "PROGRAMME_PRINCIPAL_INACTIVE");

  const bindings = await tx
    .select()
    .from(researchProgrammeSourceBinding)
    .where(
      eq(
        researchProgrammeSourceBinding.researchProgrammeId,
        context.programme.researchProgrammeId,
      ),
    )
    .for("share");
  const bindingsByKey = new Map(
    bindings.map((binding) => [binding.sourceKey, binding]),
  );
  const enabledSources = context.snapshot.sources.filter(
    (source) => source.enabled,
  );
  if (
    context.snapshot.sources.some((source) => source.required && !source.enabled)
  )
    throw new DiscoveryRunError(
      "INVALID_STATE",
      "REQUIRED_DISCOVERY_SOURCE_DISABLED",
    );
  const accountIds = [
    ...new Set(
      enabledSources.flatMap((source) =>
        source.accountReferenceId ? [source.accountReferenceId] : [],
      ),
    ),
  ];
  const accounts = accountIds.length
    ? await tx
        .select({
          id: connectionAccount.connectionAccountId,
          ownerId: connectionAccount.ownerEmployeeId,
          toolkit: connectionAccount.toolkit,
          scope: connectionAccount.scope,
          status: connectionAccount.status,
          expiresAt: connectionAccount.expiresAt,
        })
        .from(connectionAccount)
        .where(
          sql`${connectionAccount.connectionAccountId} in (select jsonb_array_elements_text(${JSON.stringify(accountIds)}::jsonb)::uuid)`,
        )
        .for("share")
    : [];
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  const effectiveSources = enabledSources.flatMap((source) => {
    const binding = bindingsByKey.get(source.sourceKey);
    const bindingMatches =
      binding &&
      binding.adapter === source.adapter &&
      binding.adapterVersion === source.adapterVersion &&
      binding.accountReferenceId === (source.accountReferenceId ?? null) &&
      stableJson(binding.configuration) === stableJson(source.configuration);
    if (!binding || !bindingMatches)
      throw new DiscoveryRunError(
        "INVALID_STATE",
        `SOURCE_BINDING_STALE:${source.sourceKey}`,
      );
    if (
      binding.capabilityState !== "manual" &&
      binding.capabilityState !== "verified" &&
      binding.capabilityState !== "candidate"
    )
      return [];
    const executionMode =
      binding.capabilityState === "manual" ? ("manual" as const) : ("automatic" as const);
    if (source.accountReferenceId) {
      const account = accountsById.get(source.accountReferenceId);
      if (
        !account ||
        account.ownerId !== context.snapshot.config.ownerEmployeeId ||
        account.scope !== "staff" ||
        account.status !== "connected" ||
        (account.expiresAt && account.expiresAt.getTime() <= Date.now()) ||
        !sourceToolkitMatches(source, account.toolkit)
      )
        throw new DiscoveryRunError(
          "INVALID_STATE",
          `SOURCE_CONNECTION_UNAVAILABLE:${source.sourceKey}`,
        );
    }
    return [
      {
        bindingId: binding.researchProgrammeSourceBindingId,
        sourceKey: source.sourceKey,
        adapter: source.adapter,
        adapterVersion: source.adapterVersion,
        configuration: source.configuration,
        accountReferenceId: source.accountReferenceId ?? null,
        credentialGeneration: binding.credentialGeneration,
        enabled: source.enabled,
        required: source.required,
        executionMode,
      },
    ];
  });
  if (
    !effectiveSources.some(
      (source) => source.enabled && source.executionMode === "automatic",
    )
  )
    throw new DiscoveryRunError(
      "INVALID_STATE",
      "NO_AUTOMATIC_DISCOVERY_SOURCES",
    );

  const runtime = runtimeConfiguration();
  const [runtimeAccount] = await tx.execute<{
    connection_account_id: string;
    owner_employee_id: string | null;
    credential_version: string;
  }>(sql`
    select connection_account_id::text, owner_employee_id::text,
           xmin::text as credential_version
    from public.connection_account
    where connection_account_id = ${runtime.connectionId}::uuid
      and owner_employee_id = ${runtime.ownerId}::uuid
      and toolkit = 'n8n'
      and scope = 'staff'
      and status = 'connected'
      and secret_id is not null
      and (expires_at is null or expires_at > statement_timestamp())
    for share
  `);
  if (!runtimeAccount?.owner_employee_id)
    throw new DiscoveryRunError(
      "DEPENDENCY_UNAVAILABLE",
      "DISCOVERY_N8N_EXECUTION_CONNECTION_UNAVAILABLE",
    );
  return DiscoveryEffectiveSnapshotV1Schema.parse({
    programmeVersionId: context.version.researchProgrammeVersionId,
    versionNumber: context.version.versionNumber,
    configHash: context.version.configHash,
    config: context.snapshot.config,
    sources: effectiveSources,
    runtime: {
      ownerEmployeeId: context.snapshot.config.ownerEmployeeId,
      n8nConnectionAccountId: runtimeAccount.connection_account_id,
      n8nConnectionOwnerEmployeeId: runtimeAccount.owner_employee_id,
      n8nCredentialVersion: runtimeAccount.credential_version,
    },
  });
}

async function reauthorizeEffectiveTx(
  tx: DbTransaction,
  effective: DiscoveryEffectiveSnapshotV1,
) {
  const runtime = runtimeConfiguration();
  if (
    runtime.connectionId !== effective.runtime.n8nConnectionAccountId ||
    runtime.ownerId !== effective.runtime.n8nConnectionOwnerEmployeeId
  )
    throw new DiscoveryRunError(
      "DEPENDENCY_UNAVAILABLE",
      "DISCOVERY_N8N_EXECUTION_CONFIGURATION_CHANGED",
    );
  const [runtimeAccount] = await tx.execute<{
    credential_version: string;
  }>(sql`
    select xmin::text as credential_version
    from public.connection_account
    where connection_account_id = ${runtime.connectionId}::uuid
      and owner_employee_id = ${runtime.ownerId}::uuid
      and toolkit = 'n8n' and scope = 'staff' and status = 'connected'
      and secret_id is not null
      and (expires_at is null or expires_at > statement_timestamp())
    for share
  `);
  if (
    !runtimeAccount ||
    runtimeAccount.credential_version !==
      effective.runtime.n8nCredentialVersion
  )
    throw new DiscoveryRunError(
      "STALE_FENCE",
      "DISCOVERY_N8N_CREDENTIAL_CHANGED",
    );
  for (const source of effective.sources) {
    const [binding] = await tx
      .select()
      .from(researchProgrammeSourceBinding)
      .where(
        eq(
          researchProgrammeSourceBinding.researchProgrammeSourceBindingId,
          source.bindingId,
        ),
      )
      .limit(1)
      .for("share");
    if (
      !binding ||
      binding.credentialGeneration !== source.credentialGeneration ||
      binding.accountReferenceId !== source.accountReferenceId ||
      binding.adapter !== source.adapter ||
      binding.adapterVersion !== source.adapterVersion
    )
      throw new DiscoveryRunError(
        "STALE_FENCE",
        `SOURCE_CREDENTIAL_CHANGED:${source.sourceKey}`,
      );
    if (source.accountReferenceId) {
      const [account] = await tx
        .select({
          ownerId: connectionAccount.ownerEmployeeId,
          toolkit: connectionAccount.toolkit,
          scope: connectionAccount.scope,
          status: connectionAccount.status,
          expiresAt: connectionAccount.expiresAt,
        })
        .from(connectionAccount)
        .where(
          eq(connectionAccount.connectionAccountId, source.accountReferenceId),
        )
        .limit(1)
        .for("share");
      if (
        !account ||
        account.ownerId !== effective.runtime.ownerEmployeeId ||
        account.scope !== "staff" ||
        account.status !== "connected" ||
        (account.expiresAt && account.expiresAt.getTime() <= Date.now())
      )
        throw new DiscoveryRunError(
          "STALE_FENCE",
          `SOURCE_CONNECTION_REVOKED:${source.sourceKey}`,
        );
    }
  }
}

function publicTriggerConfiguration(configuration: Record<string, unknown>) {
  const url =
    typeof configuration.url === "string" ? configuration.url : undefined;
  const feedUrl =
    typeof configuration.feedUrl === "string"
      ? configuration.feedUrl
      : undefined;
  return {
    ...(url ? { url } : {}),
    ...(feedUrl ? { feedUrl } : {}),
  };
}

function maxObservationsFromConfig(config: Record<string, unknown>) {
  const limits = config.limits;
  if (
    limits &&
    typeof limits === "object" &&
    typeof (limits as { maxObservations?: unknown }).maxObservations ===
      "number"
  ) {
    const value = (limits as { maxObservations: number }).maxObservations;
    if (Number.isInteger(value) && value >= 1 && value <= 200) return value;
  }
  return 200;
}

export function buildDiscoveryN8nTrigger(input: {
  jobId: string;
  programmeId: string;
  attemptToken: string;
  attempts: number;
  overallDeadlineAt: Date;
  effective: DiscoveryEffectiveSnapshotV1;
}): DiscoveryN8nTriggerV1 {
  const trigger: DiscoveryN8nTriggerV1 = {
    schemaVersion: 1,
    dispatchId: `discovery-trigger:${input.jobId}:a${input.attempts}`,
    runId: input.jobId,
    programmeId: input.programmeId,
    attemptToken: input.attemptToken,
    attemptGeneration: input.attempts,
    overallDeadlineAt: input.overallDeadlineAt.toISOString(),
    maxObservations: maxObservationsFromConfig(input.effective.config),
    sources: input.effective.sources
      .filter((source) => source.enabled && source.executionMode === "automatic")
      .map((source) => ({
        bindingId: source.bindingId,
        sourceKey: source.sourceKey,
        adapter: source.adapter,
        adapterVersion: source.adapterVersion,
        credentialGeneration: source.credentialGeneration,
        executionMode: source.executionMode,
        configuration: publicTriggerConfiguration(source.configuration),
      })),
  };
  if (trigger.sources.length === 0)
    throw new DiscoveryRunError(
      "INVALID_STATE",
      "NO_AUTOMATIC_DISCOVERY_SOURCES",
    );
  return trigger;
}

async function createNextScheduledSlotTx(
  tx: DbTransaction,
  context: ProgrammeVersionContext,
  after: Date,
) {
  const next = nextScheduledAt(context.snapshot, after);
  const jobId = await insertPendingSlotTx(tx, {
    programmeId: context.programme.researchProgrammeId,
    programmeName: context.snapshot.config.name,
    programmeVersionId: context.version.researchProgrammeVersionId,
    scheduleGeneration: context.programme.scheduleGeneration,
    runAt: next,
    trigger: "scheduled",
  });
  await tx
    .update(researchProgramme)
    .set({ nextDueAt: next, updatedAt: after })
    .where(
      eq(
        researchProgramme.researchProgrammeId,
        context.programme.researchProgrammeId,
      ),
    );
  return { jobId, nextWakeAt: next.toISOString() };
}

export async function handleDiscoveryWake(
  eventInput: DiscoveryWakeEventV1,
): Promise<DiscoveryWakeResult> {
  const event = z
    .object({
      schemaVersion: z.literal(1),
      jobId: UuidSchema,
      programmeId: UuidSchema,
      scheduleGeneration: z.number().int().nonnegative(),
      runAt: IsoDateSchema,
    })
    .strict()
    .parse(eventInput);
  return database().transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(scheduledJob)
      .where(
        and(
          eq(scheduledJob.scheduledJobId, event.jobId),
          eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
        ),
      )
      .limit(1)
      .for("update");
    if (!job || job.researchProgrammeId !== event.programmeId)
      return { status: "stale" as const, nextWakeAt: null };
    const payload = parsePayload(job.payload);
    if (
      payload.scheduleGeneration !== event.scheduleGeneration ||
      event.runAt !== job.runAt.toISOString()
    )
      return { status: "stale" as const, nextWakeAt: null };
    const now = await databaseNow(tx);
    const result = parseResult(job.result);
    if (job.status === "cancel_requested") {
      if (!result.n8nClaim) {
        await tx
          .update(scheduledJob)
          .set({
            status: "cancelled",
            completedAt: now,
            attemptToken: null,
            leaseExpiresAt: null,
            overallDeadlineAt: null,
            stateVersion: sql`${scheduledJob.stateVersion} + 1`,
            lastError: null,
            result: { ...result, outcome: "cancelled_before_collector" },
            updatedAt: now,
          })
          .where(eq(scheduledJob.scheduledJobId, job.scheduledJobId));
        await promoteDeferredAfterTerminalTx(tx, event.programmeId, now);
        return {
          status: "cancelled" as const,
          nextWakeAt: null,
          reason: "CANCELLED_BEFORE_COLLECTOR",
        };
      }
      return {
        status: "replay" as const,
        nextWakeAt: null,
        reason: "CANCEL_IN_FLIGHT",
      };
    }
    if (job.status === "running") {
      if (!job.attemptToken || !job.overallDeadlineAt || !payload.effective)
        throw new DiscoveryRunError("INVALID_STATE", "RUN_FENCE_MISSING");
      if (result.n8nClaim)
        return {
          status: "replay" as const,
          nextWakeAt: null,
          reason: "N8N_EXECUTION_ALREADY_CLAIMED",
        };
      if (job.overallDeadlineAt.getTime() <= now.getTime()) {
        await tx
          .update(scheduledJob)
          .set({
            status: "failed",
            completedAt: now,
            attemptToken: null,
            leaseExpiresAt: null,
            stateVersion: sql`${scheduledJob.stateVersion} + 1`,
            lastError: "DISCOVERY_RUN_DEADLINE_EXCEEDED",
            updatedAt: now,
          })
          .where(eq(scheduledJob.scheduledJobId, job.scheduledJobId));
        return {
          status: "blocked" as const,
          nextWakeAt: null,
          reason: "DISCOVERY_RUN_DEADLINE_EXCEEDED",
        };
      }
      await reauthorizeEffectiveTx(tx, payload.effective);
      const leaseExpiresAt = new Date(
        Math.min(
          job.overallDeadlineAt.getTime(),
          now.getTime() + DISCOVERY_HEARTBEAT_LEASE_MS,
        ),
      );
      await tx
        .update(scheduledJob)
        .set({ leaseExpiresAt, updatedAt: now })
        .where(eq(scheduledJob.scheduledJobId, job.scheduledJobId));
      return {
        status: "claimed" as const,
        nextWakeAt: null,
        trigger: buildDiscoveryN8nTrigger({
          jobId: job.scheduledJobId,
          programmeId: event.programmeId,
          attemptToken: job.attemptToken,
          attempts: job.attempts,
          overallDeadlineAt: job.overallDeadlineAt,
          effective: payload.effective,
        }),
      };
    }
    if (job.status !== "pending")
      return { status: "replay" as const, nextWakeAt: null };
    if (job.runAt.getTime() > now.getTime())
      return {
        status: "not_due" as const,
        nextWakeAt: job.runAt.toISOString(),
      };
    const context = await currentPublishedContextTx(tx, event.programmeId);
    if (context.programme.state !== "active")
      return {
        status: "paused" as const,
        nextWakeAt: iso(context.programme.nextDueAt),
      };
    if (context.programme.scheduleGeneration !== event.scheduleGeneration)
      return {
        status: "stale" as const,
        nextWakeAt: iso(context.programme.nextDueAt),
      };
    if (
      job.researchProgrammeVersionId &&
      job.researchProgrammeVersionId !==
        context.version.researchProgrammeVersionId
    )
      return {
        status: "stale" as const,
        nextWakeAt: iso(context.programme.nextDueAt),
      };
    if (!isDiscoveryExecutionEnabled())
      return {
        status: "blocked" as const,
        nextWakeAt: job.runAt.toISOString(),
        reason: "DISCOVERY_EXECUTION_DISABLED",
      };
    const [active] = await tx
      .select()
      .from(scheduledJob)
      .where(
        sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
          and ${scheduledJob.researchProgrammeId} = ${event.programmeId}::uuid
          and ${scheduledJob.status} in ('running', 'cancel_requested')`,
      )
      .limit(1)
      .for("update");
    if (active) {
      const [deferred] = await tx
        .select()
        .from(scheduledJob)
        .where(
          sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
            and ${scheduledJob.researchProgrammeId} = ${event.programmeId}::uuid
            and ${scheduledJob.status} = 'deferred'`,
        )
        .limit(1)
        .for("update");
      if (deferred) {
        const deferredPayload = parsePayload(deferred.payload);
        deferredPayload.slot.deferredThrough = job.runAt.toISOString();
        deferredPayload.slot.missedCount += 1;
        await tx
          .update(scheduledJob)
          .set({ payload: deferredPayload, updatedAt: now })
          .where(eq(scheduledJob.scheduledJobId, deferred.scheduledJobId));
        await tx
          .update(scheduledJob)
          .set({
            status: "coalesced",
            completedAt: now,
            stateVersion: sql`${scheduledJob.stateVersion} + 1`,
            result: { ...result, outcome: "coalesced_into_deferred" },
            updatedAt: now,
          })
          .where(eq(scheduledJob.scheduledJobId, job.scheduledJobId));
      } else {
        payload.slot.trigger = "deferred";
        payload.slot.deferredFrom = job.runAt.toISOString();
        payload.slot.deferredThrough = job.runAt.toISOString();
        payload.slot.missedCount = 1;
        payload.effective = null;
        await tx
          .update(scheduledJob)
          .set({
            status: "deferred",
            payload,
            researchProgrammeVersionId: null,
            stateVersion: sql`${scheduledJob.stateVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(scheduledJob.scheduledJobId, job.scheduledJobId));
      }
      const next = await createNextScheduledSlotTx(
        tx,
        context,
        new Date(Math.max(now.getTime(), job.runAt.getTime())),
      );
      return { status: "deferred" as const, nextWakeAt: next.nextWakeAt };
    }
    const effective = await buildEffectiveSnapshotTx(tx, context);
    payload.effective = effective;
    const attemptToken = randomUUID();
    const attempts = job.attempts + 1;
    const overallDeadlineAt = new Date(
      now.getTime() + DISCOVERY_OVERALL_DEADLINE_MS,
    );
    const leaseExpiresAt = new Date(
      now.getTime() + DISCOVERY_HEARTBEAT_LEASE_MS,
    );
    const [claimed] = await tx
      .update(scheduledJob)
      .set({
        status: "running",
        payload,
        researchProgrammeVersionId:
          context.version.researchProgrammeVersionId,
        attempts,
        stateVersion: sql`${scheduledJob.stateVersion} + 1`,
        attemptToken,
        lockedAt: now,
        leaseExpiresAt,
        overallDeadlineAt,
        lastError: null,
        result: { ...result, n8nClaim: null, n8nRuntimeRevision: null },
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledJob.scheduledJobId, job.scheduledJobId),
          eq(scheduledJob.status, "pending"),
          eq(scheduledJob.stateVersion, job.stateVersion),
        ),
      )
      .returning({ id: scheduledJob.scheduledJobId });
    if (!claimed)
      throw new DiscoveryRunError("STALE_FENCE", "RUN_STATE_CONFLICT");
    const next = await createNextScheduledSlotTx(
      tx,
      context,
      new Date(Math.max(now.getTime(), job.runAt.getTime())),
    );
    return {
      status: "claimed" as const,
      nextWakeAt: next.nextWakeAt,
      trigger: buildDiscoveryN8nTrigger({
        jobId: job.scheduledJobId,
        programmeId: event.programmeId,
        attemptToken,
        attempts,
        overallDeadlineAt,
        effective,
      }),
    };
  });
}

function assertNever(value: never): never {
  throw new DiscoveryRunError(
    "UNSUPPORTED_EVENT",
    `Unhandled discovery variant: ${String(value)}`,
  );
}

export async function authorizeDiscoveryOutboundStep(input: {
  runId: string;
  attemptToken: string;
  attemptGeneration: number;
  operation: "n8n_trigger";
  runtimeRevision: {
    connectionAccountId: string;
    ownerEmployeeId: string;
    credentialVersion: string;
    secretVersion: string;
  };
  cost: { classification: "included" | "metered" };
}): Promise<{ authorized: true; authorizedAt: string }> {
  const parsed = z
    .object({
      runId: UuidSchema,
      attemptToken: UuidSchema,
      attemptGeneration: z.number().int().positive().max(1_000_000),
      operation: z.literal("n8n_trigger"),
      runtimeRevision: z
        .object({
          connectionAccountId: UuidSchema,
          ownerEmployeeId: UuidSchema,
          credentialVersion: z.string().min(1).max(100),
          secretVersion: z.string().min(1).max(200),
        })
        .strict(),
      cost: z
        .object({
          classification: z.enum(["included", "metered"]),
        })
        .strict(),
    })
    .strict()
    .parse(input);
  switch (parsed.operation) {
    case "n8n_trigger":
      break;
    default:
      return assertNever(parsed.operation);
  }
  switch (parsed.cost.classification) {
    case "included":
      break;
    case "metered":
      throw new DiscoveryRunError(
        "DEPENDENCY_UNAVAILABLE",
        "DISCOVERY_METERED_COST_UNVERIFIED",
      );
    default:
      return assertNever(parsed.cost.classification);
  }
  return database().transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(scheduledJob)
      .where(
        and(
          eq(scheduledJob.scheduledJobId, parsed.runId),
          eq(scheduledJob.kind, SALES_RESEARCH_RUN_JOB_KIND),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) throw new DiscoveryRunError("NOT_FOUND", "RUN_NOT_FOUND");
    if (!isDiscoveryExecutionEnabled())
      throw new DiscoveryRunError(
        "INVALID_STATE",
        "DISCOVERY_EXECUTION_DISABLED",
      );
    const payload = parsePayload(job.payload);
    const result = parseResult(job.result);
    if (job.status === "cancel_requested")
      throw new DiscoveryRunError("INVALID_STATE", "RUN_CANCEL_REQUESTED");
    if (job.status !== "running")
      throw new DiscoveryRunError("INVALID_STATE", "RUN_NOT_CLAIMED");
    if (
      !job.attemptToken ||
      job.attemptToken !== parsed.attemptToken ||
      job.attempts !== parsed.attemptGeneration ||
      !payload.effective
    )
      throw new DiscoveryRunError("STALE_FENCE", "RUN_ATTEMPT_MISMATCH");
    if (result.n8nClaim)
      throw new DiscoveryRunError("ALREADY_CLAIMED", "N8N_EXECUTION_ALREADY_CLAIMED");
    await reauthorizeEffectiveTx(tx, payload.effective);
    if (
      payload.effective.runtime.n8nConnectionAccountId !==
        parsed.runtimeRevision.connectionAccountId ||
      payload.effective.runtime.n8nConnectionOwnerEmployeeId !==
        parsed.runtimeRevision.ownerEmployeeId ||
      payload.effective.runtime.n8nCredentialVersion !==
        parsed.runtimeRevision.credentialVersion
    )
      throw new DiscoveryRunError(
        "STALE_FENCE",
        "DISCOVERY_N8N_RUNTIME_REVISION_MISMATCH",
      );
    const now = await databaseNow(tx);
    if (
      result.n8nRuntimeRevision &&
      result.n8nRuntimeRevision.credentialVersion ===
        parsed.runtimeRevision.credentialVersion &&
      result.n8nRuntimeRevision.secretVersion ===
        parsed.runtimeRevision.secretVersion
    )
      return { authorized: true as const, authorizedAt: result.n8nRuntimeRevision.authorizedAt };
    result.n8nRuntimeRevision = {
      credentialVersion: parsed.runtimeRevision.credentialVersion,
      secretVersion: parsed.runtimeRevision.secretVersion,
      authorizedAt: now.toISOString(),
    };
    await tx
      .update(scheduledJob)
      .set({
        result,
        stateVersion: sql`${scheduledJob.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledJob.scheduledJobId, job.scheduledJobId),
          eq(scheduledJob.stateVersion, job.stateVersion),
        ),
      );
    return { authorized: true as const, authorizedAt: now.toISOString() };
  });
}

export async function reconcileDiscoveryRuns(): Promise<{
  expiredDispatchLeases: number;
  failedDeadlines: number;
  dispatchRepairNeeded: number;
}> {
  return database().transaction(async (tx) => {
    const now = await databaseNow(tx);
    const rows = await tx
      .select()
      .from(scheduledJob)
      .where(
        sql`${scheduledJob.kind} = ${SALES_RESEARCH_RUN_JOB_KIND}
          and ${scheduledJob.status} in ('pending', 'running', 'cancel_requested')`,
      )
      .for("update");
    let expiredDispatchLeases = 0;
    let failedDeadlines = 0;
    let dispatchRepairNeeded = 0;
    for (const job of rows) {
      const result = parseResult(job.result);
      if (
        job.status === "pending" &&
        result.dispatch.state === "dispatching" &&
        result.dispatch.leaseExpiresAt &&
        new Date(result.dispatch.leaseExpiresAt).getTime() <= now.getTime()
      ) {
        result.dispatch = {
          ...result.dispatch,
          state: "repair_needed",
          token: null,
          leaseExpiresAt: null,
          errorCode: "DISPATCH_LEASE_EXPIRED",
        };
        await tx
          .update(scheduledJob)
          .set({ result, lastError: "DISPATCH_LEASE_EXPIRED", updatedAt: now })
          .where(eq(scheduledJob.scheduledJobId, job.scheduledJobId));
        expiredDispatchLeases += 1;
        dispatchRepairNeeded += 1;
        continue;
      }
      if (
        job.status === "pending" &&
        result.dispatch.state === "dispatched" &&
        now.getTime() >=
          job.runAt.getTime() + DISCOVERY_DISPATCH_REPAIR_AFTER_MS
      ) {
        result.dispatch = {
          ...result.dispatch,
          state: "repair_needed",
          errorCode: result.dispatch.errorCode ?? "DISPATCH_UNCLAIMED",
        };
        await tx
          .update(scheduledJob)
          .set({ result, lastError: "DISPATCH_UNCLAIMED", updatedAt: now })
          .where(eq(scheduledJob.scheduledJobId, job.scheduledJobId));
        dispatchRepairNeeded += 1;
        continue;
      }
      if (
        (job.status === "running" || job.status === "cancel_requested") &&
        job.overallDeadlineAt &&
        job.overallDeadlineAt.getTime() <= now.getTime()
      ) {
        await tx
          .update(scheduledJob)
          .set({
            status: "failed",
            completedAt: now,
            attemptToken: null,
            leaseExpiresAt: null,
            stateVersion: sql`${scheduledJob.stateVersion} + 1`,
            lastError: "DISCOVERY_RUN_DEADLINE_EXCEEDED",
            result: { ...result, outcome: "deadline_exceeded" },
            updatedAt: now,
          })
          .where(eq(scheduledJob.scheduledJobId, job.scheduledJobId));
        if (job.researchProgrammeId)
          await promoteDeferredAfterTerminalTx(
            tx,
            job.researchProgrammeId,
            now,
          );
        failedDeadlines += 1;
      }
    }
    return { expiredDispatchLeases, failedDeadlines, dispatchRepairNeeded };
  });
}
