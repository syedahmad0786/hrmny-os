import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export * from "./rbac";
export * from "./crm-stages";

/** Re-export query helpers so apps can use Drizzle without a direct dep. */
export { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

export type Db = ReturnType<typeof createDb>;

export type PostgresAdvisoryLockResult<T> =
  { acquired: false } | { acquired: true; value: T };

export type PostgresAdvisoryLockControl = {
  /** Non-secret backend identity exposed for deterministic lock-loss proofs. */
  backendPid: number;
  /** Fail closed if the transaction backend no longer owns the lock. */
  assertLockActive: () => Promise<void>;
};

type DatabaseSslEnvironment = Record<string, string | undefined>;

const localDatabaseHosts = new Set(["127.0.0.1", "localhost", "postgres"]);

export function resolveDatabaseSsl(
  connectionString: string,
  environment: DatabaseSslEnvironment = process.env,
): "require" | false {
  const mode = (environment.HRMNY_DATABASE_SSL_MODE ?? "require")
    .trim()
    .toLowerCase();
  if (mode === "require") return "require";
  if (mode !== "disable") {
    throw new Error("HRMNY_DATABASE_SSL_MODE must be require or disable");
  }

  const target = new URL(connectionString);
  const disposableCi =
    environment.CI === "true" &&
    environment.HRMNY_CI_POSTGRES_WRITE === "true" &&
    localDatabaseHosts.has(target.hostname);
  if (!disposableCi) {
    throw new Error("DATABASE_SSL_DISABLE_FORBIDDEN");
  }
  return false;
}

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    prepare: false,
    ssl: resolveDatabaseSsl(connectionString),
    max: 1,
    // Fail fast when the DB is unreachable (e.g. IPv6-only direct host from a
    // serverless function) — a bounded error reaches the UI's retry screen;
    // an unbounded connect hangs the request forever.
    connect_timeout: 10,
    idle_timeout: 20,
  });
  return drizzle(client, { schema });
}

/**
 * Hold a transaction-scoped PostgreSQL advisory lock while bounded work runs.
 *
 * This deliberately opens an independent one-connection client: callers may
 * perform normal durable writes through Drizzle without retaining their row
 * locks across the bounded external work. Only this lock-only transaction
 * remains open. Transaction-scoped locks are safe with both direct and
 * transaction-pooler URLs because the pooler pins the transaction to one
 * backend.
 */
export async function withPostgresTransactionAdvisoryLock<T>(
  connectionString: string,
  key: string,
  work: (control: PostgresAdvisoryLockControl) => Promise<T>,
): Promise<PostgresAdvisoryLockResult<T>> {
  const url = connectionString.trim();
  const lockKey = key.trim();
  if (!url) throw new Error("DATABASE_URL is required for advisory locks");
  if (!lockKey) throw new Error("PostgreSQL advisory lock key is required");

  const client = postgres(url, {
    prepare: false,
    ssl: resolveDatabaseSsl(url),
    max: 1,
    connect_timeout: 10,
    idle_timeout: 60,
  });
  try {
    return await client.begin(async (transaction) => {
      await transaction`
        set local idle_in_transaction_session_timeout = '45s'
      `;
      const [lock] = await transaction<
        { acquired: boolean; backend_pid: number }[]
      >`
        select pg_try_advisory_xact_lock(
          hashtextextended(${lockKey}, 0)
        ) as acquired,
        pg_backend_pid()::int as backend_pid
      `;
      if (lock?.acquired !== true) return { acquired: false as const };
      const assertLockActive = async () => {
        const [stillHeld] = await transaction<{ held: boolean }[]>`
          select pg_try_advisory_xact_lock(
            hashtextextended(${lockKey}, 0)
          ) as held
        `;
        if (stillHeld?.held !== true) {
          throw new Error("POSTGRES_ADVISORY_LOCK_LOST");
        }
      };
      return {
        acquired: true as const,
        value: await work({
          backendPid: Number(lock.backend_pid),
          assertLockActive,
        }),
      };
    });
  } finally {
    await client.end({ timeout: 2 });
  }
}

export function tryCreateDb(connectionString: string | undefined): Db | null {
  if (!connectionString?.trim()) return null;
  return createDb(connectionString);
}

export async function pingDatabase(connectionString: string | undefined) {
  const url = connectionString?.trim();
  if (!url) return { ok: false as const, error: "DATABASE_URL not set" };

  const sql = postgres(url, {
    ssl: resolveDatabaseSsl(url),
    max: 1,
    connect_timeout: 10,
  });
  try {
    await sql`select 1`;
    const tables = await sql`
      select count(*)::int as n
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    const roles = await sql`select count(*)::int as n from role`;
    const employees = await sql`select count(*)::int as n from employee`;
    const deals = await sql`select count(*)::int as n from deal`;
    return {
      ok: true as const,
      tables: tables[0]?.n ?? 0,
      roles: roles[0]?.n ?? 0,
      employees: employees[0]?.n ?? 0,
      deals: deals[0]?.n ?? 0,
    };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await sql.end({ timeout: 2 });
  }
}
