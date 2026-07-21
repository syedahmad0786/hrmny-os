import type { CacheClient } from "./types";

type Entry = { value: string; expiresAt?: number };

/** Local / CI fallback when Upstash env is unset. */
export function createMemoryCache(): CacheClient {
  const store = new Map<string, Entry>();

  function purge(key: string, entry: Entry | undefined): string | null {
    if (!entry) return null;
    if (entry.expiresAt != null && Date.now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  return {
    backend: "memory",
    async get(key) {
      return purge(key, store.get(key));
    },
    async set(key, value, ttlSeconds) {
      store.set(key, {
        value,
        expiresAt:
          ttlSeconds != null ? Date.now() + ttlSeconds * 1000 : undefined,
      });
    },
    async del(key) {
      store.delete(key);
    },
    async invalidatePrefix(prefix) {
      let n = 0;
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          n += 1;
        }
      }
      return n;
    },
  };
}
