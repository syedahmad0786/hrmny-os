import { randomUUID } from "node:crypto";
import { createDb, sql } from "@hrmny/db";
import { expect, it } from "vitest";
import {
  createDiscoveryProgramme,
  DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
  defaultDiscoverySources,
  pauseDiscoveryProgramme,
  publishDiscoveryProgramme,
} from "./discovery-programmes";
import {
  cancelDiscoveryRun,
  getDiscoveryRun,
  listDiscoveryRuns,
} from "./discovery-run-queries";
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
const outsiderId = randomUUID();
const accountId = randomUUID();

it("proves one pending Discovery slot, exact request replay, and pause cancellation", async () => {
  await db.execute(sql`
    insert into public.employee (employee_id, display_name, email)
    values
      (${ownerId}::uuid, 'Discovery run owner', ${`discovery-run-owner-${ownerId}@example.invalid`}),
      (${adminId}::uuid, 'Discovery run admin', ${`discovery-run-admin-${adminId}@example.invalid`}),
      (${outsiderId}::uuid, 'Discovery run outsider', ${`discovery-run-outsider-${outsiderId}@example.invalid`})
  `);
  await db.execute(sql`
    insert into public.connection_account (
      connection_account_id, owner_employee_id, toolkit, scope, status
    ) values (
      ${accountId}::uuid, ${ownerId}::uuid, 'apollo', 'staff', 'connected'
    )
  `);

  const created = await createDiscoveryProgramme({
    config: {
      ...DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
      name: `Run coordinator proof ${randomUUID()}`,
      ownerEmployeeId: ownerId,
      reviewerEmployeeIds: [],
    },
    sources: defaultDiscoverySources().map((source) =>
      source.sourceKey === "apollo_organisation_search"
        ? { ...source, accountReferenceId: accountId }
        : source,
    ),
    actorEmployeeId: ownerId,
  });
  const published = await publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: created.version,
    actorEmployeeId: adminId,
  });
  expect(published.nextDueAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  const pendingBefore = await db.execute<{
    scheduled_job_id: string;
    status: string;
    job_key: string;
  }>(sql`
    select scheduled_job_id, status, job_key
    from public.scheduled_job
    where research_programme_id = ${created.id}::uuid
      and kind = 'sales_research_run'
    order by created_at
  `);
  expect(pendingBefore).toHaveLength(1);
  expect(pendingBefore[0]).toMatchObject({ status: "pending" });
  const listed = await listDiscoveryRuns({
    actorEmployeeId: ownerId,
    isAdmin: false,
    programmeId: created.id,
  });
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({
    runId: pendingBefore[0]!.scheduled_job_id,
    status: "pending",
    executionEnabled: false,
    collectorStarted: false,
  });
  const detail = await getDiscoveryRun({
    runId: pendingBefore[0]!.scheduled_job_id,
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  expect(detail).toMatchObject({
    n8nClaimed: false,
    executionEnabled: false,
    collectorStarted: false,
  });
  await expect(
    getDiscoveryRun({
      runId: pendingBefore[0]!.scheduled_job_id,
      actorEmployeeId: outsiderId,
      isAdmin: false,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    cancelDiscoveryRun({
      runId: pendingBefore[0]!.scheduled_job_id,
      expectedStateVersion: detail.stateVersion,
      reason: "Outsider cancel attempt",
      actorEmployeeId: outsiderId,
      isAdmin: false,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });

  const republished = await publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: published.version,
    actorEmployeeId: adminId,
  });
  const afterRepublish = await db.execute<{
    status: string;
    count: number;
  }>(sql`
    select status, count(*)::int as count
    from public.scheduled_job
    where research_programme_id = ${created.id}::uuid
      and kind = 'sales_research_run'
    group by status
    order by status
  `);
  expect(afterRepublish).toEqual(
    expect.arrayContaining([
      { status: "cancelled", count: 1 },
      { status: "pending", count: 1 },
    ]),
  );

  const requestId = randomUUID();
  const first = await requestDiscoveryRun({
    programmeId: created.id,
    expectedVersion: republished.version,
    requestId,
    overlap: "defer_scheduled",
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  const replay = await requestDiscoveryRun({
    programmeId: created.id,
    expectedVersion: republished.version,
    requestId,
    overlap: "defer_scheduled",
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  expect(replay).toEqual(first);
  expect(first.status).toBe("deferred");

  await expect(
    requestDiscoveryRun({
      programmeId: created.id,
      expectedVersion: republished.version,
      requestId: randomUUID(),
      overlap: "defer",
      actorEmployeeId: outsiderId,
      isAdmin: false,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });

  const afterManual = await db.execute<{
    status: string;
    count: number;
  }>(sql`
    select status, count(*)::int as count
    from public.scheduled_job
    where research_programme_id = ${created.id}::uuid
      and kind = 'sales_research_run'
    group by status
    order by status
  `);
  expect(
    afterManual.find((row) => row.status === "pending")?.count,
  ).toBe(1);
  expect(
    afterManual.find((row) => row.status === "deferred")?.count,
  ).toBe(1);

  const manual = await getDiscoveryRun({
    runId: first.runId,
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  const cancelled = await cancelDiscoveryRun({
    runId: first.runId,
    expectedStateVersion: manual.stateVersion,
    reason: "Operator cancelled the armed Discovery slot",
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  expect(cancelled).toMatchObject({
    runId: first.runId,
    status: "cancelled",
    executionEnabled: false,
    collectorStarted: false,
  });

  const paused = await pauseDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: republished.version,
    actorEmployeeId: adminId,
    reason: "Stop coordinator proof work",
  });
  expect(paused.nextDueAt).toBeNull();
  const afterPause = await db.execute<{
    status: string;
    count: number;
  }>(sql`
    select status, count(*)::int as count
    from public.scheduled_job
    where research_programme_id = ${created.id}::uuid
      and kind = 'sales_research_run'
      and status in ('pending', 'deferred', 'running')
    group by status
  `);
  expect(afterPause).toEqual([]);
});
