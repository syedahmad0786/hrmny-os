import { tryCreateDb, type Db } from "@hrmny/db";

let cached: Db | null | undefined;

export function getDb(): Db | null {
  if (cached !== undefined) return cached;
  cached = tryCreateDb(process.env.DATABASE_URL);
  return cached;
}
