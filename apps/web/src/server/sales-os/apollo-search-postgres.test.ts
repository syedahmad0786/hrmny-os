import { createDb, sql } from "@hrmny/db";
import {
  ApolloProviderRequestError,
  type LeadCandidate,
  type LeadSearchExecution,
  type LeadSourceAdapter,
} from "@hrmny/integrations";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "../db";
import {
  completeIntegrationReceiptIfProcessing,
  hashIntegrationPayload,
} from "../integrations/inbox";
import {
  APOLLO_PEOPLE_SEARCH_OPERATION,
  getApolloPeopleSearchStatus,
  redactExpiredApolloPeopleSearchCandidates,
  revokeApolloPeopleSearch,
  runApolloPeopleSearchQueuedJob,
  searchApolloPeopleFree,
} from "./apollo-search";

const ACTOR = "20000000-0000-4000-8000-000000000001";
const OTHER_ACTOR = "20000000-0000-4000-8000-000000000002";
const ACTOR_CONNECTION = "42000000-0000-4000-8000-000000000001";
const OTHER_CONNECTION = "42000000-0000-4000-8000-000000000002";

let actorSecretId = "";
let otherSecretId = "";

function execution(id = "apollo-postgres-person"): LeadSearchExecution {
  const candidate: LeadCandidate = {
    externalId: id,
    fullName: "Postgres Proof",
    title: "Marketing Director",
    email: "must-not-persist@example.com",
    companyName: "Synthetic UAE",
    companyDomain: "synthetic.example",
    source: "apollo",
    raw: { forbidden: "provider body" },
  };
  return {
    candidates: [candidate],
    providerReceipt: {
      provider: "apollo",
      operation: "people.search",
      httpStatus: 200,
      responseHash: "c".repeat(64),
      receivedAt: new Date().toISOString(),
      rateLimit: { minuteRemaining: 49 },
    },
  };
}

function sourceWith(
  run: () => Promise<LeadSearchExecution>,
): LeadSourceAdapter {
  return {
    mode: "live",
    searchLeads: vi.fn(async () => (await run()).candidates),
    searchLeadsWithReceipt: vi.fn(run),
    enrichLead: vi.fn(async () => null),
  };
}

async function ensureFixtures() {
  const db = getDb();
  if (!db) throw new Error("PostgreSQL proof database unavailable");
  await db.execute(sql`
    insert into public.employee (employee_id, display_name, email, is_active)
    values
      (${ACTOR}::uuid, 'Apollo Proof Actor', 'apollo-proof-actor@example.test', true),
      (${OTHER_ACTOR}::uuid, 'Apollo Proof Other', 'apollo-proof-other@example.test', true)
    on conflict (employee_id) do update
      set is_active = true, updated_at = now()
  `);
  await db.execute(sql`
    insert into public.role (key, display_name)
    values ('partner', 'Partner')
    on conflict (key) do nothing
  `);
  await db.execute(sql`
    insert into public.employee_role (employee_id, role_id)
    select fixture.employee_id, role.role_id
    from (
      values (${ACTOR}::uuid), (${OTHER_ACTOR}::uuid)
    ) as fixture(employee_id)
    cross join public.role role
    where role.key = 'partner'
    on conflict do nothing
  `);
  if (!actorSecretId) {
    const [secret] = await db.execute<{ id: string }>(sql`
      select vault.create_secret(
        'synthetic-apollo-proof-key-a',
        'ci:apollo-proof:a',
        'Disposable CI-only owner-isolation proof'
      ) as id
    `);
    actorSecretId = secret?.id ?? "";
  }
  if (!otherSecretId) {
    const [secret] = await db.execute<{ id: string }>(sql`
      select vault.create_secret(
        'synthetic-apollo-proof-key-b',
        'ci:apollo-proof:b',
        'Disposable CI-only owner-isolation proof'
      ) as id
    `);
    otherSecretId = secret?.id ?? "";
  }
  if (!actorSecretId || !otherSecretId) {
    throw new Error("CI Vault fixture was not created");
  }
  await db.execute(sql`
    insert into public.connection_account (
      connection_account_id, owner_employee_id, toolkit, scope, auth_type,
      label, secret_id, status
    ) values
      (
        ${ACTOR_CONNECTION}::uuid, ${ACTOR}::uuid, 'apollo', 'staff',
        'api_key', 'CI actor Apollo', ${actorSecretId}::uuid, 'connected'
      ),
      (
        ${OTHER_CONNECTION}::uuid, ${OTHER_ACTOR}::uuid, 'apollo', 'staff',
        'api_key', 'CI other Apollo', ${otherSecretId}::uuid, 'connected'
      )
    on conflict (owner_employee_id, toolkit, scope)
      where owner_employee_id is not null
    do update set
      secret_id = excluded.secret_id,
      status = 'connected',
      expires_at = null,
      updated_at = now()
  `);
}

async function restoreAuthorizationFixtures() {
  const db = getDb();
  if (!db) return;
  if (actorSecretId && otherSecretId) {
    await db.execute(sql`
      select vault.update_secret(
        ${actorSecretId}::uuid,
        'synthetic-apollo-proof-key-a'
      ), vault.update_secret(
        ${otherSecretId}::uuid,
        'synthetic-apollo-proof-key-b'
      )
    `);
  }
  await db.execute(sql`
    update public.employee
    set is_active = true, updated_at = now()
    where employee_id in (${ACTOR}::uuid, ${OTHER_ACTOR}::uuid)
  `);
  await db.execute(sql`
    insert into public.employee_role (employee_id, role_id)
    select fixture.employee_id, role.role_id
    from (
      values (${ACTOR}::uuid), (${OTHER_ACTOR}::uuid)
    ) as fixture(employee_id)
    cross join public.role role
    where role.key = 'partner'
    on conflict do nothing
  `);
  await db.execute(sql`
    update public.connection_account
    set status = 'connected',
        last_error = null,
        secret_id = case
          when connection_account_id = ${ACTOR_CONNECTION}::uuid
            then ${actorSecretId}::uuid
          else ${otherSecretId}::uuid
        end,
        expires_at = null, updated_at = now()
    where connection_account_id in (
      ${ACTOR_CONNECTION}::uuid,
      ${OTHER_CONNECTION}::uuid
    )
  `);
}

async function cleanup() {
  const db = getDb();
  if (!db) return;
  await db.execute(sql`
    delete from public.scheduled_job
    where payload ->> 'idempotencyKey' like '41000000-%'
  `);
  await db.execute(sql`
    delete from public.integration_inbox
    where provider = 'apollo'
      and external_event_id like '41000000-%'
  `);
}

beforeAll(ensureFixtures);
beforeEach(restoreAuthorizationFixtures);
afterEach(async () => {
  await cleanup();
  await restoreAuthorizationFixtures();
});

describe("Apollo queue PostgreSQL proof", () => {
  it("rolls back both receipt and job when enqueue crashes inside the transaction", async () => {
    const idempotencyKey = "41000000-0000-4000-8000-000000000010";
    await expect(
      searchApolloPeopleFree(
        {
          idempotencyKey,
          actorEmployeeId: ACTOR,
          query: "transaction rollback",
        },
        {
          leadSource: sourceWith(async () => execution()),
          afterAtomicReceiptInsert: async () => {
            throw new Error("SYNTHETIC_ENQUEUE_CRASH");
          },
        },
      ),
    ).rejects.toThrow(/SYNTHETIC_ENQUEUE_CRASH/);

    const db = getDb()!;
    const [stored] = await db.execute<{ receipts: number; jobs: number }>(sql`
      select
        (select count(*)::int from public.integration_inbox
          where provider = 'apollo'
            and external_event_id = ${idempotencyKey}) as receipts,
        (select count(*)::int from public.scheduled_job
          where payload ->> 'idempotencyKey' = ${idempotencyKey}) as jobs
    `);
    expect(stored).toEqual({ receipts: 0, jobs: 0 });
  });

  it("adopts only an exact zero-attempt legacy receipt into the owner's current connection", async () => {
    const idempotencyKey = "41000000-0000-4000-8000-000000000014";
    const payload = {
      actorEmployeeId: ACTOR,
      criteria: {
        query: "legacy orphan",
        locations: ["United Arab Emirates"],
        page: 1,
        perPage: 8,
      },
      creditUsage: 0,
      personalEmail: false,
      phone: false,
      waterfalls: false,
    };
    const rawBody = JSON.stringify(payload);
    const db = getDb()!;
    const [legacy] = await db.execute<{ integration_inbox_id: string }>(sql`
      insert into public.integration_inbox (
        provider, external_event_id, operation, payload_hash, payload,
        status, attempts, result
      ) values (
        'apollo', ${idempotencyKey}, ${APOLLO_PEOPLE_SEARCH_OPERATION},
        ${hashIntegrationPayload(rawBody)}, ${rawBody}::jsonb,
        'received', 0, '{"bridgeStatus":"processing","mode":"live"}'::jsonb
      )
      returning integration_inbox_id
    `);

    const source = sourceWith(async () => execution("apollo-adopted-person"));
    await expect(
      searchApolloPeopleFree(
        {
          idempotencyKey,
          actorEmployeeId: OTHER_ACTOR,
          query: "legacy orphan",
        },
        { leadSource: source },
      ),
    ).rejects.toThrow(/PAYLOAD_MISMATCH/);
    const [untouched] = await db.execute<{
      owner_employee_id: string | null;
      jobs: number;
    }>(sql`
      select inbox.owner_employee_id::text,
             count(job.scheduled_job_id)::int as jobs
      from public.integration_inbox inbox
      left join public.scheduled_job job
        on job.integration_inbox_id = inbox.integration_inbox_id
      where inbox.integration_inbox_id = ${legacy!.integration_inbox_id}::uuid
      group by inbox.integration_inbox_id
    `);
    expect(untouched).toEqual({ owner_employee_id: null, jobs: 0 });

    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey,
        actorEmployeeId: ACTOR,
        query: "legacy orphan",
      },
      { leadSource: source },
    );
    expect(pending.receiptId).toBe(legacy!.integration_inbox_id);

    const [adopted] = await db.execute<{
      owner_employee_id: string;
      credential_connection_account_id: string;
      jobs: number;
    }>(sql`
      select inbox.owner_employee_id::text,
             inbox.credential_connection_account_id::text,
             count(job.scheduled_job_id)::int as jobs
      from public.integration_inbox inbox
      left join public.scheduled_job job
        on job.integration_inbox_id = inbox.integration_inbox_id
      where inbox.integration_inbox_id = ${pending.receiptId}::uuid
      group by inbox.integration_inbox_id
    `);
    expect(adopted).toEqual({
      owner_employee_id: ACTOR,
      credential_connection_account_id: ACTOR_CONNECTION,
      jobs: 1,
    });

    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
        authorizeActor: async () => true,
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests and lets only one worker call the provider", async () => {
    const sourceStarted = vi.fn();
    let release!: () => void;
    const source = sourceWith(
      () =>
        new Promise<LeadSearchExecution>((resolve) => {
          sourceStarted();
          release = () => resolve(execution());
        }),
    );
    const input = {
      idempotencyKey: "41000000-0000-4000-8000-000000000001",
      actorEmployeeId: ACTOR,
      titles: ["Marketing Director"],
    };
    const databaseUrl = process.env.DATABASE_URL!;
    const databaseA = createDb(databaseUrl);
    const databaseB = createDb(databaseUrl);
    const [first, duplicate] = await Promise.all([
      searchApolloPeopleFree(input, {
        leadSource: source,
        database: databaseA,
      }),
      searchApolloPeopleFree(input, {
        leadSource: source,
        database: databaseB,
      }),
    ]);
    expect(duplicate.receiptId).toBe(first.receiptId);

    const db = getDb()!;
    const [ledger] = await db.execute<{ receipts: number; jobs: number }>(sql`
      select
        (select count(*)::int from public.integration_inbox
          where provider = 'apollo'
            and external_event_id = ${input.idempotencyKey}) as receipts,
        (select count(*)::int from public.scheduled_job
          where payload ->> 'idempotencyKey' = ${input.idempotencyKey}) as jobs
    `);
    expect(ledger).toEqual({ receipts: 1, jobs: 1 });

    const [linked] = await db.execute<{
      receipt_owner: string;
      credential_connection_account_id: string;
      linked_receipt_id: string;
      receipt_id: string;
    }>(sql`
      select inbox.owner_employee_id::text as receipt_owner,
             inbox.credential_connection_account_id::text,
             job.integration_inbox_id::text as linked_receipt_id,
             inbox.integration_inbox_id::text as receipt_id
      from public.integration_inbox inbox
      join public.scheduled_job job
        on job.integration_inbox_id = inbox.integration_inbox_id
      where inbox.provider = 'apollo'
        and inbox.external_event_id = ${input.idempotencyKey}
    `);
    expect(linked).toEqual({
      receipt_owner: ACTOR,
      credential_connection_account_id: ACTOR_CONNECTION,
      linked_receipt_id: linked!.receipt_id,
      receipt_id: linked!.receipt_id,
    });

    const [job] = await db.execute<{
      scheduled_job_id: string;
      payload: Record<string, unknown>;
    }>(sql`
      select scheduled_job_id, payload
      from public.scheduled_job
      where payload ->> 'idempotencyKey' = ${input.idempotencyKey}
    `);
    expect(Object.keys(job!.payload).sort()).toEqual([
      "idempotencyKey",
      "receiptId",
    ]);

    const run = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: source,
      authorizeActor: async () => true,
    });
    await vi.waitFor(() => expect(sourceStarted).toHaveBeenCalledTimes(1));
    const competing = await runApolloPeopleSearchQueuedJob(
      job!.scheduled_job_id,
      {
        leadSource: source,
        authorizeActor: async () => true,
      },
    );
    expect(competing.status).toBe("busy");
    release();
    await expect(run).resolves.toMatchObject({ status: "completed" });
    expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(1);

    const [storedJob] = await db.execute<{
      result: Record<string, unknown>;
    }>(sql`
      select result from public.scheduled_job
      where scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);
    expect(Object.keys(storedJob!.result).sort()).toEqual([
      "attempts",
      "reason",
      "receiptId",
      "status",
    ]);
    expect(JSON.stringify(storedJob!.result)).not.toContain("candidates");

    const [persisted] = await db.execute<{
      receipt_result: Record<string, unknown>;
      job_result: Record<string, unknown>;
    }>(sql`
      select inbox.result as receipt_result, job.result as job_result
      from public.integration_inbox inbox
      join public.scheduled_job job
        on job.integration_inbox_id = inbox.integration_inbox_id
      where inbox.integration_inbox_id = ${first.receiptId}::uuid
    `);
    expect(persisted!.receipt_result).toMatchObject({
      candidates: [
        {
          externalId: "apollo-postgres-person",
          fullName: "Postgres Proof",
          title: "Marketing Director",
          companyName: "Synthetic UAE",
          companyDomain: "synthetic.example",
          source: "apollo",
        },
      ],
    });
    const persistedText = JSON.stringify(persisted);
    expect(persistedText).not.toContain("must-not-persist@example.com");
    expect(persistedText).not.toContain("provider body");
    expect(persistedText).not.toContain('"raw"');
  });

  it("serializes different Apollo jobs across independent database clients", async () => {
    const now = new Date("2026-09-01T10:00:00.000Z");
    const firstStarted = vi.fn();
    let releaseFirst!: () => void;
    const firstSource = sourceWith(
      () =>
        new Promise<LeadSearchExecution>((resolve) => {
          firstStarted();
          releaseFirst = () => resolve(execution("apollo-serialized-first"));
        }),
    );
    const secondSource = sourceWith(async () =>
      execution("apollo-serialized-second"),
    );
    const [firstPending, secondPending] = await Promise.all([
      searchApolloPeopleFree(
        {
          idempotencyKey: "41000000-0000-4000-8000-000000000022",
          actorEmployeeId: ACTOR,
          query: "provider slot first",
        },
        { leadSource: firstSource, now: () => now },
      ),
      searchApolloPeopleFree(
        {
          idempotencyKey: "41000000-0000-4000-8000-000000000023",
          actorEmployeeId: OTHER_ACTOR,
          query: "provider slot second",
        },
        { leadSource: secondSource, now: () => now },
      ),
    ]);
    const db = getDb()!;
    const jobs = await db.execute<{
      external_event_id: string;
      scheduled_job_id: string;
    }>(sql`
      select inbox.external_event_id, job.scheduled_job_id::text
      from public.integration_inbox inbox
      join public.scheduled_job job
        on job.integration_inbox_id = inbox.integration_inbox_id
      where inbox.integration_inbox_id in (
        ${firstPending.receiptId}::uuid,
        ${secondPending.receiptId}::uuid
      )
      order by inbox.external_event_id
    `);
    const firstJob = jobs[0]!;
    const secondJob = jobs[1]!;
    const firstDatabase = createDb(process.env.DATABASE_URL!);
    const secondDatabase = createDb(process.env.DATABASE_URL!);

    const firstRun = runApolloPeopleSearchQueuedJob(firstJob.scheduled_job_id, {
      leadSource: firstSource,
      authorizeActor: async () => true,
      database: firstDatabase,
      now: () => now,
    });
    await vi.waitFor(() => expect(firstStarted).toHaveBeenCalledOnce());

    await expect(
      runApolloPeopleSearchQueuedJob(secondJob.scheduled_job_id, {
        leadSource: secondSource,
        authorizeActor: async () => true,
        database: secondDatabase,
        now: () => now,
      }),
    ).resolves.toEqual({
      status: "busy",
      nextAttemptAt: "2026-09-01T10:10:00.000Z",
    });
    expect(secondSource.searchLeadsWithReceipt).not.toHaveBeenCalled();

    const stateWhileBusy = await db.execute<{
      external_event_id: string;
      status: string;
      attempts: number;
      concurrency_key: string | null;
    }>(sql`
      select inbox.external_event_id, job.status, job.attempts,
             job.concurrency_key
      from public.integration_inbox inbox
      join public.scheduled_job job
        on job.integration_inbox_id = inbox.integration_inbox_id
      where inbox.integration_inbox_id in (
        ${firstPending.receiptId}::uuid,
        ${secondPending.receiptId}::uuid
      )
      order by inbox.external_event_id
    `);
    expect(stateWhileBusy).toEqual([
      {
        external_event_id: firstJob.external_event_id,
        status: "running",
        attempts: 1,
        concurrency_key: "provider:apollo",
      },
      {
        external_event_id: secondJob.external_event_id,
        status: "pending",
        attempts: 0,
        concurrency_key: "provider:apollo",
      },
    ]);

    releaseFirst();
    await expect(firstRun).resolves.toMatchObject({ status: "completed" });
    await expect(
      runApolloPeopleSearchQueuedJob(secondJob.scheduled_job_id, {
        leadSource: secondSource,
        authorizeActor: async () => true,
        database: secondDatabase,
        now: () => new Date(now.getTime() + 1),
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(firstSource.searchLeadsWithReceipt).toHaveBeenCalledOnce();
    expect(secondSource.searchLeadsWithReceipt).toHaveBeenCalledOnce();
  });

  it("does not let a stale terminal-job repair clear a replacement worker lease", async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<LeadSearchExecution>((resolve) => {
      releaseProvider = () => resolve(execution("apollo-repair-winner"));
    });
    const source = sourceWith(() => providerGate);
    const input = {
      idempotencyKey: "41000000-0000-4000-8000-000000000020",
      actorEmployeeId: ACTOR,
      query: "terminal repair race",
    };
    const databaseUrl = process.env.DATABASE_URL!;
    // Each production DB client is intentionally capped at one connection.
    // Separate clients model two concurrent requests without pool starvation.
    const staleRepairDatabase = createDb(databaseUrl);
    const replacementDatabase = createDb(databaseUrl);
    const pending = await searchApolloPeopleFree(input, { leadSource: source });
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      update public.scheduled_job
      set status = 'failed', completed_at = now(),
          result = '{"status":"failed"}'::jsonb,
          state_version = state_version + 1, updated_at = now()
      where integration_inbox_id = ${pending.receiptId}::uuid
      returning scheduled_job_id
    `);

    let releaseStaleRepair!: () => void;
    const staleRepairGate = new Promise<void>((resolve) => {
      releaseStaleRepair = resolve;
    });
    const staleRepairStarted = vi.fn();
    const staleRepair = searchApolloPeopleFree(input, {
      leadSource: source,
      database: staleRepairDatabase,
      beforeTerminalJobRepair: async () => {
        staleRepairStarted();
        await staleRepairGate;
      },
    });
    let replacement:
      ReturnType<typeof runApolloPeopleSearchQueuedJob> | undefined;
    try {
      await vi.waitFor(() => expect(staleRepairStarted).toHaveBeenCalledOnce());

      await expect(
        searchApolloPeopleFree(input, {
          leadSource: source,
          database: replacementDatabase,
        }),
      ).resolves.toMatchObject({ status: "retry_scheduled" });
      replacement = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
        authorizeActor: async () => true,
      });
      await vi.waitFor(() =>
        expect(source.searchLeadsWithReceipt).toHaveBeenCalledOnce(),
      );

      releaseStaleRepair();
      await staleRepair;
      const [leased] = await db.execute<{
        status: string;
        attempt_token: string | null;
        lease_expires_at: Date | string | null;
      }>(sql`
        select status, attempt_token::text, lease_expires_at
        from public.scheduled_job
        where scheduled_job_id = ${job!.scheduled_job_id}::uuid
      `);
      expect(leased?.status).toBe("running");
      expect(leased?.attempt_token).toMatch(/^[0-9a-f-]{36}$/i);
      expect(leased?.lease_expires_at).not.toBeNull();

      releaseProvider();
      await expect(replacement).resolves.toMatchObject({ status: "completed" });
    } finally {
      releaseStaleRepair();
      releaseProvider();
      await Promise.allSettled([
        staleRepair,
        ...(replacement ? [replacement] : []),
      ]);
    }
  });

  it("reconciles provider auth revocation to the exact owner connection", async () => {
    const idempotencyKey = "41000000-0000-4000-8000-000000000021";
    const providerReceipt = {
      provider: "apollo" as const,
      operation: "people.search" as const,
      httpStatus: 401,
      responseHash: "d".repeat(64),
      receivedAt: new Date().toISOString(),
      rateLimit: {},
    };
    const source = sourceWith(async () => {
      throw new ApolloProviderRequestError(
        "provider rejected credential",
        401,
        false,
        undefined,
        providerReceipt,
      );
    });
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey,
        actorEmployeeId: ACTOR,
        query: "auth revocation",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);

    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
        authorizeActor: async () => true,
      }),
    ).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_PROVIDER_AUTH_REVOKED",
    });
    const [connection] = await db.execute<{
      status: string;
      last_error: string;
      other_status: string;
    }>(sql`
      select actor.status, actor.last_error,
             other.status as other_status
      from public.connection_account actor
      cross join public.connection_account other
      where actor.connection_account_id = ${ACTOR_CONNECTION}::uuid
        and other.connection_account_id = ${OTHER_CONNECTION}::uuid
    `);
    expect(connection).toEqual({
      status: "error",
      last_error: "PROVIDER_AUTHENTICATION_REVOKED",
      other_status: "connected",
    });
  });

  it("does not let a stale 401 disable an in-place rotated credential", async () => {
    const providerReceipt = {
      provider: "apollo" as const,
      operation: "people.search" as const,
      httpStatus: 401,
      responseHash: "e".repeat(64),
      receivedAt: new Date().toISOString(),
      rateLimit: {},
    };
    let rejectProvider!: (error: Error) => void;
    const source = sourceWith(
      () =>
        new Promise<LeadSearchExecution>((_resolve, reject) => {
          rejectProvider = reject;
        }),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000035",
        actorEmployeeId: ACTOR,
        query: "stale auth response after rotation",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    const run = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: source,
      authorizeActor: async () => true,
    });
    await vi.waitFor(() =>
      expect(source.searchLeadsWithReceipt).toHaveBeenCalledOnce(),
    );

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        select vault.update_secret(
          ${actorSecretId}::uuid,
          'synthetic-apollo-proof-key-a-newer'
        )
      `);
      await tx.execute(sql`
        update public.connection_account
        set status = 'connected', last_error = null, updated_at = now()
        where connection_account_id = ${ACTOR_CONNECTION}::uuid
          and secret_id = ${actorSecretId}::uuid
      `);
    });
    rejectProvider(
      new ApolloProviderRequestError(
        "stale credential rejected",
        401,
        false,
        undefined,
        providerReceipt,
      ),
    );

    await expect(run).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_PROVIDER_AUTH_REVOKED",
    });
    const [connection] = await db.execute<{
      status: string;
      last_error: string | null;
      secret_id: string;
    }>(sql`
      select status, last_error, secret_id::text
      from public.connection_account
      where connection_account_id = ${ACTOR_CONNECTION}::uuid
    `);
    expect(connection).toEqual({
      status: "connected",
      last_error: null,
      secret_id: actorSecretId,
    });
  });

  it("persists provider Retry-After without exposing criteria in the job", async () => {
    const scheduledAt = new Date(Date.now() - 1_000);
    const source = sourceWith(async () => {
      throw new ApolloProviderRequestError("HTTP 429", 429, true, 17, {
        provider: "apollo",
        operation: "people.search",
        httpStatus: 429,
        responseHash: "d".repeat(64),
        receivedAt: scheduledAt.toISOString(),
        rateLimit: { retryAfterSeconds: 17 },
      });
    });
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000002",
        actorEmployeeId: ACTOR,
        query: "hospitality",
      },
      { leadSource: source, now: () => scheduledAt },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where payload ->> 'idempotencyKey' = ${pending.idempotencyKey}
    `);
    const outcome = await runApolloPeopleSearchQueuedJob(
      job!.scheduled_job_id,
      {
        leadSource: source,
        authorizeActor: async () => true,
        now: () => scheduledAt,
      },
    );
    expect(outcome).toMatchObject({
      status: "retry_scheduled",
      nextAttemptAt: new Date(scheduledAt.getTime() + 17_000).toISOString(),
    });

    const [stored] = await db.execute<{
      payload: Record<string, unknown>;
      result: Record<string, unknown>;
      run_at: Date | string;
    }>(sql`
      select payload, result, run_at from public.scheduled_job
      where scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);
    expect(new Date(stored!.run_at).toISOString()).toBe(
      new Date(scheduledAt.getTime() + 17_000).toISOString(),
    );
    expect(stored!.payload).not.toHaveProperty("criteria");
    expect(stored!.payload).not.toHaveProperty("actorEmployeeId");
    expect(JSON.stringify(stored!.result)).not.toContain("providerReceipt");
  });

  it("does not let a late initial Inngest receipt overwrite provider Retry-After", async () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    let releaseDispatch!: () => void;
    const dispatchStarted = vi.fn();
    const source = sourceWith(async () => {
      throw new ApolloProviderRequestError("HTTP 429", 429, true, 23, {
        provider: "apollo",
        operation: "people.search",
        httpStatus: 429,
        responseHash: "e".repeat(64),
        receivedAt: now.toISOString(),
        rateLimit: { retryAfterSeconds: 23 },
      });
    });
    const idempotencyKey = "41000000-0000-4000-8000-000000000015";
    const enqueue = searchApolloPeopleFree(
      { idempotencyKey, actorEmployeeId: ACTOR, query: "dispatch race" },
      {
        leadSource: source,
        now: () => now,
        publishRetryEvent: async () => {
          dispatchStarted();
          return new Promise<string>((resolve) => {
            releaseDispatch = () => resolve("synthetic-inngest-event");
          });
        },
      },
    );
    await vi.waitFor(() => expect(dispatchStarted).toHaveBeenCalledTimes(1));

    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where payload ->> 'idempotencyKey' = ${idempotencyKey}
    `);
    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
        authorizeActor: async () => true,
        now: () => now,
      }),
    ).resolves.toMatchObject({
      status: "retry_scheduled",
      nextAttemptAt: "2026-08-31T12:00:23.000Z",
    });
    releaseDispatch();
    await enqueue;

    await expect(
      getApolloPeopleSearchStatus({ idempotencyKey, actorEmployeeId: ACTOR }),
    ).resolves.toMatchObject({
      status: "retry_scheduled",
      nextAttemptAt: "2026-08-31T12:00:23.000Z",
      reason: "APOLLO_HTTP_429",
    });
  });

  it("keeps an unexpected programming TypeError lease-recoverable for Inngest", async () => {
    const now = new Date("2026-08-31T13:00:00.000Z");
    const internalFailure = sourceWith(async () => {
      throw new TypeError("SYNTHETIC_INTERNAL_RUNTIME_OUTAGE");
    });
    const waitingSource = sourceWith(async () =>
      execution("apollo-after-runtime-recovery"),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000016",
        actorEmployeeId: ACTOR,
        query: "runtime recovery",
      },
      { leadSource: internalFailure, now: () => now },
    );
    const waitingPending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000026",
        actorEmployeeId: OTHER_ACTOR,
        query: "blocked by runtime failure lease",
      },
      { leadSource: waitingSource, now: () => now },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    const [waitingJob] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${waitingPending.receiptId}::uuid
    `);
    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: internalFailure,
        authorizeActor: async () => true,
        now: () => now,
      }),
    ).rejects.toThrow(/SYNTHETIC_INTERNAL_RUNTIME_OUTAGE/);

    const [leased] = await db.execute<{
      job_status: string;
      receipt_status: string;
      receipt_bridge_status: string;
    }>(sql`
      select job.status as job_status,
             inbox.status as receipt_status,
             inbox.result ->> 'bridgeStatus' as receipt_bridge_status
      from public.scheduled_job job
      join public.integration_inbox inbox
        on inbox.integration_inbox_id = job.integration_inbox_id
      where job.scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);
    expect(leased).toEqual({
      job_status: "running",
      receipt_status: "processing",
      receipt_bridge_status: "processing",
    });

    await expect(
      runApolloPeopleSearchQueuedJob(waitingJob!.scheduled_job_id, {
        leadSource: waitingSource,
        authorizeActor: async () => true,
        now: () => now,
      }),
    ).resolves.toMatchObject({ status: "busy" });
    expect(waitingSource.searchLeadsWithReceipt).not.toHaveBeenCalled();
    const [waiting] = await db.execute<{
      status: string;
      attempts: number;
    }>(sql`
      select status, attempts from public.scheduled_job
      where scheduled_job_id = ${waitingJob!.scheduled_job_id}::uuid
    `);
    expect(waiting).toEqual({ status: "pending", attempts: 0 });

    const recovered = sourceWith(async () =>
      execution("apollo-runtime-recovered"),
    );
    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: recovered,
        authorizeActor: async () => true,
        now: () => new Date(now.getTime() + 10 * 60_000 + 1),
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(internalFailure.searchLeadsWithReceipt).toHaveBeenCalledTimes(1);
    expect(recovered.searchLeadsWithReceipt).toHaveBeenCalledTimes(1);
    await expect(
      runApolloPeopleSearchQueuedJob(waitingJob!.scheduled_job_id, {
        leadSource: waitingSource,
        authorizeActor: async () => true,
        now: () => new Date(now.getTime() + 10 * 60_000 + 2),
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(waitingSource.searchLeadsWithReceipt).toHaveBeenCalledOnce();
  });

  it("dead-letters a malformed claimed job and its linked receipt atomically", async () => {
    const source = sourceWith(async () =>
      execution("must-not-run-invalid-job"),
    );
    const idempotencyKey = "41000000-0000-4000-8000-000000000017";
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey,
        actorEmployeeId: ACTOR,
        query: "invalid queued payload",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      update public.scheduled_job
      set payload = '{}'::jsonb, updated_at = now()
      where integration_inbox_id = ${pending.receiptId}::uuid
      returning scheduled_job_id
    `);

    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
        authorizeActor: async () => true,
      }),
    ).resolves.toMatchObject({
      status: "dead_letter",
      receiptId: pending.receiptId,
      reason: "APOLLO_SEARCH_JOB_INVALID",
    });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
    await expect(
      getApolloPeopleSearchStatus({ idempotencyKey, actorEmployeeId: ACTOR }),
    ).resolves.toMatchObject({
      status: "dead_letter",
      reason: "APOLLO_SEARCH_JOB_INVALID",
    });

    const [ledger] = await db.execute<{
      job_status: string;
      receipt_status: string;
      receipt_bridge_status: string;
    }>(sql`
      select job.status as job_status,
             inbox.status as receipt_status,
             inbox.result ->> 'bridgeStatus' as receipt_bridge_status
      from public.scheduled_job job
      join public.integration_inbox inbox
        on inbox.integration_inbox_id = job.integration_inbox_id
      where job.scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);
    expect(ledger).toEqual({
      job_status: "failed",
      receipt_status: "failed",
      receipt_bridge_status: "dead_letter",
    });
  });

  it("redacts expired candidate identity while retaining immutable proof", async () => {
    const now = new Date("2026-08-31T14:00:00.000Z");
    const source = sourceWith(async () => execution(`candidate-${Date.now()}`));
    const oldKey = "41000000-0000-4000-8000-000000000018";
    const recentKey = "41000000-0000-4000-8000-000000000019";
    const [oldReceipt, recentReceipt] = await Promise.all([
      searchApolloPeopleFree(
        { idempotencyKey: oldKey, actorEmployeeId: ACTOR, query: "old" },
        { leadSource: source, now: () => now },
      ),
      searchApolloPeopleFree(
        {
          idempotencyKey: recentKey,
          actorEmployeeId: ACTOR,
          query: "recent",
        },
        { leadSource: source, now: () => now },
      ),
    ]);
    const db = getDb()!;
    const jobs = await db.execute<{
      scheduled_job_id: string;
      integration_inbox_id: string;
    }>(sql`
      select scheduled_job_id, integration_inbox_id::text
      from public.scheduled_job
      where integration_inbox_id in (
        ${oldReceipt.receiptId}::uuid,
        ${recentReceipt.receiptId}::uuid
      )
    `);
    for (const job of jobs) {
      await expect(
        runApolloPeopleSearchQueuedJob(job.scheduled_job_id, {
          leadSource: source,
          authorizeActor: async () => true,
          now: () => now,
        }),
      ).resolves.toMatchObject({ status: "completed" });
    }
    expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(2);

    await db.execute(sql`
      update public.integration_inbox
      set processed_at = case
        when integration_inbox_id = ${oldReceipt.receiptId}::uuid
          then '2024-08-30T14:00:00.000Z'::timestamptz
        else '2024-09-01T14:00:00.000Z'::timestamptz
      end
      where integration_inbox_id in (
        ${oldReceipt.receiptId}::uuid,
        ${recentReceipt.receiptId}::uuid
      )
    `);
    await expect(
      redactExpiredApolloPeopleSearchCandidates({
        now,
        retentionMonths: 24,
      }),
    ).resolves.toBe(1);

    const receipts = await db.execute<{
      external_event_id: string;
      has_candidates: boolean;
      candidate_data_state: string | null;
      has_provider_receipt: boolean;
      has_reconciliation: boolean;
    }>(sql`
      select external_event_id,
             result ? 'candidates' as has_candidates,
             result ->> 'candidateDataState' as candidate_data_state,
             result ? 'providerReceipt' as has_provider_receipt,
             result ? 'reconciliation' as has_reconciliation
      from public.integration_inbox
      where external_event_id in (${oldKey}, ${recentKey})
      order by external_event_id
    `);
    expect(receipts).toEqual([
      {
        external_event_id: oldKey,
        has_candidates: false,
        candidate_data_state: "redacted",
        has_provider_receipt: true,
        has_reconciliation: true,
      },
      {
        external_event_id: recentKey,
        has_candidates: true,
        candidate_data_state: null,
        has_provider_receipt: true,
        has_reconciliation: true,
      },
    ]);
    await expect(
      getApolloPeopleSearchStatus({
        idempotencyKey: oldKey,
        actorEmployeeId: ACTOR,
      }),
    ).resolves.toMatchObject({ status: "completed", candidates: [] });
  });

  it("makes an in-flight administrative revocation win over stale success", async () => {
    let release!: () => void;
    const source = sourceWith(
      () =>
        new Promise<LeadSearchExecution>((resolve) => {
          release = () => resolve(execution("apollo-race-person"));
        }),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000003",
        actorEmployeeId: ACTOR,
        query: "race",
      },
      { leadSource: source },
    );
    const nextSource = sourceWith(async () =>
      execution("apollo-after-revocation"),
    );
    const nextPending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000024",
        actorEmployeeId: OTHER_ACTOR,
        query: "wait behind revoked in-flight call",
      },
      { leadSource: nextSource },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where payload ->> 'idempotencyKey' = ${pending.idempotencyKey}
    `);
    const [nextJob] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${nextPending.receiptId}::uuid
    `);
    const run = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: source,
      authorizeActor: async () => true,
    });
    await vi.waitFor(() =>
      expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(1),
    );
    await expect(
      revokeApolloPeopleSearch({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_SEARCH_REVOKED_PROVIDER_MAY_SETTLE",
      providerMaySettle: true,
    });
    const [held] = await db.execute<{
      status: string;
      attempt_token: string | null;
      lease_expires_at: Date | string | null;
    }>(sql`
      select status, attempt_token::text, lease_expires_at
      from public.scheduled_job
      where scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);
    expect(held?.status).toBe("running");
    expect(held?.attempt_token).toMatch(/^[0-9a-f-]{36}$/i);
    expect(held?.lease_expires_at).not.toBeNull();

    await expect(
      runApolloPeopleSearchQueuedJob(nextJob!.scheduled_job_id, {
        leadSource: nextSource,
        authorizeActor: async () => true,
      }),
    ).resolves.toMatchObject({ status: "busy" });
    expect(nextSource.searchLeadsWithReceipt).not.toHaveBeenCalled();
    const [waiting] = await db.execute<{
      status: string;
      attempts: number;
    }>(sql`
      select status, attempts from public.scheduled_job
      where scheduled_job_id = ${nextJob!.scheduled_job_id}::uuid
    `);
    expect(waiting).toEqual({ status: "pending", attempts: 0 });

    release();
    await expect(run).resolves.toMatchObject({ status: "revoked" });
    await expect(
      getApolloPeopleSearchStatus({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).resolves.toMatchObject({ status: "revoked" });
    await expect(
      runApolloPeopleSearchQueuedJob(nextJob!.scheduled_job_id, {
        leadSource: nextSource,
        authorizeActor: async () => true,
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(nextSource.searchLeadsWithReceipt).toHaveBeenCalledOnce();
  });

  it("revokes during the pre-dispatch await without calling Apollo", async () => {
    const source = sourceWith(async () =>
      execution("must-not-dispatch-after-revocation"),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000027",
        actorEmployeeId: ACTOR,
        query: "revoke before dispatch authorization",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    let releaseAuthorization!: () => void;
    const authorizationPaused = vi.fn();
    const run = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: source,
      authorizeActor: async () => true,
      beforeProviderDispatchAuthorization: () =>
        new Promise<void>((resolve) => {
          authorizationPaused();
          releaseAuthorization = resolve;
        }),
    });
    await vi.waitFor(() => expect(authorizationPaused).toHaveBeenCalledOnce());

    await expect(
      revokeApolloPeopleSearch({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_SEARCH_REVOKED",
      providerMaySettle: undefined,
    });
    releaseAuthorization();
    await expect(run).resolves.toMatchObject({ status: "revoked" });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
  });

  it("revalidates the Sales role after credential resolution and before dispatch", async () => {
    const source = sourceWith(async () =>
      execution("must-not-run-after-role-loss"),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000029",
        actorEmployeeId: ACTOR,
        query: "role revoked at dispatch",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    let releaseAuthorization!: () => void;
    const authorizationPaused = vi.fn();
    const run = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: source,
      authorizeActor: async () => true,
      beforeProviderDispatchAuthorization: () =>
        new Promise<void>((resolve) => {
          authorizationPaused();
          releaseAuthorization = resolve;
        }),
    });
    await vi.waitFor(() => expect(authorizationPaused).toHaveBeenCalledOnce());

    await db.execute(sql`
      delete from public.employee_role where employee_id = ${ACTOR}::uuid
    `);
    releaseAuthorization();

    await expect(run).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_SEARCH_AUTHORIZATION_REVOKED",
    });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
  });

  it("revalidates the exact owner connection after resolution and before dispatch", async () => {
    const source = sourceWith(async () =>
      execution("must-not-run-after-connection-loss"),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000030",
        actorEmployeeId: ACTOR,
        query: "connection revoked at dispatch",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    let releaseAuthorization!: () => void;
    const authorizationPaused = vi.fn();
    const run = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: source,
      authorizeActor: async () => true,
      beforeProviderDispatchAuthorization: () =>
        new Promise<void>((resolve) => {
          authorizationPaused();
          releaseAuthorization = resolve;
        }),
    });
    await vi.waitFor(() => expect(authorizationPaused).toHaveBeenCalledOnce());

    await db.execute(sql`
      update public.connection_account
      set status = 'disconnected', updated_at = now()
      where connection_account_id = ${ACTOR_CONNECTION}::uuid
    `);
    releaseAuthorization();

    await expect(run).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_FREE_SEARCH_CONNECTION_REQUIRED",
    });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
    const [other] = await db.execute<{ status: string }>(sql`
      select status from public.connection_account
      where connection_account_id = ${OTHER_CONNECTION}::uuid
    `);
    expect(other?.status).toBe("connected");
  });

  it("rejects an in-place Vault rotation after resolution and before dispatch", async () => {
    const source = sourceWith(async () =>
      execution("must-not-run-with-rotated-secret"),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000034",
        actorEmployeeId: ACTOR,
        query: "credential rotated at dispatch",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    let releaseAuthorization!: () => void;
    const authorizationPaused = vi.fn();
    const run = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: source,
      authorizeActor: async () => true,
      beforeProviderDispatchAuthorization: () =>
        new Promise<void>((resolve) => {
          authorizationPaused();
          releaseAuthorization = resolve;
        }),
    });
    await vi.waitFor(() => expect(authorizationPaused).toHaveBeenCalledOnce());

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        select vault.update_secret(
          ${actorSecretId}::uuid,
          'synthetic-apollo-proof-key-a-rotated'
        )
      `);
      await tx.execute(sql`
        update public.connection_account
        set updated_at = now()
        where connection_account_id = ${ACTOR_CONNECTION}::uuid
          and secret_id = ${actorSecretId}::uuid
      `);
    });
    releaseAuthorization();

    await expect(run).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_FREE_SEARCH_CONNECTION_REQUIRED",
    });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
  });

  it("holds the provider lock after final authorization even when the lease clock expires", async () => {
    let clock = new Date("2026-09-01T13:00:00.000Z");
    const source = sourceWith(async () => execution("provider-lock-winner"));
    const replacementSource = sourceWith(async () =>
      execution("must-not-overlap-provider-lock"),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000031",
        actorEmployeeId: ACTOR,
        query: "provider lock across lease",
      },
      { leadSource: source, now: () => clock },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    let releaseDispatch!: () => void;
    const dispatchPaused = vi.fn();
    const run = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: source,
      authorizeActor: async () => true,
      now: () => clock,
      afterProviderDispatchAuthorization: () =>
        new Promise<void>((resolve) => {
          dispatchPaused();
          releaseDispatch = resolve;
        }),
    });
    await vi.waitFor(() => expect(dispatchPaused).toHaveBeenCalledOnce());
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();

    clock = new Date(clock.getTime() + 10 * 60_000 + 1);
    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: replacementSource,
        authorizeActor: async () => true,
        now: () => clock,
      }),
    ).resolves.toMatchObject({ status: "busy" });
    expect(replacementSource.searchLeadsWithReceipt).not.toHaveBeenCalled();

    releaseDispatch();
    await expect(run).resolves.toMatchObject({ status: "completed" });
    expect(source.searchLeadsWithReceipt).toHaveBeenCalledOnce();
  });

  it("surfaces ambiguity and fences stale completion after provider-lock session loss", async () => {
    let clock = new Date("2026-09-01T14:00:00.000Z");
    let releaseLostProvider!: () => void;
    const lostSource = sourceWith(
      () =>
        new Promise<LeadSearchExecution>((resolve) => {
          releaseLostProvider = () =>
            resolve(execution("must-not-win-after-session-loss"));
        }),
    );
    const replacementSource = sourceWith(async () =>
      execution("apollo-session-loss-replacement"),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000036",
        actorEmployeeId: ACTOR,
        query: "provider lock session loss",
      },
      { leadSource: lostSource, now: () => clock },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    let providerLockBackendPid = 0;
    const backendObserved = vi.fn();
    const lostRun = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: lostSource,
      authorizeActor: async () => true,
      now: () => clock,
      afterProviderLockAcquired: async (backendPid) => {
        providerLockBackendPid = backendPid;
        backendObserved();
      },
    });
    // Attach both handlers immediately: terminating the backend may reject the
    // lock transaction before the synthetic provider promise is released.
    const lostSettled = lostRun.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    await vi.waitFor(() => expect(backendObserved).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(lostSource.searchLeadsWithReceipt).toHaveBeenCalledOnce(),
    );
    expect(providerLockBackendPid).toBeGreaterThan(0);

    const [terminated] = await db.execute<{ terminated: boolean }>(sql`
      select pg_terminate_backend(${providerLockBackendPid}) as terminated
    `);
    expect(terminated?.terminated).toBe(true);

    const beforeLease = new Date(clock.getTime() + 9 * 60_000);
    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: replacementSource,
        authorizeActor: async () => true,
        now: () => beforeLease,
      }),
    ).resolves.toMatchObject({ status: "busy" });
    expect(replacementSource.searchLeadsWithReceipt).not.toHaveBeenCalled();

    clock = new Date(clock.getTime() + 10 * 60_000 + 1);
    let releaseReplacementAuthorization!: () => void;
    const replacementPaused = vi.fn();
    const replacementRun = runApolloPeopleSearchQueuedJob(
      job!.scheduled_job_id,
      {
        leadSource: replacementSource,
        authorizeActor: async () => true,
        now: () => clock,
        beforeProviderDispatchAuthorization: () =>
          new Promise<void>((resolve) => {
            replacementPaused();
            releaseReplacementAuthorization = resolve;
          }),
      },
    );
    await vi.waitFor(() => expect(replacementPaused).toHaveBeenCalledOnce());
    await expect(
      getApolloPeopleSearchStatus({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).resolves.toMatchObject({
      status: "processing",
      providerAttemptedPreviously: true,
      providerMaySettle: true,
    });
    expect(replacementSource.searchLeadsWithReceipt).not.toHaveBeenCalled();

    releaseReplacementAuthorization();
    await expect(replacementRun).resolves.toMatchObject({
      status: "completed",
    });
    releaseLostProvider();
    await lostSettled;

    await expect(
      getApolloPeopleSearchStatus({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).resolves.toMatchObject({
      status: "completed",
      providerAttemptedPreviously: true,
      providerMaySettle: true,
      candidates: [{ externalId: "apollo-session-loss-replacement" }],
    });
  });

  it("retains provider-attempt history when a retry is cancelled", async () => {
    const providerReceipt = execution("retry-attempt-receipt").providerReceipt;
    const source = sourceWith(async () => {
      throw new ApolloProviderRequestError(
        "synthetic rate limit",
        429,
        true,
        60,
        providerReceipt,
      );
    });
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000032",
        actorEmployeeId: ACTOR,
        query: "retry then cancel",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);

    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
        authorizeActor: async () => true,
      }),
    ).resolves.toMatchObject({ status: "retry_scheduled" });
    await expect(
      revokeApolloPeopleSearch({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_SEARCH_REVOKED_AFTER_PROVIDER_ATTEMPT",
      providerAttemptedPreviously: true,
      providerMaySettle: undefined,
    });
    expect(source.searchLeadsWithReceipt).toHaveBeenCalledOnce();
  });

  it("retains an honest ambiguous outcome after a transport retry is cancelled", async () => {
    const source = sourceWith(async () => {
      throw new ApolloProviderRequestError(
        "synthetic transport timeout",
        null,
        true,
        60,
      );
    });
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000033",
        actorEmployeeId: ACTOR,
        query: "transport retry then cancel",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);

    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
        authorizeActor: async () => true,
      }),
    ).resolves.toMatchObject({ status: "retry_scheduled" });
    await expect(
      revokeApolloPeopleSearch({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_SEARCH_REVOKED_PROVIDER_OUTCOME_AMBIGUOUS",
      providerAttemptedPreviously: true,
      providerMaySettle: true,
    });
    expect(source.searchLeadsWithReceipt).toHaveBeenCalledOnce();
  });

  it("preserves a lost attempt warning when its replacement gets a definitive 401", async () => {
    const now = new Date("2026-09-01T15:00:00.000Z");
    const providerReceipt = {
      provider: "apollo" as const,
      operation: "people.search" as const,
      httpStatus: 401,
      responseHash: "f".repeat(64),
      receivedAt: now.toISOString(),
      rateLimit: {},
    };
    const source = sourceWith(async () => {
      throw new ApolloProviderRequestError(
        "replacement credential rejected",
        401,
        false,
        undefined,
        providerReceipt,
      );
    });
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000037",
        actorEmployeeId: ACTOR,
        query: "lost attempt then replacement auth failure",
      },
      { leadSource: source, now: () => now },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    const staleToken = "43000000-0000-4000-8000-000000000037";
    const expiredAt = new Date(now.getTime() - 1);
    await db.execute(sql`
      update public.integration_inbox
      set status = 'processing', attempts = 1,
          result = jsonb_build_object(
            'bridgeStatus', 'processing',
            'providerDispatchState', 'authorized',
            'providerDispatchEverAuthorized', true
          ),
          attempt_token = ${staleToken}::uuid,
          attempt_lease_expires_at = ${expiredAt.toISOString()}::timestamptz,
          state_version = state_version + 1,
          updated_at = ${expiredAt.toISOString()}::timestamptz
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    await db.execute(sql`
      update public.scheduled_job
      set status = 'running', attempts = 1,
          locked_at = ${new Date(now.getTime() - 10 * 60_000 - 1).toISOString()}::timestamptz,
          attempt_token = ${staleToken}::uuid,
          lease_expires_at = ${expiredAt.toISOString()}::timestamptz,
          state_version = state_version + 1,
          updated_at = ${expiredAt.toISOString()}::timestamptz
      where scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);

    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
        authorizeActor: async () => true,
        now: () => now,
      }),
    ).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_PROVIDER_AUTH_REVOKED",
    });
    await expect(
      getApolloPeopleSearchStatus({
        idempotencyKey: pending.idempotencyKey,
        actorEmployeeId: ACTOR,
      }),
    ).resolves.toMatchObject({
      status: "revoked",
      providerAttemptedPreviously: true,
      providerMaySettle: true,
    });
  });

  it("prevents an expired stale worker from dispatching after its replacement", async () => {
    let clock = new Date("2026-09-01T12:00:00.000Z");
    const staleSource = sourceWith(async () =>
      execution("must-not-run-stale-dispatch"),
    );
    let releaseReplacement!: () => void;
    const replacementSource = sourceWith(
      () =>
        new Promise<LeadSearchExecution>((resolve) => {
          releaseReplacement = () =>
            resolve(execution("apollo-replacement-dispatch"));
        }),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000028",
        actorEmployeeId: ACTOR,
        query: "stale dispatch fence",
      },
      { leadSource: staleSource, now: () => clock },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    let releaseStaleAuthorization!: () => void;
    const staleAuthorizationPaused = vi.fn();
    const staleRun = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: staleSource,
      authorizeActor: async () => true,
      now: () => clock,
      beforeProviderDispatchAuthorization: () =>
        new Promise<void>((resolve) => {
          staleAuthorizationPaused();
          releaseStaleAuthorization = resolve;
        }),
    });
    await vi.waitFor(() =>
      expect(staleAuthorizationPaused).toHaveBeenCalledOnce(),
    );

    clock = new Date(clock.getTime() + 10 * 60_000 + 1);
    const replacementRun = runApolloPeopleSearchQueuedJob(
      job!.scheduled_job_id,
      {
        leadSource: replacementSource,
        authorizeActor: async () => true,
        now: () => clock,
      },
    );
    await vi.waitFor(() =>
      expect(replacementSource.searchLeadsWithReceipt).toHaveBeenCalledOnce(),
    );

    releaseStaleAuthorization();
    await expect(staleRun).resolves.toMatchObject({ status: "busy" });
    expect(staleSource.searchLeadsWithReceipt).not.toHaveBeenCalled();
    releaseReplacement();
    await expect(replacementRun).resolves.toMatchObject({
      status: "completed",
    });
    expect(replacementSource.searchLeadsWithReceipt).toHaveBeenCalledOnce();
  });

  it("releases a lost revoked worker slot after lease recovery without a second provider call", async () => {
    const now = new Date("2026-09-01T11:00:00.000Z");
    const source = sourceWith(async () =>
      execution("must-not-run-revoked-recovery"),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000025",
        actorEmployeeId: ACTOR,
        query: "revoked lost worker",
      },
      { leadSource: source, now: () => now },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    const staleToken = "43000000-0000-4000-8000-000000000025";
    const leaseExpiresAt = new Date(now.getTime() + 10 * 60_000);
    await db.execute(sql`
      update public.integration_inbox
      set status = 'processing', attempts = 1,
          result = jsonb_build_object('bridgeStatus', 'processing'),
          attempt_token = ${staleToken}::uuid,
          attempt_lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
          state_version = state_version + 1,
          updated_at = ${now.toISOString()}::timestamptz
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    await db.execute(sql`
      update public.scheduled_job
      set status = 'running', attempts = 1,
          locked_at = ${now.toISOString()}::timestamptz,
          attempt_token = ${staleToken}::uuid,
          lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
          state_version = state_version + 1,
          updated_at = ${now.toISOString()}::timestamptz
      where scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);

    await expect(
      revokeApolloPeopleSearch(
        {
          idempotencyKey: pending.idempotencyKey,
          actorEmployeeId: ACTOR,
        },
        { now: () => new Date(now.getTime() + 1) },
      ),
    ).resolves.toMatchObject({ status: "revoked" });
    const [held] = await db.execute<{
      status: string;
      attempts: number;
      attempt_token: string | null;
    }>(sql`
      select status, attempts, attempt_token::text
      from public.scheduled_job
      where scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);
    expect(held).toEqual({
      status: "running",
      attempts: 1,
      attempt_token: staleToken,
    });

    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
        authorizeActor: async () => true,
        now: () => new Date(leaseExpiresAt.getTime() + 1),
      }),
    ).resolves.toMatchObject({ status: "revoked" });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
    const [released] = await db.execute<{
      status: string;
      attempts: number;
      attempt_token: string | null;
      lease_expires_at: Date | string | null;
    }>(sql`
      select status, attempts, attempt_token::text, lease_expires_at
      from public.scheduled_job
      where scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);
    expect(released).toEqual({
      status: "failed",
      attempts: 2,
      attempt_token: null,
      lease_expires_at: null,
    });
  });

  it("rejects completion from an expired attempt after a replacement worker claims", async () => {
    const now = new Date();
    let release!: () => void;
    const source = sourceWith(
      () =>
        new Promise<LeadSearchExecution>((resolve) => {
          release = () => resolve(execution("apollo-fenced-postgres"));
        }),
    );
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000011",
        actorEmployeeId: ACTOR,
        query: "expired fence",
      },
      { leadSource: source, now: () => now },
    );
    const db = getDb()!;
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    const staleToken = "43000000-0000-4000-8000-000000000001";
    await db.execute(sql`
      update public.integration_inbox
      set status = 'processing', attempts = 1,
          result = jsonb_build_object('bridgeStatus', 'processing'),
          attempt_token = ${staleToken}::uuid,
          attempt_lease_expires_at = ${new Date(now.getTime() - 1_000).toISOString()}::timestamptz,
          state_version = state_version + 1
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    await db.execute(sql`
      update public.scheduled_job
      set status = 'running', attempts = 1,
          locked_at = ${new Date(now.getTime() - 11 * 60_000).toISOString()}::timestamptz,
          attempt_token = ${staleToken}::uuid,
          lease_expires_at = ${new Date(now.getTime() - 1_000).toISOString()}::timestamptz,
          state_version = state_version + 1
      where scheduled_job_id = ${job!.scheduled_job_id}::uuid
    `);

    const replacement = runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
      leadSource: source,
      authorizeActor: async () => true,
      now: () => now,
    });
    await vi.waitFor(() =>
      expect(source.searchLeadsWithReceipt).toHaveBeenCalledTimes(1),
    );
    await expect(
      completeIntegrationReceiptIfProcessing(pending.receiptId, staleToken, {
        bridgeStatus: "completed",
        candidates: [],
      }),
    ).resolves.toBe(false);
    const [inFlight] = await db.execute<{
      receipt_token: string;
      job_token: string;
    }>(sql`
      select inbox.attempt_token::text as receipt_token,
             job.attempt_token::text as job_token
      from public.integration_inbox inbox
      join public.scheduled_job job
        on job.integration_inbox_id = inbox.integration_inbox_id
      where inbox.integration_inbox_id = ${pending.receiptId}::uuid
    `);
    expect(inFlight!.receipt_token).toBe(inFlight!.job_token);
    expect(inFlight!.receipt_token).not.toBe(staleToken);
    release();
    await expect(replacement).resolves.toMatchObject({ status: "completed" });
  });

  it("revokes queued work after the employee loses the Sales role", async () => {
    const source = sourceWith(async () => execution("must-not-run-role"));
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000012",
        actorEmployeeId: ACTOR,
        query: "role removal",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    await db.execute(sql`
      delete from public.employee_role where employee_id = ${ACTOR}::uuid
    `);
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id, {
        leadSource: source,
      }),
    ).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_SEARCH_AUTHORIZATION_REVOKED",
    });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
  });

  it("does not borrow another employee's credential after owner disconnect", async () => {
    const source = sourceWith(async () => execution("must-not-run-credential"));
    const pending = await searchApolloPeopleFree(
      {
        idempotencyKey: "41000000-0000-4000-8000-000000000013",
        actorEmployeeId: ACTOR,
        query: "credential disconnect",
      },
      { leadSource: source },
    );
    const db = getDb()!;
    await db.execute(sql`
      update public.connection_account
      set status = 'disconnected', updated_at = now()
      where connection_account_id = ${ACTOR_CONNECTION}::uuid
    `);
    const [job] = await db.execute<{ scheduled_job_id: string }>(sql`
      select scheduled_job_id from public.scheduled_job
      where integration_inbox_id = ${pending.receiptId}::uuid
    `);
    await expect(
      runApolloPeopleSearchQueuedJob(job!.scheduled_job_id),
    ).resolves.toMatchObject({
      status: "revoked",
      reason: "APOLLO_FREE_SEARCH_CONNECTION_REQUIRED",
    });
    expect(source.searchLeadsWithReceipt).not.toHaveBeenCalled();
    const [other] = await db.execute<{ status: string }>(sql`
      select status from public.connection_account
      where connection_account_id = ${OTHER_CONNECTION}::uuid
    `);
    expect(other?.status).toBe("connected");
  });
});
