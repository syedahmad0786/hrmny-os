import { tryCreateDb, type Db } from "@hrmny/db";
import { AsyncLocalStorage } from "node:async_hooks";

const databaseScope = new AsyncLocalStorage<Db>();

/** Keep repository calls and import lineage inside the same transaction. */
export function withDatabaseScope<T>(
  db: Db,
  work: () => Promise<T>,
): Promise<T> {
  return databaseScope.run(db, work);
}

let cached: Db | null | undefined;

export function getDb(): Db | null {
  const scoped = databaseScope.getStore();
  if (scoped) return scoped;
  const mode = (process.env.DATABASE_MODE ?? "auto").trim().toLowerCase();
  if (!new Set(["auto", "postgres", "memory"]).has(mode)) {
    throw new Error("DATABASE_MODE must be auto, postgres, or memory");
  }
  if (mode === "memory") {
    const productionTestAllowed =
      process.env.AUTH_MODE?.trim().toLowerCase() === "dev" &&
      process.env.ALLOW_DEV_AUTH === "true";
    if (process.env.NODE_ENV === "production" && !productionTestAllowed) {
      throw new Error(
        "DATABASE_MODE=memory is forbidden in production without the explicit dev-auth test gate",
      );
    }
    return null;
  }
  if (mode === "postgres" && !process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_MODE=postgres requires DATABASE_URL");
  }
  if (cached !== undefined) return cached;
  cached = tryCreateDb(process.env.DATABASE_URL);
  return cached;
}
