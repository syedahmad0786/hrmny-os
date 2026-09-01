import { createHash } from "node:crypto";
import {
  ApolloProviderRequestError,
  createLeadSourceLive,
  isRetryableApolloProviderError,
  type LeadCandidate,
  type LeadSearchCriteria,
  type LeadSearchExecution,
  type LeadSearchProviderReceipt,
  type LeadSourceAdapter,
} from "@hrmny/integrations";
import {
  and,
  connectionAccount,
  eq,
  integrationInbox,
  scheduledJob,
  sql,
  type Db,
} from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import {
  beginIntegrationReceiptAttempt,
  completeIntegrationReceiptIfProcessing,
  getIntegrationReceipt,
  hashIntegrationPayload,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
  type IntegrationReceipt,
} from "../integrations/inbox";
import {
  markOwnedIntegrationConnectionAuthError,
  resolveOwnedIntegrationApiKey,
} from "../integrations/resolve-keys";
import { sendApolloSearchRetryEvent } from "../inngest/apollo-search-retry";

export const APOLLO_PEOPLE_SEARCH_OPERATION = "people.search.zero-credit";
export const APOLLO_PEOPLE_SEARCH_JOB_KIND = "apollo_people_search";
export const APOLLO_PEOPLE_SEARCH_MAX_ATTEMPTS = 3;

export type ApolloFreeSearchCandidate = Pick<
  LeadCandidate,
  | "externalId"
  | "fullName"
  | "title"
  | "companyName"
  | "companyDomain"
  | "source"
>;
export type ApolloPeopleSearchStatus =
  "processing" | "retry_scheduled" | "completed" | "dead_letter" | "revoked";

export type ApolloPeopleSearchResult = {
  receiptId: string;
  idempotencyKey: string;
  duplicate: boolean;
  mode: "mock" | "live";
  status: ApolloPeopleSearchStatus;
  attempts: number;
  candidates: ApolloFreeSearchCandidate[];
  nextAttemptAt?: string;
  queue?: "inngest" | "scheduled_job_fallback" | "injected_test_queue";
  providerReceipt?: LeadSearchProviderReceipt;
  reconciliation?: {
    state: "verified";
    verifiedAt: string;
    providerReadback: "synchronous_response";
    candidateCount: number;
    candidateIdsHash: string;
    providerResponseHash: string;
  };
  reason?: string;
};

type NormalizedSearchCriteria = Required<
  Pick<LeadSearchCriteria, "locations" | "page" | "perPage">
> &
  Pick<LeadSearchCriteria, "query" | "titles">;

export type ApolloPeopleSearchRetryPayload = {
  receiptId: string;
  idempotencyKey: string;
};

export const ApolloPeopleSearchRetryPayloadSchema = z.object({
  receiptId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});

const StoredApolloPeopleSearchPayloadSchema = z.object({
  actorEmployeeId: z.string().uuid(),
  criteria: z.object({
    query: z.string().min(1).max(160).optional(),
    titles: z.array(z.string().min(1).max(120)).max(8).optional(),
    locations: z.tuple([z.literal("United Arab Emirates")]),
    page: z.literal(1),
    perPage: z.number().int().min(1).max(10),
  }),
  creditUsage: z.literal(0),
  personalEmail: z.literal(false),
  phone: z.literal(false),
  waterfalls: z.literal(false),
});

type RetrySchedule = {
  jobId: string;
  nextAttemptAt: string;
  queue?: "inngest" | "scheduled_job_fallback" | "injected_test_queue";
  queueReceiptId?: string;
};

export type ApolloSearchDeps = {
  leadSource?: LeadSourceAdapter;
  resolveApiKey?: typeof resolveOwnedIntegrationApiKey;
  allowSynthetic?: boolean;
  now?: () => Date;
  scheduleRetry?: (
    payload: ApolloPeopleSearchRetryPayload,
    runAt: Date,
  ) => Promise<RetrySchedule | null>;
  publishRetryEvent?: typeof sendApolloSearchRetryEvent;
  cancelRetry?: (receiptId: string) => Promise<boolean>;
  authorizeActor?: (actorEmployeeId: string) => Promise<boolean>;
  /** Internal fence shared by the scheduled-job and receipt attempt. */
  workerAttemptToken?: string;
  /** Independent connection used by PostgreSQL concurrency proofs. */
  database?: Db;
  /** Deterministic crash injection inside the enqueue transaction. */
  afterAtomicReceiptInsert?: () => Promise<void>;
  /** Deterministic stale-repair race injection for PostgreSQL CAS proofs. */
  beforeTerminalJobRepair?: (jobId: string) => Promise<void>;
};

export class ApolloSearchRetryError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("APOLLO_SEARCH_RETRY_SCHEDULED");
    this.name = "ApolloSearchRetryError";
  }
}

class ApolloSearchConnectionRequiredError extends Error {
  constructor() {
    super("APOLLO_FREE_SEARCH_CONNECTION_REQUIRED");
    this.name = "ApolloSearchConnectionRequiredError";
  }
}

class ApolloSearchAuthorizationRevokedError extends Error {
  constructor() {
    super("APOLLO_SEARCH_AUTHORIZATION_REVOKED");
    this.name = "ApolloSearchAuthorizationRevokedError";
  }
}

function normalizedCriteria(input: {
  query?: string;
  titles?: string[];
  perPage?: number;
}): NormalizedSearchCriteria {
  const query = input.query?.trim() || undefined;
  const titles = Array.from(
    new Set((input.titles ?? []).map((title) => title.trim()).filter(Boolean)),
  ).sort();
  return {
    query,
    titles: titles.length ? titles : undefined,
    locations: ["United Arab Emirates"],
    page: 1,
    perPage: Math.min(Math.max(input.perPage ?? 8, 1), 10),
  };
}

function requestPayload(input: {
  actorEmployeeId?: string | null;
  criteria: NormalizedSearchCriteria;
}) {
  return {
    actorEmployeeId: input.actorEmployeeId ?? null,
    criteria: input.criteria,
    creditUsage: 0,
    personalEmail: false,
    phone: false,
    waterfalls: false,
  };
}

function safeCandidates(
  candidates: LeadCandidate[],
): ApolloFreeSearchCandidate[] {
  return candidates.map((candidate) => ({
    externalId: candidate.externalId,
    fullName: candidate.fullName,
    title: candidate.title,
    companyName: candidate.companyName,
    companyDomain: candidate.companyDomain,
    source: candidate.source,
  }));
}

function candidateIdsHash(candidates: ApolloFreeSearchCandidate[]): string {
  return createHash("sha256")
    .update(
      candidates
        .map(({ externalId }) => externalId)
        .sort()
        .join("\n"),
    )
    .digest("hex");
}

function providerObservedAt(
  receipt: LeadSearchProviderReceipt | undefined,
  fallback: Date,
): Date {
  const parsed = receipt?.receivedAt
    ? Date.parse(receipt.receivedAt)
    : Number.NaN;
  return Number.isFinite(parsed)
    ? new Date(Math.max(parsed, fallback.getTime()))
    : fallback;
}

function storedStatus(receipt: IntegrationReceipt): ApolloPeopleSearchStatus {
  const bridgeStatus = receipt.result?.bridgeStatus;
  if (
    bridgeStatus === "processing" ||
    bridgeStatus === "retry_scheduled" ||
    bridgeStatus === "completed" ||
    bridgeStatus === "dead_letter" ||
    bridgeStatus === "revoked"
  ) {
    return bridgeStatus;
  }
  if (receipt.status === "completed") return "completed";
  if (receipt.status === "failed") return "dead_letter";
  return "processing";
}

function resultFromReceipt(
  idempotencyKey: string,
  receipt: IntegrationReceipt,
  duplicate: boolean,
): ApolloPeopleSearchResult {
  const result = receipt.result ?? {};
  const mode = result.mode === "mock" ? "mock" : "live";
  return {
    receiptId: receipt.receiptId,
    idempotencyKey,
    duplicate,
    mode,
    status: storedStatus(receipt),
    attempts: receipt.attempts ?? 0,
    candidates: Array.isArray(result.candidates)
      ? (result.candidates as ApolloFreeSearchCandidate[])
      : [],
    nextAttemptAt:
      typeof result.nextAttemptAt === "string"
        ? result.nextAttemptAt
        : undefined,
    queue:
      result.queue === "inngest" ||
      result.queue === "scheduled_job_fallback" ||
      result.queue === "injected_test_queue"
        ? result.queue
        : undefined,
    providerReceipt:
      result.providerReceipt && typeof result.providerReceipt === "object"
        ? (result.providerReceipt as LeadSearchProviderReceipt)
        : undefined,
    reconciliation:
      result.reconciliation && typeof result.reconciliation === "object"
        ? (result.reconciliation as ApolloPeopleSearchResult["reconciliation"])
        : undefined,
    reason: typeof result.reason === "string" ? result.reason : undefined,
  };
}

function safeFailure(error: unknown): {
  reason: string;
  retryable: boolean;
  retryAfterSeconds: number;
  providerReceipt?: LeadSearchProviderReceipt;
} {
  if (error instanceof ApolloProviderRequestError) {
    return {
      reason:
        error.httpStatus == null
          ? "APOLLO_TRANSPORT_FAILED"
          : `APOLLO_HTTP_${error.httpStatus}`,
      retryable: error.retryable,
      retryAfterSeconds: Math.min(
        Math.max(error.retryAfterSeconds ?? 60, 1),
        86_400,
      ),
      providerReceipt: error.providerReceipt,
    };
  }
  return {
    reason: "APOLLO_SEARCH_FAILED",
    retryable: isRetryableApolloProviderError(error),
    retryAfterSeconds: 60,
  };
}

function isPermanentExecutionContractError(error: unknown): boolean {
  return (
    error instanceof Error &&
    new Set([
      "SYNTHETIC_APOLLO_SEARCH_FORBIDDEN",
      "APOLLO_PROVIDER_RECEIPT_REQUIRED",
    ]).has(error.message)
  );
}

function permanentQueueFailureReason(error: unknown): string | null {
  if (error instanceof z.ZodError) {
    return "APOLLO_SEARCH_RECEIPT_PAYLOAD_INVALID";
  }
  if (!(error instanceof Error)) return null;
  const reasons = new Map<string, string>([
    ["APOLLO_SEARCH_RECEIPT_NOT_FOUND", "APOLLO_SEARCH_RECEIPT_NOT_FOUND"],
    [
      "APOLLO_SEARCH_RECEIPT_OPERATION_MISMATCH",
      "APOLLO_SEARCH_RECEIPT_OPERATION_MISMATCH",
    ],
    [
      "APOLLO_SEARCH_RETRY_PAYLOAD_MISMATCH",
      "APOLLO_SEARCH_RETRY_PAYLOAD_MISMATCH",
    ],
  ]);
  return reasons.get(error.message) ?? null;
}

async function executeSearch(
  source: LeadSourceAdapter,
  criteria: NormalizedSearchCriteria,
  allowSynthetic: boolean,
): Promise<LeadSearchExecution> {
  if (source.mode !== "live" && !allowSynthetic) {
    throw new Error("SYNTHETIC_APOLLO_SEARCH_FORBIDDEN");
  }
  if (source.searchLeadsWithReceipt) {
    return source.searchLeadsWithReceipt(criteria);
  }
  if (!allowSynthetic) throw new Error("APOLLO_PROVIDER_RECEIPT_REQUIRED");
  const candidates = await source.searchLeads(criteria);
  const rawBody = JSON.stringify(safeCandidates(candidates));
  return {
    candidates,
    providerReceipt: {
      provider: "injected_test_adapter",
      operation: "people.search.synthetic",
      httpStatus: 200,
      responseHash: hashIntegrationPayload(rawBody),
      receivedAt: new Date().toISOString(),
      rateLimit: {},
    },
  };
}

async function configuredSource(
  actorEmployeeId: string | null | undefined,
  connectionAccountId: string | null | undefined,
  deps: ApolloSearchDeps,
): Promise<LeadSourceAdapter> {
  if (deps.leadSource) return deps.leadSource;
  if (!deps.resolveApiKey && !connectionAccountId) {
    throw new ApolloSearchConnectionRequiredError();
  }
  const resolver = deps.resolveApiKey ?? resolveOwnedIntegrationApiKey;
  const resolved = await resolver(
    "apollo",
    actorEmployeeId,
    connectionAccountId,
  );
  if (!resolved.apiKey) {
    throw new ApolloSearchConnectionRequiredError();
  }
  return createLeadSourceLive({
    mode: "live",
    apiKey: resolved.apiKey,
    allowPaidOperations: false,
  });
}

async function assertQueuedActorAuthorized(
  actorEmployeeId: string,
  deps: ApolloSearchDeps,
): Promise<void> {
  if (deps.authorizeActor) {
    if (!(await deps.authorizeActor(actorEmployeeId))) {
      throw new ApolloSearchAuthorizationRevokedError();
    }
    return;
  }
  const db = getDb();
  if (!db) throw new ApolloSearchAuthorizationRevokedError();
  const rows = await db.execute<{ authorized: boolean }>(sql`
    select exists (
      select 1
      from public.employee employee
      join public.employee_role membership
        on membership.employee_id = employee.employee_id
      join public.role role on role.role_id = membership.role_id
      where employee.employee_id = ${actorEmployeeId}::uuid
        and employee.is_active = true
        and role.key in ('partner', 'director', 'am', 'account_manager')
    ) as authorized
  `);
  if (rows[0]?.authorized !== true) {
    throw new ApolloSearchAuthorizationRevokedError();
  }
}

type AtomicQueueResult = {
  receipt: IntegrationReceipt;
  schedule?: RetrySchedule;
};

function durableReceipt(
  row: {
    receiptId: string;
    status: string;
    operation: string;
    payload: Record<string, unknown>;
    payloadHash: string;
    attempts: number;
    stateVersion: number;
    attemptToken: string | null;
    attemptLeaseExpiresAt: Date | string | null;
    ownerEmployeeId: string | null;
    credentialConnectionAccountId: string | null;
    result: Record<string, unknown> | null;
    lastError: string | null;
  },
  duplicate: boolean,
): IntegrationReceipt {
  return { ...row, duplicate };
}

/**
 * Create or repair the receipt and its opaque fallback job in one PostgreSQL
 * transaction. Inngest publication happens only after this commits, making
 * the database queue the recoverable authority for every request.
 */
async function enqueueApolloSearchDefault(input: {
  idempotencyKey: string;
  actorEmployeeId: string;
  payload: ReturnType<typeof requestPayload>;
  rawBody: string;
  mode: "mock" | "live";
  now: Date;
  database?: Db;
  afterReceiptInsert?: () => Promise<void>;
  beforeTerminalJobRepair?: (jobId: string) => Promise<void>;
}): Promise<AtomicQueueResult | null> {
  const db = input.database ?? getDb();
  if (!db) return null;
  const provider = "apollo";
  const payloadHash = hashIntegrationPayload(input.rawBody);

  return db.transaction(async (tx) => {
    const [ownedConnection] = await tx
      .select({ id: connectionAccount.connectionAccountId })
      .from(connectionAccount)
      .where(
        and(
          eq(connectionAccount.ownerEmployeeId, input.actorEmployeeId),
          eq(connectionAccount.toolkit, "apollo"),
          eq(connectionAccount.scope, "staff"),
          eq(connectionAccount.status, "connected"),
          sql`(${connectionAccount.expiresAt} is null or ${connectionAccount.expiresAt} > ${input.now.toISOString()}::timestamptz)`,
        ),
      )
      .limit(1);
    if (!ownedConnection) {
      throw new ApolloSearchConnectionRequiredError();
    }
    const inserted = await tx
      .insert(integrationInbox)
      .values({
        provider,
        externalEventId: input.idempotencyKey,
        operation: APOLLO_PEOPLE_SEARCH_OPERATION,
        ownerEmployeeId: input.actorEmployeeId,
        credentialConnectionAccountId: ownedConnection.id,
        payloadHash,
        payload: input.payload,
        status: "received",
        attempts: 0,
        result: { bridgeStatus: "processing", mode: input.mode },
      })
      .onConflictDoNothing({
        target: [integrationInbox.provider, integrationInbox.externalEventId],
      })
      .returning({ id: integrationInbox.integrationInboxId });
    if (inserted[0] && input.afterReceiptInsert) {
      await input.afterReceiptInsert();
    }
    const duplicate = !inserted[0];
    let [receiptRow] = await tx
      .select({
        receiptId: integrationInbox.integrationInboxId,
        status: integrationInbox.status,
        operation: integrationInbox.operation,
        payload: integrationInbox.payload,
        payloadHash: integrationInbox.payloadHash,
        attempts: integrationInbox.attempts,
        stateVersion: integrationInbox.stateVersion,
        attemptToken: integrationInbox.attemptToken,
        attemptLeaseExpiresAt: integrationInbox.attemptLeaseExpiresAt,
        ownerEmployeeId: integrationInbox.ownerEmployeeId,
        credentialConnectionAccountId:
          integrationInbox.credentialConnectionAccountId,
        result: integrationInbox.result,
        lastError: integrationInbox.lastError,
      })
      .from(integrationInbox)
      .where(
        and(
          eq(integrationInbox.provider, provider),
          eq(integrationInbox.externalEventId, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!receiptRow) throw new Error("INTEGRATION_RECEIPT_CONFLICT");
    if (receiptRow.payloadHash !== payloadHash) {
      throw new Error("INTEGRATION_RECEIPT_PAYLOAD_MISMATCH");
    }
    if (receiptRow.operation !== APOLLO_PEOPLE_SEARCH_OPERATION) {
      throw new Error("APOLLO_SEARCH_RECEIPT_OPERATION_MISMATCH");
    }
    const bridgeStatus = receiptRow.result?.bridgeStatus;
    const adoptableLegacyReceipt =
      receiptRow.ownerEmployeeId === null &&
      receiptRow.credentialConnectionAccountId === null &&
      receiptRow.attempts === 0 &&
      receiptRow.attemptToken === null &&
      receiptRow.payload?.actorEmployeeId === input.actorEmployeeId &&
      Boolean(ownedConnection?.id) &&
      (receiptRow.status === "received" ||
        (receiptRow.status === "processing" &&
          bridgeStatus === "retry_scheduled"));
    if (adoptableLegacyReceipt) {
      const [adopted] = await tx
        .update(integrationInbox)
        .set({
          ownerEmployeeId: input.actorEmployeeId,
          credentialConnectionAccountId: ownedConnection!.id,
          stateVersion: sql`${integrationInbox.stateVersion} + 1`,
          updatedAt: input.now,
        })
        .where(
          sql`${integrationInbox.integrationInboxId} = ${receiptRow.receiptId}::uuid
            and ${integrationInbox.ownerEmployeeId} is null
            and ${integrationInbox.credentialConnectionAccountId} is null
            and ${integrationInbox.attempts} = 0
            and ${integrationInbox.attemptToken} is null
            and (
              ${integrationInbox.status} = 'received'
              or (
                ${integrationInbox.status} = 'processing'
                and ${integrationInbox.result} ->> 'bridgeStatus' = 'retry_scheduled'
              )
            )`,
        )
        .returning({
          receiptId: integrationInbox.integrationInboxId,
          status: integrationInbox.status,
          operation: integrationInbox.operation,
          payload: integrationInbox.payload,
          payloadHash: integrationInbox.payloadHash,
          attempts: integrationInbox.attempts,
          stateVersion: integrationInbox.stateVersion,
          attemptToken: integrationInbox.attemptToken,
          attemptLeaseExpiresAt: integrationInbox.attemptLeaseExpiresAt,
          ownerEmployeeId: integrationInbox.ownerEmployeeId,
          credentialConnectionAccountId:
            integrationInbox.credentialConnectionAccountId,
          result: integrationInbox.result,
          lastError: integrationInbox.lastError,
        });
      if (adopted) {
        receiptRow = adopted;
      } else {
        [receiptRow] = await tx
          .select({
            receiptId: integrationInbox.integrationInboxId,
            status: integrationInbox.status,
            operation: integrationInbox.operation,
            payload: integrationInbox.payload,
            payloadHash: integrationInbox.payloadHash,
            attempts: integrationInbox.attempts,
            stateVersion: integrationInbox.stateVersion,
            attemptToken: integrationInbox.attemptToken,
            attemptLeaseExpiresAt: integrationInbox.attemptLeaseExpiresAt,
            ownerEmployeeId: integrationInbox.ownerEmployeeId,
            credentialConnectionAccountId:
              integrationInbox.credentialConnectionAccountId,
            result: integrationInbox.result,
            lastError: integrationInbox.lastError,
          })
          .from(integrationInbox)
          .where(eq(integrationInbox.integrationInboxId, receiptRow.receiptId))
          .limit(1);
        if (!receiptRow) throw new Error("INTEGRATION_RECEIPT_CONFLICT");
      }
    }
    if (receiptRow.ownerEmployeeId !== input.actorEmployeeId) {
      throw new Error("APOLLO_SEARCH_RECEIPT_FORBIDDEN");
    }
    const jobKey = `apollo-people-search:${receiptRow.receiptId}`;

    const currentBridgeStatus = receiptRow.result?.bridgeStatus;
    const isActive =
      receiptRow.status === "received" ||
      (receiptRow.status === "processing" &&
        currentBridgeStatus === "retry_scheduled");
    if (!isActive) {
      return { receipt: durableReceipt(receiptRow, duplicate) };
    }

    let [job] = await tx
      .select({
        id: scheduledJob.scheduledJobId,
        status: scheduledJob.status,
        runAt: scheduledJob.runAt,
        stateVersion: scheduledJob.stateVersion,
      })
      .from(scheduledJob)
      .where(eq(scheduledJob.jobKey, jobKey))
      .limit(1);
    if (!job) {
      await tx
        .insert(scheduledJob)
        .values({
          integrationInboxId: receiptRow.receiptId,
          jobKey,
          kind: APOLLO_PEOPLE_SEARCH_JOB_KIND,
          runAt: input.now,
          payload: {
            receiptId: receiptRow.receiptId,
            idempotencyKey: input.idempotencyKey,
          },
          status: "pending",
          attempts: 0,
          stateVersion: 0,
        })
        .onConflictDoNothing({ target: scheduledJob.jobKey });
      [job] = await tx
        .select({
          id: scheduledJob.scheduledJobId,
          status: scheduledJob.status,
          runAt: scheduledJob.runAt,
          stateVersion: scheduledJob.stateVersion,
        })
        .from(scheduledJob)
        .where(eq(scheduledJob.jobKey, jobKey))
        .limit(1);
    } else if (!new Set(["pending", "running"]).has(job.status)) {
      await input.beforeTerminalJobRepair?.(job.id);
      const [recovered] = await tx
        .update(scheduledJob)
        .set({
          status: "pending",
          runAt: input.now,
          attempts: 0,
          stateVersion: sql`${scheduledJob.stateVersion} + 1`,
          attemptToken: null,
          leaseExpiresAt: null,
          lockedAt: null,
          completedAt: null,
          result: null,
          lastError: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(scheduledJob.scheduledJobId, job.id),
            eq(scheduledJob.status, job.status),
            eq(scheduledJob.stateVersion, job.stateVersion),
          ),
        )
        .returning({
          id: scheduledJob.scheduledJobId,
          status: scheduledJob.status,
          runAt: scheduledJob.runAt,
          stateVersion: scheduledJob.stateVersion,
        });
      if (recovered) {
        job = recovered;
      } else {
        [job] = await tx
          .select({
            id: scheduledJob.scheduledJobId,
            status: scheduledJob.status,
            runAt: scheduledJob.runAt,
            stateVersion: scheduledJob.stateVersion,
          })
          .from(scheduledJob)
          .where(eq(scheduledJob.jobKey, jobKey))
          .limit(1);
      }
    }
    if (!job) throw new Error("APOLLO_SEARCH_RETRY_QUEUE_REQUIRED");

    if (receiptRow.status === "received") {
      const [queued] = await tx
        .update(integrationInbox)
        .set({
          status: "processing",
          result: {
            bridgeStatus: "retry_scheduled",
            mode: input.mode,
            nextAttemptAt: new Date(job.runAt).toISOString(),
            retryJobId: job.id,
            queue: "scheduled_job_fallback",
            reason: "APOLLO_SEARCH_QUEUED",
          },
          lastError: null,
          stateVersion: sql`${integrationInbox.stateVersion} + 1`,
          attemptToken: null,
          attemptLeaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(integrationInbox.integrationInboxId, receiptRow.receiptId),
            eq(integrationInbox.status, "received"),
          ),
        )
        .returning({
          receiptId: integrationInbox.integrationInboxId,
          status: integrationInbox.status,
          operation: integrationInbox.operation,
          payload: integrationInbox.payload,
          payloadHash: integrationInbox.payloadHash,
          attempts: integrationInbox.attempts,
          stateVersion: integrationInbox.stateVersion,
          attemptToken: integrationInbox.attemptToken,
          attemptLeaseExpiresAt: integrationInbox.attemptLeaseExpiresAt,
          ownerEmployeeId: integrationInbox.ownerEmployeeId,
          credentialConnectionAccountId:
            integrationInbox.credentialConnectionAccountId,
          result: integrationInbox.result,
          lastError: integrationInbox.lastError,
        });
      if (queued) receiptRow = queued;
    }

    return {
      receipt: durableReceipt(receiptRow, duplicate),
      schedule: {
        jobId: job.id,
        nextAttemptAt: new Date(job.runAt).toISOString(),
        queue: "scheduled_job_fallback",
      },
    };
  });
}

async function scheduleRetryDefault(
  _payload: ApolloPeopleSearchRetryPayload,
  _runAt: Date,
): Promise<RetrySchedule | null> {
  // PostgreSQL queueing is handled atomically by enqueueApolloSearchDefault.
  // Without that store (memory-only tests/dev), an injected test queue is
  // required and the request fails closed.
  return null;
}

async function cancelRetryDefault(receiptId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const rows = await db.execute<{ scheduled_job_id: string }>(sql`
    update public.scheduled_job
    set status = 'failed', locked_at = null, lease_expires_at = null,
        attempt_token = null, state_version = state_version + 1,
        last_error = 'APOLLO_SEARCH_REVOKED', updated_at = now()
    where integration_inbox_id = ${receiptId}::uuid
      and status = 'pending'
    returning scheduled_job_id
  `);
  return Boolean(rows[0]);
}

function completedResult(input: {
  idempotencyKey: string;
  receipt: IntegrationReceipt;
  mode: "mock" | "live";
  execution: LeadSearchExecution;
  now: Date;
}): ApolloPeopleSearchResult {
  const candidates = safeCandidates(input.execution.candidates);
  const reconciliation = {
    state: "verified" as const,
    verifiedAt: providerObservedAt(
      input.execution.providerReceipt,
      input.now,
    ).toISOString(),
    providerReadback: "synchronous_response" as const,
    candidateCount: candidates.length,
    candidateIdsHash: candidateIdsHash(candidates),
    providerResponseHash: input.execution.providerReceipt.responseHash,
  };
  return {
    receiptId: input.receipt.receiptId,
    idempotencyKey: input.idempotencyKey,
    duplicate: false,
    mode: input.mode,
    status: "completed",
    attempts: input.receipt.attempts ?? 1,
    candidates,
    providerReceipt: input.execution.providerReceipt,
    reconciliation,
  };
}

function storedCompletedResult(result: ApolloPeopleSearchResult) {
  return {
    bridgeStatus: result.status,
    mode: result.mode,
    candidates: result.candidates,
    providerReceipt: result.providerReceipt,
    reconciliation: result.reconciliation,
  };
}

async function finishSearch(input: {
  idempotencyKey: string;
  receipt: IntegrationReceipt;
  attemptToken: string;
  source: LeadSourceAdapter;
  criteria: NormalizedSearchCriteria;
  allowSynthetic: boolean;
  now: Date;
}): Promise<ApolloPeopleSearchResult> {
  const execution = await executeSearch(
    input.source,
    input.criteria,
    input.allowSynthetic,
  );
  const result = completedResult({
    idempotencyKey: input.idempotencyKey,
    receipt: input.receipt,
    mode: input.source.mode,
    execution,
    now: input.now,
  });
  const completed = await completeIntegrationReceiptIfProcessing(
    input.receipt.receiptId,
    input.attemptToken,
    storedCompletedResult(result),
  );
  if (!completed) {
    const current = await getIntegrationReceipt("apollo", input.idempotencyKey);
    if (!current) throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND");
    return resultFromReceipt(input.idempotencyKey, current, true);
  }
  return result;
}

export async function searchApolloPeopleFree(
  input: {
    idempotencyKey: string;
    query?: string;
    titles?: string[];
    perPage?: number;
    actorEmployeeId?: string | null;
  },
  deps: ApolloSearchDeps = {},
): Promise<ApolloPeopleSearchResult> {
  const actorEmployeeId = z.string().uuid().parse(input.actorEmployeeId);
  const criteria = normalizedCriteria(input);
  const payload = requestPayload({
    actorEmployeeId,
    criteria,
  });
  const rawBody = JSON.stringify(payload);
  const now = (deps.now ?? (() => new Date()))();
  const mode = deps.leadSource?.mode ?? "live";
  const atomic = deps.scheduleRetry
    ? null
    : await enqueueApolloSearchDefault({
        idempotencyKey: input.idempotencyKey,
        actorEmployeeId,
        payload,
        rawBody,
        mode,
        now,
        database: deps.database,
        afterReceiptInsert: deps.afterAtomicReceiptInsert,
        beforeTerminalJobRepair: deps.beforeTerminalJobRepair,
      });
  let receipt: IntegrationReceipt;
  let schedule: RetrySchedule | null | undefined;

  if (atomic) {
    receipt = atomic.receipt;
    schedule = atomic.schedule;
    if (!schedule) {
      return resultFromReceipt(input.idempotencyKey, receipt, true);
    }
  } else {
    receipt = await recordIntegrationReceipt({
      provider: "apollo",
      externalEventId: input.idempotencyKey,
      operation: APOLLO_PEOPLE_SEARCH_OPERATION,
      rawBody,
      payload,
      ownerEmployeeId: actorEmployeeId,
      status: "received",
      result: {
        bridgeStatus: "processing",
        mode,
      },
    });
    if (receipt.duplicate && receipt.status !== "received") {
      return resultFromReceipt(input.idempotencyKey, receipt, true);
    }
    schedule = await (deps.scheduleRetry ?? scheduleRetryDefault)(
      {
        receiptId: receipt.receiptId,
        idempotencyKey: input.idempotencyKey,
      },
      now,
    ).catch(() => null);
  }

  if (!schedule) {
    await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      { status: "received", bridgeStatus: "processing" },
      {
        status: "failed",
        processed: true,
        lastError: "APOLLO_SEARCH_RETRY_QUEUE_REQUIRED",
        result: {
          bridgeStatus: "dead_letter",
          mode,
          reason: "APOLLO_SEARCH_RETRY_QUEUE_REQUIRED",
        },
      },
    );
    throw new Error("APOLLO_SEARCH_RETRY_QUEUE_REQUIRED");
  }
  const queuedResult = {
    bridgeStatus: "retry_scheduled",
    mode,
    nextAttemptAt: schedule.nextAttemptAt,
    retryJobId: schedule.jobId,
    queue: schedule.queue ?? "injected_test_queue",
    queueReceiptId: schedule.queueReceiptId,
    reason: "APOLLO_SEARCH_QUEUED",
  };
  const queued = atomic
    ? true
    : await transitionIntegrationReceiptProgress(
        receipt.receiptId,
        { status: "received", bridgeStatus: "processing" },
        {
          status: "processing",
          lastError: null,
          result: queuedResult,
        },
      );
  if (queued && atomic) {
    if (receipt.stateVersion === undefined) {
      throw new Error("APOLLO_SEARCH_STATE_VERSION_REQUIRED");
    }
    const queueReceiptId = await (
      deps.publishRetryEvent ?? sendApolloSearchRetryEvent
    )({
      jobId: schedule.jobId,
      receiptId: receipt.receiptId,
      runAt: schedule.nextAttemptAt,
    }).catch(() => null);
    if (queueReceiptId) {
      await transitionIntegrationReceiptProgress(
        receipt.receiptId,
        {
          status: "processing",
          bridgeStatus: "retry_scheduled",
          stateVersion: receipt.stateVersion,
        },
        {
          status: "processing",
          lastError: null,
          result: {
            ...queuedResult,
            queue: "inngest",
            queueReceiptId,
          },
        },
      );
    }
  }
  const current = await getIntegrationReceipt("apollo", input.idempotencyKey);
  if (!current) throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND");
  return resultFromReceipt(input.idempotencyKey, current, receipt.duplicate);
}

function assertReceiptOwner(
  receipt: IntegrationReceipt,
  actorEmployeeId: string | null | undefined,
) {
  if (receipt.operation !== APOLLO_PEOPLE_SEARCH_OPERATION) {
    throw new Error("APOLLO_SEARCH_RECEIPT_OPERATION_MISMATCH");
  }
  if (
    (receipt.payload?.actorEmployeeId ?? null) !== (actorEmployeeId ?? null)
  ) {
    throw new Error("APOLLO_SEARCH_RECEIPT_FORBIDDEN");
  }
}

export async function getApolloPeopleSearchStatus(input: {
  idempotencyKey: string;
  actorEmployeeId?: string | null;
}): Promise<ApolloPeopleSearchResult | null> {
  const receipt = await getIntegrationReceipt("apollo", input.idempotencyKey);
  if (!receipt) return null;
  assertReceiptOwner(receipt, input.actorEmployeeId);
  return resultFromReceipt(input.idempotencyKey, receipt, true);
}

export async function revokeApolloPeopleSearch(
  input: {
    idempotencyKey: string;
    actorEmployeeId?: string | null;
    administratorOverride?: boolean;
  },
  deps: ApolloSearchDeps = {},
): Promise<ApolloPeopleSearchResult> {
  const receipt = await getIntegrationReceipt("apollo", input.idempotencyKey);
  if (!receipt) throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND");
  if (receipt.operation !== APOLLO_PEOPLE_SEARCH_OPERATION) {
    throw new Error("APOLLO_SEARCH_RECEIPT_OPERATION_MISMATCH");
  }
  if (
    (receipt.payload?.actorEmployeeId ?? null) !==
      (input.actorEmployeeId ?? null) &&
    input.administratorOverride !== true
  ) {
    throw new Error("APOLLO_SEARCH_RECEIPT_FORBIDDEN");
  }
  const current = resultFromReceipt(input.idempotencyKey, receipt, true);
  if (current.status === "completed") {
    throw new Error("APOLLO_SEARCH_ALREADY_COMPLETED");
  }
  if (current.status === "revoked") return current;
  const revokedResult = {
    bridgeStatus: "revoked",
    mode: current.mode,
    reason: "APOLLO_SEARCH_REVOKED",
    revokedByEmployeeId: input.actorEmployeeId ?? null,
    revokedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  const db = getDb();
  let revokedNow: boolean;
  if (db && !deps.cancelRetry) {
    revokedNow = await db.transaction(async (tx) => {
      const [revokedReceipt] = await tx
        .update(integrationInbox)
        .set({
          status: "failed",
          processedAt: new Date(revokedResult.revokedAt),
          lastError: "APOLLO_SEARCH_REVOKED",
          result: revokedResult,
          stateVersion: sql`${integrationInbox.stateVersion} + 1`,
          attemptToken: null,
          attemptLeaseExpiresAt: null,
          updatedAt: new Date(revokedResult.revokedAt),
        })
        .where(
          sql`${integrationInbox.integrationInboxId} = ${receipt.receiptId}::uuid
            and ${integrationInbox.status} in ('received', 'processing')`,
        )
        .returning({ id: integrationInbox.integrationInboxId });
      if (!revokedReceipt) return false;
      await tx
        .update(scheduledJob)
        .set({
          status: "failed",
          lockedAt: null,
          leaseExpiresAt: null,
          attemptToken: null,
          completedAt: new Date(revokedResult.revokedAt),
          lastError: "APOLLO_SEARCH_REVOKED",
          result: {
            receiptId: receipt.receiptId,
            status: "revoked",
            attempts: receipt.attempts ?? 0,
            reason: "APOLLO_SEARCH_REVOKED",
          },
          stateVersion: sql`${scheduledJob.stateVersion} + 1`,
          updatedAt: new Date(revokedResult.revokedAt),
        })
        .where(
          and(
            eq(scheduledJob.integrationInboxId, receipt.receiptId),
            sql`${scheduledJob.status} in ('pending', 'running')`,
          ),
        );
      return true;
    });
  } else {
    revokedNow = await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      { status: "received" },
      {
        status: "failed",
        processed: true,
        lastError: "APOLLO_SEARCH_REVOKED",
        result: revokedResult,
      },
    );
    if (!revokedNow) {
      revokedNow = await transitionIntegrationReceiptProgress(
        receipt.receiptId,
        { status: "processing" },
        {
          status: "failed",
          processed: true,
          lastError: "APOLLO_SEARCH_REVOKED",
          result: revokedResult,
        },
      );
    }
  }
  if (revokedNow && (!db || deps.cancelRetry)) {
    await (deps.cancelRetry ?? cancelRetryDefault)(receipt.receiptId);
  }
  const revoked = await getIntegrationReceipt("apollo", input.idempotencyKey);
  if (!revoked) throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND");
  const result = resultFromReceipt(input.idempotencyKey, revoked, true);
  if (!revokedNow && result.status === "completed") {
    throw new Error("APOLLO_SEARCH_ALREADY_COMPLETED");
  }
  return result;
}

export async function runScheduledApolloPeopleSearch(
  payload: ApolloPeopleSearchRetryPayload,
  deps: ApolloSearchDeps = {},
): Promise<ApolloPeopleSearchResult> {
  let receipt = await getIntegrationReceipt("apollo", payload.idempotencyKey);
  if (!receipt || receipt.receiptId !== payload.receiptId) {
    throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND");
  }
  if (receipt.operation !== APOLLO_PEOPLE_SEARCH_OPERATION) {
    throw new Error("APOLLO_SEARCH_RECEIPT_OPERATION_MISMATCH");
  }
  const stored = StoredApolloPeopleSearchPayloadSchema.parse(receipt.payload);
  const retryPayloadHash = hashIntegrationPayload(
    JSON.stringify(requestPayload(stored)),
  );
  if (retryPayloadHash !== receipt.payloadHash) {
    throw new Error("APOLLO_SEARCH_RETRY_PAYLOAD_MISMATCH");
  }
  const now = (deps.now ?? (() => new Date()))();
  let current = resultFromReceipt(payload.idempotencyKey, receipt, true);
  if (
    current.status === "processing" &&
    receipt.result?.bridgeStatus === "processing"
  ) {
    const leaseExpiresAt = receipt.attemptLeaseExpiresAt
      ? new Date(receipt.attemptLeaseExpiresAt)
      : null;
    if (leaseExpiresAt && leaseExpiresAt.getTime() <= now.getTime()) {
      const expiredAttemptToken = receipt.attemptToken ?? undefined;
      const recovered = await transitionIntegrationReceiptProgress(
        receipt.receiptId,
        {
          status: "processing",
          bridgeStatus: "processing",
          attemptToken: expiredAttemptToken,
        },
        {
          status: "processing",
          lastError: "APOLLO_SEARCH_ATTEMPT_LEASE_EXPIRED",
          result: {
            ...(receipt.result ?? {}),
            bridgeStatus: "retry_scheduled",
            nextAttemptAt: now.toISOString(),
            reason: "APOLLO_SEARCH_ATTEMPT_LEASE_EXPIRED",
          },
        },
      );
      if (recovered) {
        receipt = await getIntegrationReceipt("apollo", payload.idempotencyKey);
        if (!receipt) throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND");
        current = resultFromReceipt(payload.idempotencyKey, receipt, true);
      }
    }
  }
  if (current.status !== "retry_scheduled") return current;
  if (
    current.nextAttemptAt &&
    new Date(current.nextAttemptAt).getTime() > now.getTime()
  ) {
    return current;
  }

  try {
    await assertQueuedActorAuthorized(stored.actorEmployeeId, deps);
  } catch (error) {
    if (!(error instanceof ApolloSearchAuthorizationRevokedError)) throw error;
    await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      { status: "processing", bridgeStatus: "retry_scheduled" },
      {
        status: "failed",
        processed: true,
        lastError: error.message,
        result: {
          bridgeStatus: "revoked",
          mode: deps.leadSource?.mode ?? "live",
          reason: error.message,
        },
      },
    );
    const revoked = await getIntegrationReceipt(
      "apollo",
      payload.idempotencyKey,
    );
    if (!revoked) {
      throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND", { cause: error });
    }
    return resultFromReceipt(payload.idempotencyKey, revoked, true);
  }

  const attemptClaim = await beginIntegrationReceiptAttempt(
    receipt.receiptId,
    APOLLO_PEOPLE_SEARCH_MAX_ATTEMPTS,
    new Date(now.getTime() + 10 * 60_000),
    deps.workerAttemptToken,
  );
  if (!attemptClaim) {
    const latest = await getIntegrationReceipt(
      "apollo",
      payload.idempotencyKey,
    );
    if (!latest) throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND");
    const latestResult = resultFromReceipt(
      payload.idempotencyKey,
      latest,
      true,
    );
    if (
      latestResult.status === "retry_scheduled" &&
      (latest.attempts ?? 0) >= APOLLO_PEOPLE_SEARCH_MAX_ATTEMPTS
    ) {
      await transitionIntegrationReceiptProgress(
        receipt.receiptId,
        { status: "processing", bridgeStatus: "retry_scheduled" },
        {
          status: "failed",
          processed: true,
          lastError: "APOLLO_SEARCH_ATTEMPT_LIMIT_REACHED",
          result: {
            bridgeStatus: "dead_letter",
            mode: deps.leadSource?.mode ?? "live",
            reason: "APOLLO_SEARCH_ATTEMPT_LIMIT_REACHED",
          },
        },
      );
      const dead = await getIntegrationReceipt(
        "apollo",
        payload.idempotencyKey,
      );
      if (!dead) throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND");
      return resultFromReceipt(payload.idempotencyKey, dead, true);
    }
    return latestResult;
  }

  const attempt = attemptClaim.attempts;
  const attemptToken = attemptClaim.attemptToken;
  const attemptReceipt = { ...receipt, attempts: attempt };
  let source: LeadSourceAdapter | undefined;
  try {
    source = await configuredSource(
      stored.actorEmployeeId,
      receipt.credentialConnectionAccountId,
      deps,
    );
    return await finishSearch({
      idempotencyKey: payload.idempotencyKey,
      receipt: attemptReceipt,
      attemptToken,
      source,
      criteria: stored.criteria,
      allowSynthetic: deps.allowSynthetic === true,
      now,
    });
  } catch (error) {
    const mode = source?.mode ?? deps.leadSource?.mode ?? "live";
    if (
      error instanceof ApolloProviderRequestError &&
      (error.httpStatus === 401 || error.httpStatus === 403) &&
      receipt.credentialConnectionAccountId
    ) {
      await markOwnedIntegrationConnectionAuthError({
        toolkit: "apollo",
        employeeId: stored.actorEmployeeId,
        connectionAccountId: receipt.credentialConnectionAccountId,
      }).catch(() => false);
      await transitionIntegrationReceiptProgress(
        receipt.receiptId,
        {
          status: "processing",
          bridgeStatus: "processing",
          attemptToken,
        },
        {
          status: "failed",
          processed: true,
          lastError: "APOLLO_PROVIDER_AUTH_REVOKED",
          result: {
            bridgeStatus: "revoked",
            mode,
            reason: "APOLLO_PROVIDER_AUTH_REVOKED",
            providerReceipt: error.providerReceipt,
          },
        },
      );
      const revoked = await getIntegrationReceipt(
        "apollo",
        payload.idempotencyKey,
      );
      if (!revoked) {
        throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND", { cause: error });
      }
      return resultFromReceipt(payload.idempotencyKey, revoked, true);
    }
    if (
      error instanceof ApolloSearchConnectionRequiredError ||
      error instanceof ApolloSearchAuthorizationRevokedError
    ) {
      await transitionIntegrationReceiptProgress(
        receipt.receiptId,
        {
          status: "processing",
          bridgeStatus: "processing",
          attemptToken,
        },
        {
          status: "failed",
          processed: true,
          lastError: error.message,
          result: {
            bridgeStatus: "revoked",
            mode,
            reason: error.message,
          },
        },
      );
      const revoked = await getIntegrationReceipt(
        "apollo",
        payload.idempotencyKey,
      );
      if (!revoked) {
        throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND", { cause: error });
      }
      return resultFromReceipt(payload.idempotencyKey, revoked, true);
    }
    if (
      !(error instanceof ApolloProviderRequestError) &&
      !isRetryableApolloProviderError(error) &&
      !isPermanentExecutionContractError(error)
    ) {
      throw error;
    }
    const failure = safeFailure(error);
    if (!failure.retryable || attempt >= APOLLO_PEOPLE_SEARCH_MAX_ATTEMPTS) {
      await transitionIntegrationReceiptProgress(
        receipt.receiptId,
        {
          status: "processing",
          bridgeStatus: "processing",
          attemptToken,
        },
        {
          status: "failed",
          processed: true,
          lastError: failure.reason,
          result: {
            bridgeStatus: "dead_letter",
            mode,
            reason: failure.reason,
            providerReceipt: failure.providerReceipt,
          },
        },
      );
      const dead = await getIntegrationReceipt(
        "apollo",
        payload.idempotencyKey,
      );
      if (!dead) {
        throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND", { cause: error });
      }
      return resultFromReceipt(payload.idempotencyKey, dead, true);
    }
    const failureObservedAt = providerObservedAt(
      failure.providerReceipt,
      (deps.now ?? (() => new Date()))(),
    );
    const nextAttemptAt = new Date(
      failureObservedAt.getTime() + failure.retryAfterSeconds * 1_000,
    );
    const retryScheduled = await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      {
        status: "processing",
        bridgeStatus: "processing",
        attemptToken,
      },
      {
        status: "processing",
        lastError: failure.reason,
        result: {
          bridgeStatus: "retry_scheduled",
          mode,
          nextAttemptAt: nextAttemptAt.toISOString(),
          reason: failure.reason,
          providerReceipt: failure.providerReceipt,
          queue: receipt.result?.queue,
        },
      },
    );
    if (!retryScheduled) {
      const latest = await getIntegrationReceipt(
        "apollo",
        payload.idempotencyKey,
      );
      if (!latest) {
        throw new Error("APOLLO_SEARCH_RECEIPT_NOT_FOUND", { cause: error });
      }
      return resultFromReceipt(payload.idempotencyKey, latest, true);
    }
    throw new ApolloSearchRetryError(failure.retryAfterSeconds);
  }
}

export type ApolloPeopleSearchQueueOutcome = {
  status: ApolloPeopleSearchStatus | "not_due" | "busy" | "missing" | "failed";
  receiptId?: string;
  attempts?: number;
  nextAttemptAt?: string;
  reason?: string;
};

function queueSummary(
  result: ApolloPeopleSearchResult,
): Record<string, unknown> {
  return {
    receiptId: result.receiptId,
    status: result.status,
    attempts: result.attempts,
    reason: result.reason ?? null,
  };
}

/**
 * Claim and execute one opaque Apollo job. Provider criteria stay in the
 * immutable, owner-scoped integration receipt and job results retain only a
 * terminal summary.
 */
export async function runApolloPeopleSearchQueuedJob(
  jobIdInput: string,
  deps: ApolloSearchDeps = {},
): Promise<ApolloPeopleSearchQueueOutcome> {
  const jobId = z.string().uuid().parse(jobIdInput);
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for Apollo search jobs");
  const durableDb = db;
  const now = (deps.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const jobAttemptToken = crypto.randomUUID();

  async function readCurrent(): Promise<ApolloPeopleSearchQueueOutcome> {
    const rows = await durableDb.execute<{
      status: string;
      run_at: Date | string;
      locked_at: Date | string | null;
      lease_expires_at: Date | string | null;
      result: Record<string, unknown> | null;
    }>(sql`
      select status, run_at, locked_at, lease_expires_at, result
      from public.scheduled_job
      where scheduled_job_id = ${jobId}::uuid
        and kind = ${APOLLO_PEOPLE_SEARCH_JOB_KIND}
      limit 1
    `);
    const existing = rows[0];
    if (!existing) return { status: "missing" };
    if (existing.status === "pending") {
      return {
        status: "not_due",
        nextAttemptAt: new Date(existing.run_at).toISOString(),
      };
    }
    if (existing.status === "running") {
      const leaseExpiresAt = existing.lease_expires_at
        ? new Date(existing.lease_expires_at).getTime()
        : existing.locked_at
          ? new Date(existing.locked_at).getTime() + 10 * 60_000
          : now.getTime();
      return {
        status: "busy",
        nextAttemptAt: new Date(leaseExpiresAt).toISOString(),
      };
    }
    const storedStatus = existing.result?.status;
    return {
      status:
        storedStatus === "completed" ||
        storedStatus === "dead_letter" ||
        storedStatus === "revoked"
          ? storedStatus
          : existing.status === "completed"
            ? "completed"
            : "failed",
      receiptId:
        typeof existing.result?.receiptId === "string"
          ? existing.result.receiptId
          : undefined,
      attempts:
        typeof existing.result?.attempts === "number"
          ? existing.result.attempts
          : undefined,
      reason:
        typeof existing.result?.reason === "string"
          ? existing.result.reason
          : undefined,
    };
  }

  const claimed = await durableDb.execute<{
    payload: Record<string, unknown>;
    attempts: number;
    integration_inbox_id: string | null;
  }>(sql`
    update public.scheduled_job
    set status = 'running', locked_at = ${nowIso}::timestamptz, attempts = attempts + 1,
        state_version = state_version + 1,
        attempt_token = ${jobAttemptToken}::uuid,
        lease_expires_at = ${new Date(now.getTime() + 10 * 60_000).toISOString()}::timestamptz,
        result = jsonb_build_object('status', 'processing', 'attempts', attempts + 1),
        updated_at = ${nowIso}::timestamptz
    where scheduled_job_id = ${jobId}::uuid
      and kind = ${APOLLO_PEOPLE_SEARCH_JOB_KIND}
      and (
        status = 'pending'
        or (
          status = 'running'
          and (
            lease_expires_at is null
            or lease_expires_at <= ${nowIso}::timestamptz
          )
        )
      )
      and run_at <= ${nowIso}::timestamptz
    returning payload, attempts, integration_inbox_id
  `);
  const job = claimed[0];
  if (!job) return readCurrent();
  const claimedJobAttempts = Number(job.attempts);
  const claimedJobReceiptId = job.integration_inbox_id;

  async function updateClaimedJob(input: {
    status: "pending" | "completed" | "failed";
    runAt: Date;
    completedAt: Date | null;
    result: Record<string, unknown>;
    lastError: string | null;
  }): Promise<boolean> {
    const updated = await durableDb
      .update(scheduledJob)
      .set({
        status: input.status,
        runAt: input.runAt,
        lockedAt: null,
        leaseExpiresAt: null,
        attemptToken: null,
        stateVersion: sql`${scheduledJob.stateVersion} + 1`,
        completedAt: input.completedAt,
        result: input.result,
        lastError: input.lastError,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledJob.scheduledJobId, jobId),
          eq(scheduledJob.status, "running"),
          eq(scheduledJob.attempts, claimedJobAttempts),
          eq(scheduledJob.attemptToken, jobAttemptToken),
        ),
      )
      .returning({ id: scheduledJob.scheduledJobId });
    return Boolean(updated[0]);
  }

  async function deadLetterInvalidClaimedJob(reason: string): Promise<boolean> {
    return durableDb.transaction(async (tx) => {
      const updated = await tx
        .update(scheduledJob)
        .set({
          status: "failed",
          runAt: now,
          lockedAt: null,
          leaseExpiresAt: null,
          attemptToken: null,
          stateVersion: sql`${scheduledJob.stateVersion} + 1`,
          completedAt: now,
          result: { status: "dead_letter", reason },
          lastError: reason,
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledJob.scheduledJobId, jobId),
            eq(scheduledJob.status, "running"),
            eq(scheduledJob.attempts, claimedJobAttempts),
            eq(scheduledJob.attemptToken, jobAttemptToken),
          ),
        )
        .returning({ id: scheduledJob.scheduledJobId });
      if (!updated[0]) return false;

      if (claimedJobReceiptId) {
        await tx
          .update(integrationInbox)
          .set({
            status: "failed",
            processedAt: now,
            lastError: reason,
            result: sql`(coalesce(${integrationInbox.result}, '{}'::jsonb) - 'candidates')
              || jsonb_build_object('bridgeStatus', 'dead_letter', 'reason', ${reason}::text)`,
            stateVersion: sql`${integrationInbox.stateVersion} + 1`,
            attemptToken: null,
            attemptLeaseExpiresAt: null,
            updatedAt: now,
          })
          .where(
            sql`${integrationInbox.integrationInboxId} = ${claimedJobReceiptId}::uuid
              and ${integrationInbox.provider} = 'apollo'
              and ${integrationInbox.operation} = ${APOLLO_PEOPLE_SEARCH_OPERATION}
              and ${integrationInbox.status} in ('received', 'processing')`,
          );
      }
      return true;
    });
  }

  async function persistResult(
    result: ApolloPeopleSearchResult,
  ): Promise<ApolloPeopleSearchQueueOutcome> {
    const nonterminal =
      result.status === "retry_scheduled" || result.status === "processing";
    const runAt = nonterminal
      ? result.nextAttemptAt
        ? new Date(result.nextAttemptAt)
        : new Date(now.getTime() + 60_000)
      : now;
    const failed =
      result.status === "dead_letter" || result.status === "revoked";
    const updated = await updateClaimedJob({
      status: nonterminal ? "pending" : failed ? "failed" : "completed",
      runAt,
      completedAt: nonterminal ? null : now,
      result: queueSummary(result),
      lastError: failed || nonterminal ? (result.reason ?? null) : null,
    });
    if (!updated) return readCurrent();
    return {
      status: result.status,
      receiptId: result.receiptId,
      attempts: result.attempts,
      nextAttemptAt: nonterminal ? runAt.toISOString() : undefined,
      reason: result.reason,
    };
  }

  let payload: ApolloPeopleSearchRetryPayload;
  try {
    payload = ApolloPeopleSearchRetryPayloadSchema.parse(job.payload);
    if (job.integration_inbox_id !== payload.receiptId) {
      throw new Error("APOLLO_SEARCH_JOB_RECEIPT_MISMATCH");
    }
  } catch {
    const reason = "APOLLO_SEARCH_JOB_INVALID";
    const updated = await deadLetterInvalidClaimedJob(reason);
    return updated
      ? {
          status: "dead_letter",
          receiptId: job.integration_inbox_id ?? undefined,
          reason,
        }
      : readCurrent();
  }

  try {
    const result = await runScheduledApolloPeopleSearch(payload, {
      ...deps,
      workerAttemptToken: jobAttemptToken,
    });
    return persistResult(result);
  } catch (error) {
    if (error instanceof ApolloSearchRetryError) {
      const receipt = await getIntegrationReceipt(
        "apollo",
        payload.idempotencyKey,
      );
      const result = receipt
        ? resultFromReceipt(payload.idempotencyKey, receipt, true)
        : null;
      if (result) return persistResult(result);
    }

    const permanentFailure = permanentQueueFailureReason(error);
    if (!permanentFailure) throw error;

    let receipt = await getIntegrationReceipt("apollo", payload.idempotencyKey);
    if (
      receipt?.receiptId === payload.receiptId &&
      receipt.operation === APOLLO_PEOPLE_SEARCH_OPERATION
    ) {
      const bridgeStatus = receipt.result?.bridgeStatus;
      if (bridgeStatus === "processing") {
        await transitionIntegrationReceiptProgress(
          receipt.receiptId,
          {
            status: "processing",
            bridgeStatus: "processing",
            attemptToken: jobAttemptToken,
          },
          {
            status: "failed",
            processed: true,
            lastError: permanentFailure,
            result: {
              bridgeStatus: "dead_letter",
              mode: deps.leadSource?.mode ?? "live",
              reason: permanentFailure,
            },
          },
        );
      } else if (bridgeStatus === "retry_scheduled") {
        await transitionIntegrationReceiptProgress(
          receipt.receiptId,
          { status: "processing", bridgeStatus: "retry_scheduled" },
          {
            status: "failed",
            processed: true,
            lastError: permanentFailure,
            result: {
              bridgeStatus: "dead_letter",
              mode: deps.leadSource?.mode ?? "live",
              reason: permanentFailure,
            },
          },
        );
      }
      receipt = await getIntegrationReceipt("apollo", payload.idempotencyKey);
      if (receipt) {
        const terminal = resultFromReceipt(
          payload.idempotencyKey,
          receipt,
          true,
        );
        if (
          terminal.status === "completed" ||
          terminal.status === "dead_letter" ||
          terminal.status === "revoked"
        ) {
          return persistResult(terminal);
        }
      }
    }

    const updated = await updateClaimedJob({
      status: "failed",
      runAt: now,
      completedAt: now,
      result: { status: "failed", reason: permanentFailure },
      lastError: permanentFailure,
    });
    return updated
      ? {
          status: "failed",
          receiptId: payload.receiptId,
          reason: permanentFailure,
        }
      : readCurrent();
  }
}

/**
 * Remove candidate identity fields after the governed Sales retention window
 * while preserving terminal status, provider hash, reconciliation counts, and
 * the immutable operational receipt.
 */
export async function redactExpiredApolloPeopleSearchCandidates(
  input: {
    now?: Date;
    retentionMonths?: number;
    limit?: number;
  } = {},
): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const retentionMonths = z
    .number()
    .int()
    .min(1)
    .max(120)
    .parse(input.retentionMonths ?? 24);
  const limit = z
    .number()
    .int()
    .min(1)
    .max(500)
    .parse(input.limit ?? 100);
  const redacted = await db.execute<{ integration_inbox_id: string }>(sql`
    with targets as (
      select integration_inbox_id
      from public.integration_inbox
      where provider = 'apollo'
        and operation = ${APOLLO_PEOPLE_SEARCH_OPERATION}
        and status in ('completed', 'failed')
        and processed_at is not null
        and processed_at < ${nowIso}::timestamptz - make_interval(months => ${retentionMonths})
        and result ? 'candidates'
      order by processed_at, integration_inbox_id
      for update skip locked
      limit ${limit}
    )
    update public.integration_inbox inbox
    set result = (coalesce(inbox.result, '{}'::jsonb) - 'candidates')
          || jsonb_build_object(
            'candidateDataState', 'redacted',
            'candidatesRedactedAt', ${nowIso}::text
          ),
        state_version = state_version + 1,
        updated_at = ${nowIso}::timestamptz
    from targets
    where inbox.integration_inbox_id = targets.integration_inbox_id
    returning inbox.integration_inbox_id
  `);
  return redacted.length;
}
