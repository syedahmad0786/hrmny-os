import { setTimeout as delay } from "node:timers/promises";
import { createDb, sql, type Db } from "@hrmny/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const EMPLOYEE_ID = "28000000-0000-4000-8000-000000000082";
const EMPLOYEE_NAME = "Work authority fence proof";
const AUTHORITY_TABLES = [
  "employee",
  "employee_role",
  "feature_override",
  "permission_policy",
  "role",
  "work_member_license",
  "work_project",
  "work_project_member",
  "work_team_member",
  "work_team_project",
] as const;

function namedDatabase(name: string): Db {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("application_name", name);
  return createDb(url.toString());
}

async function closeDatabase(database: Db): Promise<void> {
  await database.$client.end({ timeout: 0 });
}

async function revision(database: Pick<Db, "execute">): Promise<number> {
  const [row] = await database.execute<{ revision: string | number }>(sql`
    select revision
    from qm_internal.work_authority_revision
    where singleton = true
  `);
  if (!row) throw new Error("WORK_AUTHORITY_FENCE_STATE_MISSING");
  return Number(row.revision);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("POSTGRES_PROOF_TIMEOUT");
    await delay(20);
  }
}

const holder = namedDatabase("work_authority_fence_holder");
const writer = namedDatabase("work_authority_fence_writer");
const observer = namedDatabase("work_authority_fence_observer");

beforeAll(async () => {
  await observer.execute(sql`
    insert into public.employee (
      employee_id, display_name, email, is_active
    ) values (
      ${EMPLOYEE_ID}::uuid,
      ${EMPLOYEE_NAME},
      'work-authority-fence@example.test',
      true
    )
    on conflict (employee_id) do update
      set display_name = excluded.display_name,
          email = excluded.email,
          is_active = true,
          updated_at = now()
  `);
  await observer.execute(sql`
    delete from public.work_member_license
    where employee_id = ${EMPLOYEE_ID}::uuid
  `);
  await observer.execute(sql`
    do $$
    begin
      if not exists (
        select 1 from pg_catalog.pg_roles
        where rolname = 'qm_authority_fence_proof_role'
      ) then
        create role qm_authority_fence_proof_role nologin;
      end if;
    end $$;
    grant qm_authority_fence_proof_role to current_user;
    revoke all privileges on schema qm_internal
      from qm_authority_fence_proof_role;
    revoke all privileges on table qm_internal.work_authority_revision
      from qm_authority_fence_proof_role;
    revoke all privileges on all tables in schema public
      from qm_authority_fence_proof_role;
    grant usage on schema qm_internal to qm_authority_fence_proof_role;
    grant execute on function
      qm_internal.acquire_work_authority_fence(bigint)
      to qm_authority_fence_proof_role;
  `);
});

afterAll(async () => {
  await observer.execute(sql`
    delete from public.work_member_license
    where employee_id = ${EMPLOYEE_ID}::uuid
  `);
  await observer.execute(sql`
    delete from public.employee where employee_id = ${EMPLOYEE_ID}::uuid
  `);
  await observer.execute(sql`
    revoke execute on function
      qm_internal.acquire_work_authority_fence(bigint)
      from qm_authority_fence_proof_role;
    revoke usage on schema qm_internal from qm_authority_fence_proof_role;
    revoke qm_authority_fence_proof_role from current_user;
    drop role qm_authority_fence_proof_role;
  `);
  await Promise.all([
    closeDatabase(holder),
    closeDatabase(writer),
    closeDatabase(observer),
  ]);
});

describe("native QM Work authority PostgreSQL fence", () => {
  it("blocks mutations, advances transactionally, and fails closed", async () => {
    const triggers = await observer.execute<{
      table_name: string;
      trigger_name: string;
      trigger_type: number;
    }>(sql`
      select relation.relname as table_name, trigger.tgname as trigger_name,
        trigger.tgtype::int as trigger_type
      from pg_catalog.pg_trigger trigger
      join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and trigger.tgname in (
          'work_authority_lock_fence_trg',
          'work_authority_revision_fence_trg',
          'work_authority_truncate_revision_trg'
        )
      order by relation.relname, trigger.tgname
    `);
    expect(triggers).toEqual(
      AUTHORITY_TABLES.flatMap((table_name) => [
        {
          table_name,
          trigger_name: "work_authority_lock_fence_trg",
          trigger_type: 62,
        },
        {
          table_name,
          trigger_name: "work_authority_revision_fence_trg",
          trigger_type: 29,
        },
        {
          table_name,
          trigger_name: "work_authority_truncate_revision_trg",
          trigger_type: 32,
        },
      ]),
    );

    const [publicAcl] = await observer.execute<{
      schema_usage: boolean;
      table_access: boolean;
      fence_execute: boolean;
    }>(sql`
      select
        exists (
          select 1
          from pg_catalog.pg_namespace namespace,
            lateral pg_catalog.aclexplode(coalesce(
              namespace.nspacl,
              pg_catalog.acldefault('n', namespace.nspowner)
            )) acl
          where namespace.nspname = 'qm_internal'
            and acl.grantee = 0 and acl.privilege_type = 'USAGE'
        ) as schema_usage,
        exists (
          select 1
          from pg_catalog.pg_class relation,
            lateral pg_catalog.aclexplode(coalesce(
              relation.relacl,
              pg_catalog.acldefault('r', relation.relowner)
            )) acl
          where relation.oid =
              'qm_internal.work_authority_revision'::regclass
            and acl.grantee = 0
        ) as table_access,
        exists (
          select 1
          from pg_catalog.pg_proc procedure,
            lateral pg_catalog.aclexplode(coalesce(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )) acl
          where procedure.oid =
              'qm_internal.acquire_work_authority_fence(bigint)'::regprocedure
            and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        ) as fence_execute
    `);
    expect(publicAcl).toEqual({
      schema_usage: false,
      table_access: false,
      fence_execute: false,
    });

    const blockedRoleAccess = await observer.execute<{
      rolname: string;
      schema_usage: boolean;
      table_read: boolean;
      fence_execute: boolean;
    }>(sql`
      select role.rolname,
        pg_catalog.has_schema_privilege(
          role.oid, 'qm_internal', 'USAGE'
        ) as schema_usage,
        pg_catalog.has_table_privilege(
          role.oid,
          'qm_internal.work_authority_revision',
          'SELECT'
        ) as table_read,
        pg_catalog.has_function_privilege(
          role.oid,
          'qm_internal.acquire_work_authority_fence(bigint)',
          'EXECUTE'
        ) as fence_execute
      from pg_catalog.pg_roles role
      where role.rolname in (
        'anon', 'authenticated', 'authenticator', 'service_role'
      )
      order by role.rolname
    `);
    expect(blockedRoleAccess).toEqual(
      blockedRoleAccess.map(({ rolname }) => ({
        rolname,
        schema_usage: false,
        table_read: false,
        fence_execute: false,
      })),
    );

    await expect(
      observer.transaction(async (tx) => {
        await tx.execute(sql`set local role qm_authority_fence_proof_role`);
        const [locked] = await tx.execute<{ revision: string | number }>(sql`
          select qm_internal.acquire_work_authority_fence(null) as revision
        `);
        expect(Number(locked?.revision)).toBeGreaterThanOrEqual(0);
      }),
    ).resolves.toBeUndefined();
    await expect(
      observer.transaction(async (tx) => {
        await tx.execute(sql`set local role qm_authority_fence_proof_role`);
        await tx.execute(sql`
          select revision from qm_internal.work_authority_revision
        `);
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      observer.transaction(async (tx) => {
        await tx.execute(sql`set local role qm_authority_fence_proof_role`);
        await tx.execute(sql`select employee_id from public.employee limit 1`);
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      observer.transaction(async (tx) => {
        await tx.execute(sql`set local role qm_authority_fence_proof_role`);
        await tx.execute(sql`
          update public.employee set is_active = false
          where employee_id = ${EMPLOYEE_ID}::uuid
        `);
      }),
    ).rejects.toMatchObject({ code: "42501" });

    const before = await revision(observer);
    const holderReady = deferred();
    const releaseHolder = deferred();
    let heldRevision = -1;
    let writerMutation: Promise<unknown> | undefined;
    let holderFailure: unknown;
    let writerFailure: unknown;
    const holderTransaction = holder.transaction(async (tx) => {
      const [locked] = await tx.execute<{ revision: string | number }>(sql`
        select qm_internal.acquire_work_authority_fence(null) as revision
      `);
      heldRevision = Number(locked?.revision);
      holderReady.resolve();
      await releaseHolder.promise;
    });
    const holderSettled = holderTransaction.catch((error: unknown) => {
      holderFailure = error;
      holderReady.resolve();
    });

    try {
      await Promise.race([
        holderReady.promise,
        delay(3_000).then(() => {
          throw new Error("POSTGRES_HOLDER_TIMEOUT");
        }),
      ]);
      if (holderFailure) throw holderFailure;
      expect(heldRevision).toBe(before);
      const [writerBackend] = await writer.execute<{ pid: number }>(sql`
        select pg_catalog.pg_backend_pid()::int as pid
      `);
      writerMutation = writer.execute(sql`
        update public.employee
        set is_active = false, updated_at = now()
        where employee_id = ${EMPLOYEE_ID}::uuid
      `);
      writerMutation = writerMutation.catch((error: unknown) => {
        writerFailure = error;
      });

      await waitUntil(async () => {
        const [activity] = await observer.execute<{
          wait_event_type: string | null;
          wait_event: string | null;
        }>(sql`
          select wait_event_type, wait_event
          from pg_catalog.pg_stat_activity
          where pid = ${writerBackend!.pid}
        `);
        return (
          activity?.wait_event_type === "Lock" &&
          activity.wait_event === "advisory"
        );
      });
      const [unchanged] = await observer.execute<{ is_active: boolean }>(sql`
        select is_active
        from public.employee
        where employee_id = ${EMPLOYEE_ID}::uuid
      `);
      expect(unchanged?.is_active).toBe(true);
      expect(await revision(observer)).toBe(before);
    } finally {
      releaseHolder.resolve();
      await holderSettled;
      await writerMutation;
    }
    if (holderFailure) throw holderFailure;
    if (writerFailure) throw writerFailure;

    expect(await revision(observer)).toBe(before + 1);
    await expect(
      observer.transaction(async (tx) => {
        await tx.execute(sql`
          select qm_internal.acquire_work_authority_fence(${before}::bigint)
        `);
      }),
    ).rejects.toMatchObject({
      code: "40001",
      message: "WORK_AUTHORITY_REVISION_STALE",
    });

    const beforeRollback = await revision(observer);
    await expect(
      writer.transaction(async (tx) => {
        await tx.execute(sql`
          update public.employee
          set is_active = true, updated_at = now()
          where employee_id = ${EMPLOYEE_ID}::uuid
        `);
        expect(await revision(tx)).toBe(beforeRollback + 1);
        throw new Error("ROLLBACK_PROOF");
      }),
    ).rejects.toThrow("ROLLBACK_PROOF");
    expect(await revision(observer)).toBe(beforeRollback);

    const beforeMultiTable = await revision(observer);
    await writer.transaction(async (tx) => {
      await tx.execute(sql`
        update public.employee
        set is_active = true, updated_at = now()
        where employee_id = ${EMPLOYEE_ID}::uuid
      `);
      await tx.execute(sql`
        insert into public.work_member_license (
          employee_id, license_type, updated_by_employee_id
        ) values (
          ${EMPLOYEE_ID}::uuid, 'full', ${EMPLOYEE_ID}::uuid
        )
        on conflict (employee_id) do update
          set license_type = excluded.license_type, updated_at = now()
      `);
      expect(await revision(tx)).toBe(beforeMultiTable + 2);
    });
    expect(await revision(observer)).toBe(beforeMultiTable + 2);

    const beforeNoop = await revision(observer);
    await writer.execute(sql`
      update public.employee
      set is_active = is_active, display_name = 'ignored profile change'
      where employee_id = ${EMPLOYEE_ID}::uuid
    `);
    await writer.execute(sql`
      update public.employee
      set is_active = false
      where employee_id = '28000000-0000-4000-8000-000000000083'::uuid
    `);
    expect(await revision(observer)).toBe(beforeNoop);

    const beforeMissingState = await revision(observer);
    await expect(
      observer.transaction(async (tx) => {
        await tx.execute(sql`
          delete from qm_internal.work_authority_revision
          where singleton = true
        `);
        await tx.execute(sql`
          select qm_internal.acquire_work_authority_fence(null)
        `);
      }),
    ).rejects.toMatchObject({
      code: "55000",
      message: "WORK_AUTHORITY_FENCE_STATE_MISSING",
    });
    expect(await revision(observer)).toBe(beforeMissingState);
  });
});
