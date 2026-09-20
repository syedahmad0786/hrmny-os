import { randomUUID } from "node:crypto";
import { createDb, sql } from "@hrmny/db";
import { expect, it } from "vitest";
import {
  acceptDiscoveryPolicySuggestion,
  proposeDiscoveryPolicySuggestion,
  reconnectDiscoveryControlSource,
  retryDiscoverySource,
} from "./discovery-control";
import {
  createDiscoveryProgramme,
  DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
  defaultDiscoverySources,
  getDiscoveryProgramme,
  publishDiscoveryProgramme,
} from "./discovery-programmes";
import { requestDiscoveryRun } from "./discovery-runs";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw new Error("LOCAL_POSTGRES_PROOF_REQUIRED");

const db = createDb(databaseUrl);
const ownerId = randomUUID();
const adminId = randomUUID();

it("retries one failed source from checkpoint and leaves the completed sibling intact", async () => {
  await db.execute(sql`
    insert into public.employee (employee_id, display_name, email)
    values
      (${ownerId}::uuid, 'Discovery control owner', ${`discovery-control-owner-${ownerId}@example.invalid`}),
      (${adminId}::uuid, 'Discovery control admin', ${`discovery-control-admin-${adminId}@example.invalid`})
  `);

  const created = await createDiscoveryProgramme({
    actorEmployeeId: ownerId,
    config: {
      ...DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
      name: `Control proof ${randomUUID()}`,
      ownerEmployeeId: ownerId,
      reviewerEmployeeIds: [],
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
  const completedCheckpoint = {
    cursor: "page-2",
    providerJobId: "job-ok",
    itemsSeen: 12,
    pagesSeen: 2,
  };
  const failedCheckpoint = {
    cursor: "page-4",
    providerJobId: "job-fail",
    itemsSeen: 40,
    pagesSeen: 4,
  };
  await db.execute(sql`
    update public.scheduled_job
    set result = coalesce(result, '{}'::jsonb) || ${JSON.stringify({
      sourceOutcomes: {
        campaign_me: {
          sourceKey: "campaign_me",
          status: "completed",
          lastEvent: "sales.discovery.completion.v1",
          checkpoint: completedCheckpoint,
          retryable: false,
          retryCount: 0,
          lastError: null,
        },
        communicate_online: {
          sourceKey: "communicate_online",
          status: "failed",
          lastEvent: "sales.discovery.completion.v1",
          checkpoint: failedCheckpoint,
          retryable: true,
          retryCount: 0,
          lastError: "source_unavailable",
        },
      },
    })}::jsonb
    where scheduled_job_id = ${requested.runId}::uuid
  `);

  const retried = await retryDiscoverySource({
    runId: requested.runId,
    sourceKey: "communicate_online",
    actorEmployeeId: ownerId,
    isAdmin: false,
    requestId: randomUUID(),
  });
  expect(retried.executionEnabled).toBe(false);
  expect(retried.collectorStarted).toBe(false);
  expect(retried.paidCallAuthorized).toBe(false);
  expect(retried.checkpoint).toEqual(failedCheckpoint);
  expect(retried.sourceOutcomes.campaign_me).toMatchObject({
    status: "completed",
    checkpoint: completedCheckpoint,
  });
  expect(retried.reservation.state).toBe("pending_unknown");
  await expect(
    retryDiscoverySource({
      runId: requested.runId,
      sourceKey: "communicate_online",
      actorEmployeeId: ownerId,
      isAdmin: false,
      requestId: randomUUID(),
    }),
  ).rejects.toMatchObject({ message: "SOURCE_RETRY_ALREADY_QUEUED" });

  const reconnected = await reconnectDiscoveryControlSource({
    programmeId: published.id,
    sourceKey: "apollo_organisation_search",
    actorEmployeeId: ownerId,
    isAdmin: false,
    reason: "Refresh the owned Apollo connection after an error",
  });
  expect(reconnected.collectorStarted).toBe(false);
  expect(reconnected.credentialGeneration).toBeGreaterThan(0);
}, 20_000);

it("applies an accepted observation-cap suggestion to a later published run only", async () => {
  const policyOwnerId = randomUUID();
  const policyAdminId = randomUUID();
  await db.execute(sql`
    insert into public.employee (employee_id, display_name, email)
    values
      (${policyOwnerId}::uuid, 'Discovery policy owner', ${`discovery-policy-owner-${policyOwnerId}@example.invalid`}),
      (${policyAdminId}::uuid, 'Discovery policy admin', ${`discovery-policy-admin-${policyAdminId}@example.invalid`})
  `);

  const created = await createDiscoveryProgramme({
    actorEmployeeId: policyOwnerId,
    config: {
      ...DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
      name: `Policy proof ${randomUUID()}`,
      ownerEmployeeId: policyOwnerId,
      reviewerEmployeeIds: [],
    },
    sources: defaultDiscoverySources(),
  });
  const published = await publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: created.version,
    actorEmployeeId: policyAdminId,
  });
  const first = await requestDiscoveryRun({
    programmeId: published.id,
    expectedVersion: published.version,
    requestId: randomUUID(),
    overlap: "defer",
    actorEmployeeId: policyOwnerId,
    isAdmin: false,
  });
  const suggestion = await proposeDiscoveryPolicySuggestion({
    programmeId: published.id,
    maxObservations: 40,
    reason: "Lower the observation cap after a costly week",
    actorEmployeeId: policyOwnerId,
    isAdmin: false,
  });
  const accepted = await acceptDiscoveryPolicySuggestion({
    suggestionId: suggestion.suggestionId,
    actorEmployeeId: policyAdminId,
    isAdmin: true,
  });
  expect(accepted.maxObservations).toBe(40);
  const refreshed = await getDiscoveryProgramme({
    programmeId: published.id,
    actorEmployeeId: policyOwnerId,
    isAdmin: false,
  });
  expect(refreshed.published?.config.limits.maxObservations).toBe(40);
  const later = await requestDiscoveryRun({
    programmeId: refreshed.id,
    expectedVersion: refreshed.version,
    requestId: randomUUID(),
    overlap: "defer",
    actorEmployeeId: policyOwnerId,
    isAdmin: false,
  });
  const versions = await db.execute<{
    scheduled_job_id: string;
    max_observations: number;
  }>(sql`
    select
      job.scheduled_job_id,
      (version.configuration->'config'->'limits'->>'maxObservations')::int as max_observations
    from public.scheduled_job job
    join public.research_programme_version version
      on version.research_programme_version_id = job.research_programme_version_id
    where job.scheduled_job_id in (${first.runId}::uuid, ${later.runId}::uuid)
  `);
  expect(
    versions.find((row) => row.scheduled_job_id === first.runId)
      ?.max_observations,
  ).toBe(200);
  expect(
    versions.find((row) => row.scheduled_job_id === later.runId)
      ?.max_observations,
  ).toBe(40);
}, 20_000);
