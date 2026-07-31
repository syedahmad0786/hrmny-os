import { tryCreateDb, type Db } from "@hrmny/db";

let cached: Db | null | undefined;

/**
 * Silent in-memory fallback is allowed only for local/dev demos.
 * Production with live auth (or explicit REQUIRE_DATABASE) must have DATABASE_URL.
 * Escape hatch: ALLOW_MEMORY_STORE=true (emergency demos only).
 */
function memoryStoreForbidden(): boolean {
  const hosted = ["preview", "production"].includes(
    process.env.VERCEL_ENV?.toLowerCase() ?? "",
  );
  if (hosted) return true;
  if (process.env.ALLOW_MEMORY_STORE === "true") return false;
  if (process.env.REQUIRE_DATABASE === "true") return true;
  if (process.env.AUTH_MODE === "supabase") return true;
  return false;
}

export function getDb(): Db | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    if (memoryStoreForbidden()) {
      throw new Error(
        "DATABASE_URL is required for hosted deployments and live authentication. Memory storage is local-development only.",
      );
    }
    cached = null;
    return null;
  }
  cached = tryCreateDb(url);
  return cached;
}

/** Hard requirement — never returns null. */
export function requireDb(): Db {
  const db = getDb();
  if (!db) {
    throw new Error(
      "DATABASE_URL is required for this operation (memory store cannot satisfy it).",
    );
  }
  return db;
}
