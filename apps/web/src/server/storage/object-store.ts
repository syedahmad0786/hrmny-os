import type { ObjectStore } from "@hrmny/integrations";
import { createObjectStoreFromEnv, getDemoStore } from "../demo-store";

let supabaseCached: ObjectStore | null = null;

/**
 * Process-wide DAM store from DAM_STORAGE.
 * - memory (default): share getDemoStore().objectStore so demo upload + signedUrl
 *   hit the same Map (CI has no DATABASE_URL).
 * - supabase: singleton live Storage client (not tied to demo Map lifecycle).
 */
export function getObjectStore(): ObjectStore {
  const mode = (process.env.DAM_STORAGE ?? "memory").toLowerCase();
  if (mode === "supabase") {
    if (!supabaseCached) supabaseCached = createObjectStoreFromEnv();
    return supabaseCached;
  }
  return getDemoStore().objectStore;
}

/** Test helper — clear supabase singleton between cases. */
export function resetObjectStoreCache(): void {
  supabaseCached = null;
}
