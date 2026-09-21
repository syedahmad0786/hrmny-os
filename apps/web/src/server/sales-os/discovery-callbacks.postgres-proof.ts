import { randomUUID } from "node:crypto";
import type { LLMProvider } from "@hrmny/ai";
import { createDb, sql } from "@hrmny/db";
import { expect, it } from "vitest";
import { getDiscoveryCandidate } from "./discovery-candidates";
import { acceptDiscoveryRuntimeCallback } from "./discovery-callbacks";
import {
  listPendingDiscoveryInterpretationJobs,
  runDiscoveryInterpretationJob,
} from "./discovery-callback-ingest";
import {
  createDiscoveryProgramme,
  DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
  defaultDiscoverySources,
  publishDiscoveryProgramme,
} from "./discovery-programmes";
import { requestDiscoveryRun } from "./discovery-runs";
import { signDiscoveryRuntimeToken } from "./discovery-runtime-contract";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw new Error("LOCAL_POSTGRES_PROOF_REQUIRED");

const db = createDb(databaseUrl);
const secret = "d".repeat(32);
const keyId = "n8n-2026-09";

async function seedRunningDiscoveryCallback(label: string) {
  const ownerId = randomUUID();
  const adminId = randomUUID();
  process.env.DISCOVERY_N8N_CALLBACK_KEYS_JSON = JSON.stringify({
    [keyId]: secret,
  });
  await db.execute(sql`
    insert into public.employee (employee_id, display_name, email)
    values
      (${ownerId}::uuid, ${`${label} owner`}, ${`${label}-owner-${ownerId}@example.invalid`}),
      (${adminId}::uuid, ${`${label} admin`}, ${`${label}-admin-${adminId}@example.invalid`})
  `);
  const created = await createDiscoveryProgramme({
    actorEmployeeId: ownerId,
    config: {
      ...DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
      name: `${label} ${randomUUID()}`,
      ownerEmployeeId: ownerId,
      reviewerEmployeeIds: [],
      limits: {
        ...DEFAULT_DISCOVERY_PROGRAMME_CONFIG.limits,
        maxObservations: 2,
      },
    },
    sources: defaultDiscoverySources(),
  });
  const published = await publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: created.version,
    actorEmployeeId: adminId,
  });
  const requested = await requestDiscoveryRun({
    programmeId: published.id,
    expectedVersion: published.version,
    requestId: randomUUID(),
    overlap: "defer",
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  const [binding] = await db.execute<{
    research_programme_source_binding_id: string;
    credential_generation: number;
  }>(sql`
    select research_programme_source_binding_id::text,
           credential_generation
    from public.research_programme_source_binding
    where research_programme_id = ${created.id}::uuid
      and source_key = 'campaign_me'
    limit 1
  `);
  expect(binding?.research_programme_source_binding_id).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  const [version] = await db.execute<{
    research_programme_version_id: string;
    version_number: number;
    config_hash: string;
    configuration: Record<string, unknown>;
  }>(sql`
    select research_programme_version_id::text, version_number, config_hash,
           configuration
    from public.research_programme_version
    where research_programme_id = ${created.id}::uuid
    order by version_number desc
    limit 1
  `);
  const attemptToken = randomUUID();
  const effective = {
    programmeVersionId: version!.research_programme_version_id,
    versionNumber: version!.version_number,
    configHash: version!.config_hash,
    config: {
      ...(version!.configuration as Record<string, unknown>),
      limits: {
        ...(version!.configuration as { limits?: Record<string, unknown> })
          .limits,
        maxObservations: 2,
      },
      ownerEmployeeId: ownerId,
      reviewerEmployeeIds: [],
    },
    sources: [
      {
        bindingId: binding!.research_programme_source_binding_id,
        sourceKey: "campaign_me",
        adapter: "publisher_feed_or_listing",
        adapterVersion: "unverified-v1",
        configuration: {
          url: "https://campaignme.com/latest/",
          feedUrl: "https://campaignme.com/feed/",
        },
        accountReferenceId: null,
        credentialGeneration: binding!.credential_generation,
        enabled: true,
        required: true,
        executionMode: "automatic" as const,
      },
    ],
    runtime: {
      ownerEmployeeId: ownerId,
      n8nConnectionAccountId: randomUUID(),
      n8nConnectionOwnerEmployeeId: ownerId,
      n8nCredentialVersion: "1",
    },
  };
  await db.execute(sql`
    update public.scheduled_job
    set status = 'running',
        attempts = 1,
        attempt_token = ${attemptToken}::uuid,
        overall_deadline_at = statement_timestamp() + interval '30 minutes',
        lease_expires_at = statement_timestamp() + interval '2 minutes',
        research_programme_version_id = ${version!.research_programme_version_id}::uuid,
        payload = coalesce(payload, '{}'::jsonb) || ${JSON.stringify({
          effective,
        })}::jsonb
    where scheduled_job_id = ${requested.runId}::uuid
  `);
  return {
    runId: requested.runId,
    bindingId: binding!.research_programme_source_binding_id,
    credentialGeneration: binding!.credential_generation,
    attemptToken,
    ownerId,
  };
}

function signedCallback(
  body: Record<string, unknown>,
  eventId = randomUUID(),
) {
  const rawBody = JSON.stringify({ ...body, eventId });
  return {
    eventId,
    rawBody,
    headers: new Headers({
      "x-hrmny-discovery-token": signDiscoveryRuntimeToken(
        secret,
        keyId,
        rawBody,
        eventId,
      ),
    }),
  };
}

async function candidateCount(runId: string) {
  const [row] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from public.discovery_candidate
    where scheduled_job_id = ${runId}::uuid
  `);
  return row?.count ?? 0;
}

async function observationCount(runId: string) {
  const [row] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from public.discovery_observation
    where discovery_candidate_id in (
      select discovery_candidate_id
      from public.discovery_candidate
      where scheduled_job_id = ${runId}::uuid
    )
  `);
  return row?.count ?? 0;
}

async function jobStatus(runId: string) {
  const [row] = await db.execute<{
    status: string;
    lastError: string | null;
    result: Record<string, unknown> | null;
  }>(sql`
    select status, last_error as "lastError", result
    from public.scheduled_job
    where scheduled_job_id = ${runId}::uuid
  `);
  return row;
}

it("ingests a signed public-news callback into Review and replays the same event", async () => {
  const seeded = await seedRunningDiscoveryCallback("callback-ingest");
  const observationId = randomUUID();
  const eventId = randomUUID();
  const rawBody = JSON.stringify({
    schemaVersion: 1,
    event: "sales.discovery.observations.v1",
    eventId,
    runId: seeded.runId,
    sourceId: seeded.bindingId,
    attemptToken: seeded.attemptToken,
    attemptGeneration: 1,
    credentialGeneration: seeded.credentialGeneration,
    payload: {
      observations: [
        {
          observationId,
          sourceItemKey: `campaign-me-${observationId}`,
          contentHash: "c".repeat(64),
          sourceReference: {
            kind: "public_url",
            url: `https://campaignme.com/latest/callback-${observationId}`,
          },
          observedAt: "2026-09-20T06:30:00.000+04:00",
          publishedAt: "2026-09-19T00:00:00.000Z",
          dateEvidence: { method: "feed", precision: "day" },
          kind: "news",
          title: "Public news collector opened a dated review",
          excerpt:
            "Campaign ME published a dated listing that names a relevant UAE review.",
          companyHints: [
            {
              name: `Callback News ${observationId.slice(0, 8)}`,
              domain: `cb-${observationId.slice(0, 8)}.campaignme.com`,
            },
          ],
        },
      ],
    },
  });
  const first = await acceptDiscoveryRuntimeCallback({
    rawBody,
    headers: new Headers({
      "x-hrmny-discovery-token": signDiscoveryRuntimeToken(
        secret,
        keyId,
        rawBody,
        eventId,
      ),
    }),
  });
  expect(first).toEqual({ status: "accepted", eventId });

  const candidates = await db.execute<{
    request_id: string;
    source_key: string | null;
    scheduled_job_id: string | null;
    review_state: string;
    company_name: string;
  }>(sql`
    select request_id, source_key, scheduled_job_id::text, review_state, company_name
    from public.discovery_candidate
    where scheduled_job_id = ${seeded.runId}::uuid
  `);
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    request_id: observationId,
    source_key: "campaign_me",
    scheduled_job_id: seeded.runId,
  });

  const observations = await db.execute<{ source_key: string | null }>(sql`
    select source_key
    from public.discovery_observation
    where discovery_candidate_id = (
      select discovery_candidate_id from public.discovery_candidate
      where request_id = ${observationId}
    )
  `);
  expect(observations).toEqual([{ source_key: "campaign_me" }]);

  const [job] = await db.execute<{ result: Record<string, unknown> }>(sql`
    select result
    from public.scheduled_job
    where scheduled_job_id = ${seeded.runId}::uuid
  `);
  expect(
    (job?.result.sourceOutcomes as Record<string, { sourceKey?: string }>)
      .campaign_me?.sourceKey,
  ).toBe("campaign_me");

  const replay = await acceptDiscoveryRuntimeCallback({
    rawBody,
    headers: new Headers({
      "x-hrmny-discovery-token": signDiscoveryRuntimeToken(
        secret,
        keyId,
        rawBody,
        eventId,
      ),
    }),
  });
  expect(replay).toEqual({ status: "replay", eventId });
  const recount = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from public.discovery_candidate
    where scheduled_job_id = ${seeded.runId}::uuid
  `);
  expect(recount[0]?.count).toBe(1);

  const staleEventId = randomUUID();
  const staleBody = rawBody
    .replace(`"eventId":"${eventId}"`, `"eventId":"${staleEventId}"`)
    .replace(
      `"credentialGeneration":${seeded.credentialGeneration}`,
      `"credentialGeneration":99`,
    );
  const stale = await acceptDiscoveryRuntimeCallback({
    rawBody: staleBody,
    headers: new Headers({
      "x-hrmny-discovery-token": signDiscoveryRuntimeToken(
        secret,
        keyId,
        staleBody,
        staleEventId,
      ),
    }),
  });
  expect(stale).toMatchObject({
    status: "rejected",
    code: "CREDENTIAL_GENERATION_MISMATCH",
    httpStatus: 409,
  });
});

it("keeps provider completion open until durable identity interpretation finalizes", async () => {
  const previousExecutionEnabled = process.env.DISCOVERY_EXECUTION_ENABLED;
  process.env.DISCOVERY_EXECUTION_ENABLED = "true";
  try {
  const seeded = await seedRunningDiscoveryCallback("callback-interpret");
  const observationId = randomUUID();
  const observations = signedCallback({
    schemaVersion: 1,
    event: "sales.discovery.observations.v1",
    runId: seeded.runId,
    sourceId: seeded.bindingId,
    attemptToken: seeded.attemptToken,
    attemptGeneration: 1,
    credentialGeneration: seeded.credentialGeneration,
    payload: {
      observations: [
        {
          observationId,
          sourceItemKey: `campaign-me-interpret-${observationId}`,
          contentHash: "e".repeat(64),
          sourceReference: {
            kind: "public_url",
            url: `https://campaignme.com/latest/interpret-${observationId}`,
          },
          observedAt: "2026-09-20T06:30:00.000+04:00",
          publishedAt: "2026-09-19T00:00:00.000Z",
          dateEvidence: { method: "feed", precision: "day" },
          kind: "news",
          title: "Acme Holdings opened an agency review",
          excerpt:
            "Acme Holdings opened an agency review for its regional communications account.",
          companyHints: [],
        },
      ],
    },
  });
  expect(
    await acceptDiscoveryRuntimeCallback({
      rawBody: observations.rawBody,
      headers: observations.headers,
    }),
  ).toEqual({ status: "accepted", eventId: observations.eventId });

  const completion = signedCallback({
    schemaVersion: 1,
    event: "sales.discovery.completion.v1",
    runId: seeded.runId,
    sourceId: seeded.bindingId,
    attemptToken: seeded.attemptToken,
    attemptGeneration: 1,
    credentialGeneration: seeded.credentialGeneration,
    payload: {
      status: "completed",
      counts: { ingested: 0, duplicate: 0, quarantined: 1, rejected: 0 },
      checkpoint: { cursor: null, providerJobId: null, itemsSeen: 1, pagesSeen: 1 },
      usage: [],
    },
  });
  expect(
    await acceptDiscoveryRuntimeCallback({
      rawBody: completion.rawBody,
      headers: completion.headers,
    }),
  ).toEqual({ status: "accepted", eventId: completion.eventId });
  expect(await jobStatus(seeded.runId)).toMatchObject({ status: "running" });
  expect(await candidateCount(seeded.runId)).toBe(0);

  const provider: LLMProvider = {
    name: "mock",
    async generate() {
      return {
        text: JSON.stringify({
          claims: [],
          relevantService: null,
          opportunityKind: "company_signal",
          awardedAppointment: false,
          unsupported: false,
          companyIdentity: {
            name: "Acme Holdings",
            domain: null,
            ambiguous: false,
          },
        }),
        object: {
          claims: [],
          relevantService: null,
          opportunityKind: "company_signal",
          awardedAppointment: false,
          unsupported: false,
          companyIdentity: {
            name: "Acme Holdings",
            domain: null,
            ambiguous: false,
          },
        },
        provider: "mock",
        model: "mock",
        requestId: "or-interpret-1",
        inputTokens: 20,
        outputTokens: 10,
      };
    },
  };
  expect(
    await runDiscoveryInterpretationJob({
      jobId: seeded.runId,
      sourceKey: "campaign_me",
      attemptToken: seeded.attemptToken,
      attemptGeneration: 1,
      provider,
    }),
  ).toEqual({ status: "completed", remaining: 0 });
  expect(await candidateCount(seeded.runId)).toBe(1);
  expect(await observationCount(seeded.runId)).toBe(1);
  expect(await jobStatus(seeded.runId)).toMatchObject({ status: "completed" });
  const [created] = await db.execute<{
    discovery_candidate_id: string;
    request_id: string;
  }>(sql`
    select discovery_candidate_id::text, request_id::text
    from public.discovery_candidate
    where scheduled_job_id = ${seeded.runId}::uuid
    limit 1
  `);
  expect(created?.request_id).toBe(observationId);
  const reviewed = await getDiscoveryCandidate({
    actorEmployeeId: seeded.ownerId,
    isAdmin: false,
    candidateId: created!.discovery_candidate_id,
  });
  expect(reviewed.evaluation?.packet.identityLineage).toMatchObject({
    observationId,
    semantic: "model",
    provider: "mock",
    model: "mock",
    requestId: "or-interpret-1",
  });
  expect(reviewed.evaluation?.packet.provider).toBe("unavailable");
  expect(reviewed.companyId).toBeNull();
  } finally {
    if (previousExecutionEnabled === undefined) {
      delete process.env.DISCOVERY_EXECUTION_ENABLED;
    } else {
      process.env.DISCOVERY_EXECUTION_ENABLED = previousExecutionEnabled;
    }
  }
});

it("rejects late cancel_requested observations and completed completions without reversing status", async () => {
  const seeded = await seedRunningDiscoveryCallback("callback-cancel");
  await db.execute(sql`
    update public.scheduled_job
    set status = 'cancel_requested',
        result = coalesce(result, '{}'::jsonb) || '{"n8nClaim":{"executionId":"in-flight"}}'::jsonb
    where scheduled_job_id = ${seeded.runId}::uuid
  `);
  const observationId = randomUUID();
  const lateObservation = signedCallback({
    schemaVersion: 1,
    event: "sales.discovery.observations.v1",
    runId: seeded.runId,
    sourceId: seeded.bindingId,
    attemptToken: seeded.attemptToken,
    attemptGeneration: 1,
    credentialGeneration: seeded.credentialGeneration,
    payload: {
      observations: [
        {
          observationId,
          sourceItemKey: `campaign-me-cancel-${observationId}`,
          contentHash: "c".repeat(64),
          sourceReference: {
            kind: "public_url",
            url: `https://campaignme.com/latest/cancel-${observationId}`,
          },
          observedAt: "2026-09-20T06:30:00.000+04:00",
          publishedAt: "2026-09-19T00:00:00.000Z",
          dateEvidence: { method: "feed", precision: "day" },
          kind: "news",
          title: "Late cancelled collector must not open review",
          excerpt:
            "A dated Campaign ME listing arrived after the operator cancelled the run.",
          companyHints: [
            {
              name: `Cancel News ${observationId.slice(0, 8)}`,
              domain: `cx-${observationId.slice(0, 8)}.campaignme.com`,
            },
          ],
        },
      ],
    },
  });
  await expect(
    acceptDiscoveryRuntimeCallback(lateObservation),
  ).resolves.toEqual({
    status: "rejected",
    code: "RUN_CANCEL_REQUESTED",
    httpStatus: 409,
  });
  expect(await candidateCount(seeded.runId)).toBe(0);
  expect(await observationCount(seeded.runId)).toBe(0);
  expect(await jobStatus(seeded.runId)).toMatchObject({
    status: "cancel_requested",
  });

  const completedOverride = signedCallback({
    schemaVersion: 1,
    event: "sales.discovery.completion.v1",
    runId: seeded.runId,
    sourceId: seeded.bindingId,
    attemptToken: seeded.attemptToken,
    attemptGeneration: 1,
    credentialGeneration: seeded.credentialGeneration,
    payload: {
      status: "completed",
      counts: { ingested: 1, duplicate: 0, quarantined: 0, rejected: 0 },
    },
  });
  await expect(
    acceptDiscoveryRuntimeCallback(completedOverride),
  ).resolves.toEqual({
    status: "rejected",
    code: "RUN_CANCEL_REQUESTED",
    httpStatus: 409,
  });
  expect(await jobStatus(seeded.runId)).toMatchObject({
    status: "cancel_requested",
  });
  expect(await candidateCount(seeded.runId)).toBe(0);

  const cancelled = signedCallback({
    schemaVersion: 1,
    event: "sales.discovery.completion.v1",
    runId: seeded.runId,
    sourceId: seeded.bindingId,
    attemptToken: seeded.attemptToken,
    attemptGeneration: 1,
    credentialGeneration: seeded.credentialGeneration,
    payload: {
      status: "cancelled",
      counts: { ingested: 0, duplicate: 0, quarantined: 0, rejected: 1 },
      error: { code: "cancelled", retryable: false },
    },
  });
  await expect(acceptDiscoveryRuntimeCallback(cancelled)).resolves.toEqual({
    status: "accepted",
    eventId: cancelled.eventId,
  });
  expect(await jobStatus(seeded.runId)).toMatchObject({ status: "cancelled" });
  expect(await candidateCount(seeded.runId)).toBe(0);
  expect(await observationCount(seeded.runId)).toBe(0);
});

it("does not persist off-origin evidence and still accepts a Campaign ME article", async () => {
  const seeded = await seedRunningDiscoveryCallback("callback-origin");
  const foreignId = randomUUID();
  const foreign = signedCallback({
    schemaVersion: 1,
    event: "sales.discovery.observations.v1",
    runId: seeded.runId,
    sourceId: seeded.bindingId,
    attemptToken: seeded.attemptToken,
    attemptGeneration: 1,
    credentialGeneration: seeded.credentialGeneration,
    payload: {
      observations: [
        {
          observationId: foreignId,
          sourceItemKey: `foreign-${foreignId}`,
          contentHash: "c".repeat(64),
          sourceReference: {
            kind: "public_url",
            url: `https://communicateonline.me/latest/foreign-${foreignId}`,
          },
          observedAt: "2026-09-20T06:30:00.000+04:00",
          publishedAt: "2026-09-19T00:00:00.000Z",
          dateEvidence: { method: "feed", precision: "day" },
          kind: "news",
          title: "Off-origin listing must not become evidence",
          excerpt:
            "A dated listing from another publication is not Campaign ME provenance.",
          companyHints: [
            {
              name: `Foreign News ${foreignId.slice(0, 8)}`,
              domain: `fx-${foreignId.slice(0, 8)}.communicateonline.me`,
            },
          ],
        },
      ],
    },
  });
  await expect(acceptDiscoveryRuntimeCallback(foreign)).resolves.toEqual({
    status: "accepted",
    eventId: foreign.eventId,
  });
  expect(await candidateCount(seeded.runId)).toBe(0);
  expect(await observationCount(seeded.runId)).toBe(0);

  const validId = randomUUID();
  const valid = signedCallback({
    schemaVersion: 1,
    event: "sales.discovery.observations.v1",
    runId: seeded.runId,
    sourceId: seeded.bindingId,
    attemptToken: seeded.attemptToken,
    attemptGeneration: 1,
    credentialGeneration: seeded.credentialGeneration,
    payload: {
      observations: [
        {
          observationId: validId,
          sourceItemKey: `campaign-me-${validId}`,
          contentHash: "d".repeat(64),
          sourceReference: {
            kind: "public_url",
            url: `https://campaignme.com/latest/origin-${validId}`,
          },
          observedAt: "2026-09-20T06:30:00.000+04:00",
          publishedAt: "2026-09-19T00:00:00.000Z",
          dateEvidence: { method: "feed", precision: "day" },
          kind: "news",
          title: "Campaign ME article stays on the frozen origin",
          excerpt:
            "A dated Campaign ME listing remains permitted public-news evidence.",
          companyHints: [
            {
              name: `Origin News ${validId.slice(0, 8)}`,
              domain: `ox-${validId.slice(0, 8)}.campaignme.com`,
            },
          ],
        },
      ],
    },
  });
  await expect(acceptDiscoveryRuntimeCallback(valid)).resolves.toEqual({
    status: "accepted",
    eventId: valid.eventId,
  });
  expect(await candidateCount(seeded.runId)).toBe(1);
  expect(await observationCount(seeded.runId)).toBe(1);
});

function mockIdentityProvider(requestId: string, onGenerate?: () => Promise<void>): LLMProvider {
  return {
    name: "mock",
    async generate() {
      await onGenerate?.();
      return {
        text: JSON.stringify({
          claims: [],
          relevantService: null,
          opportunityKind: "company_signal",
          awardedAppointment: false,
          unsupported: false,
          companyIdentity: {
            name: "Acme Holdings",
            domain: null,
            ambiguous: false,
          },
        }),
        object: {
          claims: [],
          relevantService: null,
          opportunityKind: "company_signal",
          awardedAppointment: false,
          unsupported: false,
          companyIdentity: {
            name: "Acme Holdings",
            domain: null,
            ambiguous: false,
          },
        },
        provider: "mock",
        model: "mock",
        requestId,
        inputTokens: 20,
        outputTokens: 10,
      };
    },
  };
}

it("persists cancellation before the interpretation final write and does not ingest", async () => {
  const previousExecutionEnabled = process.env.DISCOVERY_EXECUTION_ENABLED;
  process.env.DISCOVERY_EXECUTION_ENABLED = "true";
  try {
    const seeded = await seedRunningDiscoveryCallback("callback-cancel-before");
    const observationId = randomUUID();
    const observations = signedCallback({
      schemaVersion: 1,
      event: "sales.discovery.observations.v1",
      runId: seeded.runId,
      sourceId: seeded.bindingId,
      attemptToken: seeded.attemptToken,
      attemptGeneration: 1,
      credentialGeneration: seeded.credentialGeneration,
      payload: {
        observations: [
          {
            observationId,
            sourceItemKey: `campaign-me-cancel-before-${observationId}`,
            contentHash: "e".repeat(64),
            sourceReference: {
              kind: "public_url",
              url: `https://campaignme.com/latest/cancel-before-${observationId}`,
            },
            observedAt: "2026-09-20T06:30:00.000+04:00",
            publishedAt: "2026-09-19T00:00:00.000Z",
            dateEvidence: { method: "feed", precision: "day" },
            kind: "news",
            title: "Acme Holdings opened an agency review",
            excerpt:
              "Acme Holdings opened an agency review for its regional communications account.",
            companyHints: [],
          },
        ],
      },
    });
    expect(
      await acceptDiscoveryRuntimeCallback({
        rawBody: observations.rawBody,
        headers: observations.headers,
      }),
    ).toEqual({ status: "accepted", eventId: observations.eventId });
    await db.execute(sql`
      update public.scheduled_job
      set status = 'cancel_requested'
      where scheduled_job_id = ${seeded.runId}::uuid
    `);
    expect(
      await runDiscoveryInterpretationJob({
        jobId: seeded.runId,
        sourceKey: "campaign_me",
        attemptToken: seeded.attemptToken,
        attemptGeneration: 1,
        provider: mockIdentityProvider("or-cancel-before"),
      }),
    ).toMatchObject({ status: "cancelled" });
    expect(await candidateCount(seeded.runId)).toBe(0);
    const row = await jobStatus(seeded.runId);
    expect(row).toMatchObject({ status: "cancelled" });
    const interpretation = (
      row?.result?.sourceOutcomes as
        | Record<string, { interpretation?: { status?: string; lastError?: string } }>
        | undefined
    )?.campaign_me?.interpretation;
    expect(interpretation).toMatchObject({
      status: "cancelled",
      lastError: "RUN_CANCEL_REQUESTED",
    });
  } finally {
    if (previousExecutionEnabled === undefined) {
      delete process.env.DISCOVERY_EXECUTION_ENABLED;
    } else {
      process.env.DISCOVERY_EXECUTION_ENABLED = previousExecutionEnabled;
    }
  }
});

it("persists cancellation during an in-flight mock call and does not ingest", async () => {
  const previousExecutionEnabled = process.env.DISCOVERY_EXECUTION_ENABLED;
  process.env.DISCOVERY_EXECUTION_ENABLED = "true";
  try {
    const seeded = await seedRunningDiscoveryCallback("callback-cancel-during");
    const observationId = randomUUID();
    const observations = signedCallback({
      schemaVersion: 1,
      event: "sales.discovery.observations.v1",
      runId: seeded.runId,
      sourceId: seeded.bindingId,
      attemptToken: seeded.attemptToken,
      attemptGeneration: 1,
      credentialGeneration: seeded.credentialGeneration,
      payload: {
        observations: [
          {
            observationId,
            sourceItemKey: `campaign-me-cancel-during-${observationId}`,
            contentHash: "f".repeat(64),
            sourceReference: {
              kind: "public_url",
              url: `https://campaignme.com/latest/cancel-during-${observationId}`,
            },
            observedAt: "2026-09-20T06:30:00.000+04:00",
            publishedAt: "2026-09-19T00:00:00.000Z",
            dateEvidence: { method: "feed", precision: "day" },
            kind: "news",
            title: "Acme Holdings opened an agency review",
            excerpt:
              "Acme Holdings opened an agency review for its regional communications account.",
            companyHints: [],
          },
        ],
      },
    });
    expect(
      await acceptDiscoveryRuntimeCallback({
        rawBody: observations.rawBody,
        headers: observations.headers,
      }),
    ).toEqual({ status: "accepted", eventId: observations.eventId });
    const provider = mockIdentityProvider("or-cancel-during", async () => {
      await db.execute(sql`
        update public.scheduled_job
        set status = 'cancel_requested'
        where scheduled_job_id = ${seeded.runId}::uuid
          and attempts = 1
          and attempt_token = ${seeded.attemptToken}::uuid
      `);
    });
    await runDiscoveryInterpretationJob({
      jobId: seeded.runId,
      sourceKey: "campaign_me",
      attemptToken: seeded.attemptToken,
      attemptGeneration: 1,
      provider,
    });
    expect(await candidateCount(seeded.runId)).toBe(0);
    const row = await jobStatus(seeded.runId);
    expect(row).toMatchObject({ status: "cancelled" });
    const interpretation = (
      row?.result?.sourceOutcomes as
        | Record<string, { interpretation?: { status?: string; lastError?: string } }>
        | undefined
    )?.campaign_me?.interpretation;
    expect(interpretation).toMatchObject({
      status: "cancelled",
      lastError: "RUN_CANCEL_REQUESTED",
    });
  } finally {
    if (previousExecutionEnabled === undefined) {
      delete process.env.DISCOVERY_EXECUTION_ENABLED;
    } else {
      process.env.DISCOVERY_EXECUTION_ENABLED = previousExecutionEnabled;
    }
  }
});

it("lists and finalizes cancellation after a terminal cost-receipt failure", async () => {
  const previousExecutionEnabled = process.env.DISCOVERY_EXECUTION_ENABLED;
  process.env.DISCOVERY_EXECUTION_ENABLED = "true";
  try {
    const seeded = await seedRunningDiscoveryCallback("callback-cancel-terminal-cost");
    const observationId = randomUUID();
    const observations = signedCallback({
      schemaVersion: 1,
      event: "sales.discovery.observations.v1",
      runId: seeded.runId,
      sourceId: seeded.bindingId,
      attemptToken: seeded.attemptToken,
      attemptGeneration: 1,
      credentialGeneration: seeded.credentialGeneration,
      payload: {
        observations: [
          {
            observationId,
            sourceItemKey: `campaign-me-terminal-cost-${observationId}`,
            contentHash: "a".repeat(64),
            sourceReference: {
              kind: "public_url",
              url: `https://campaignme.com/latest/terminal-cost-${observationId}`,
            },
            observedAt: "2026-09-20T06:30:00.000+04:00",
            publishedAt: "2026-09-19T00:00:00.000Z",
            dateEvidence: { method: "feed", precision: "day" },
            kind: "news",
            title: "Acme Holdings opened an agency review",
            excerpt:
              "Acme Holdings opened an agency review for its regional communications account.",
            companyHints: [],
          },
        ],
      },
    });
    expect(
      await acceptDiscoveryRuntimeCallback({
        rawBody: observations.rawBody,
        headers: observations.headers,
      }),
    ).toEqual({ status: "accepted", eventId: observations.eventId });
    const before = await jobStatus(seeded.runId);
    const result = structuredClone(before?.result ?? {}) as Record<string, any>;
    const queue = result.sourceOutcomes.campaign_me.interpretation;
    queue.status = "unavailable";
    queue.lastError = "DISCOVERY_COST_RECEIPT_UNAVAILABLE";
    queue.done = [...(queue.done ?? []), ...(queue.pending ?? []), ...(queue.inFlight ?? [])];
    queue.pending = [];
    queue.inFlight = [];
    result.interpretationBudget = {
      ...(result.interpretationBudget ?? {}),
      costReceiptAvailable: false,
    };
    await db.execute(sql`
      update public.scheduled_job
      set status = 'cancel_requested', result = ${JSON.stringify(result)}::jsonb
      where scheduled_job_id = ${seeded.runId}::uuid
    `);

    const listed = await listPendingDiscoveryInterpretationJobs({ limit: 25 });
    const continuation = listed.find((item) => item.jobId === seeded.runId);
    expect(continuation).toMatchObject({
      sourceKey: "campaign_me",
      attemptToken: seeded.attemptToken,
      attemptGeneration: 1,
    });
    expect(
      await runDiscoveryInterpretationJob({
        ...continuation!,
      }),
    ).toMatchObject({ status: "cancelled" });
    expect(await jobStatus(seeded.runId)).toMatchObject({
      status: "cancelled",
      lastError: "RUN_CANCEL_REQUESTED",
    });
    expect(await candidateCount(seeded.runId)).toBe(0);

    const multi = await seedRunningDiscoveryCallback("callback-cancel-multi-source");
    const multiObservationId = randomUUID();
    const multiCallback = signedCallback({
      schemaVersion: 1,
      event: "sales.discovery.observations.v1",
      runId: multi.runId,
      sourceId: multi.bindingId,
      attemptToken: multi.attemptToken,
      attemptGeneration: 1,
      credentialGeneration: multi.credentialGeneration,
      payload: {
        observations: [{
          observationId: multiObservationId,
          sourceItemKey: `campaign-me-multi-${multiObservationId}`,
          contentHash: "b".repeat(64),
          sourceReference: { kind: "public_url", url: `https://campaignme.com/latest/multi-${multiObservationId}` },
          observedAt: "2026-09-20T06:30:00.000+04:00",
          publishedAt: "2026-09-19T00:00:00.000Z",
          dateEvidence: { method: "feed", precision: "day" },
          kind: "news",
          title: "Acme Holdings opened an agency review",
          excerpt: "Acme Holdings opened an agency review for its regional communications account.",
          companyHints: [],
        }],
      },
    });
    await acceptDiscoveryRuntimeCallback({
      rawBody: multiCallback.rawBody,
      headers: multiCallback.headers,
    });
    const multiBefore = await jobStatus(multi.runId);
    const multiResult = structuredClone(multiBefore?.result ?? {}) as Record<string, any>;
    multiResult.sourceOutcomes = {
      a_terminal: {
        interpretation: {
          status: "cancelled",
          pending: [],
          inFlight: [],
          done: [],
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          lastError: "RUN_CANCEL_REQUESTED",
        },
      },
      ...multiResult.sourceOutcomes,
    };
    await db.execute(sql`
      update public.scheduled_job
      set status = 'cancel_requested', result = ${JSON.stringify(multiResult)}::jsonb
      where scheduled_job_id = ${multi.runId}::uuid
    `);
    const multiListed = (await listPendingDiscoveryInterpretationJobs({ limit: 25 }))
      .find((item) => item.jobId === multi.runId);
    expect(multiListed?.sourceKey).toBe("campaign_me");
    expect(
      await runDiscoveryInterpretationJob({ ...multiListed! }),
    ).toMatchObject({ status: "cancelled" });
    expect(await jobStatus(multi.runId)).toMatchObject({
      status: "cancelled",
      lastError: "RUN_CANCEL_REQUESTED",
    });
    expect(await candidateCount(multi.runId)).toBe(0);
  } finally {
    if (previousExecutionEnabled === undefined) {
      delete process.env.DISCOVERY_EXECUTION_ENABLED;
    } else {
      process.env.DISCOVERY_EXECUTION_ENABLED = previousExecutionEnabled;
    }
  }
});

it("does not recover or rewrite completed or failed interpretation jobs", async () => {
  const previousExecutionEnabled = process.env.DISCOVERY_EXECUTION_ENABLED;
  process.env.DISCOVERY_EXECUTION_ENABLED = "true";
  try {
    for (const status of ["completed", "failed"] as const) {
      const seeded = await seedRunningDiscoveryCallback(`callback-terminal-${status}`);
      await db.execute(sql`
        update public.scheduled_job
        set status = ${status},
            completed_at = statement_timestamp(),
            result = coalesce(result, '{}'::jsonb) || ${JSON.stringify({
              budgetReservations: {
                interpretation: {
                  schemaVersion: 1,
                  reservedCalls: 1,
                  reservedTokens: 2400,
                  settledCalls: 1,
                  settledTokens: 0,
                  observationIds: [],
                  costReceiptAvailable: false,
                },
              },
            })}::jsonb
        where scheduled_job_id = ${seeded.runId}::uuid
      `);
      expect(
        await runDiscoveryInterpretationJob({
          jobId: seeded.runId,
          sourceKey: "campaign_me",
          attemptToken: seeded.attemptToken,
          attemptGeneration: 1,
        }),
      ).toEqual({ status: "blocked", remaining: 0 });
      const after = await jobStatus(seeded.runId);
      expect(after).toMatchObject({ status });
    }
  } finally {
    if (previousExecutionEnabled === undefined) {
      delete process.env.DISCOVERY_EXECUTION_ENABLED;
    } else {
      process.env.DISCOVERY_EXECUTION_ENABLED = previousExecutionEnabled;
    }
  }
});
