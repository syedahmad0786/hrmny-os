import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export * from "./rbac";
export * from "./crm-stages";

/** Re-export query helpers so apps can use Drizzle without a direct dep. */
export { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

export type Db = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    prepare: false,
    ssl: "require",
    max: 1,
  });
  return drizzle(client, { schema });
}

export function tryCreateDb(connectionString: string | undefined): Db | null {
  if (!connectionString?.trim()) return null;
  return createDb(connectionString);
}

export async function pingDatabase(connectionString: string | undefined) {
  const url = connectionString?.trim();
  if (!url) return { ok: false as const, error: "DATABASE_URL not set" };

  const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 10 });
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
