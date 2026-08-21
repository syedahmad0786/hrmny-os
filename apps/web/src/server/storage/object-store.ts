import type { ObjectStore } from "@hrmny/integrations";
import { createObjectStoreFromEnv } from "../demo-store";

let cached: ObjectStore | null = null;

/**
 * Process-wide DAM store from DAM_STORAGE (supabase | memory).
 * Prefer this over getDemoStore().objectStore so asset bytes are not tied
 * to demo Map lifecycle when DATABASE_URL is set.
 */
export function getObjectStore(): ObjectStore {
  if (!cached) cached = createObjectStoreFromEnv();
  return cached;
}

/** Test helper — clear singleton between cases. */
export function resetObjectStoreCache(): void {
  cached = null;
}
