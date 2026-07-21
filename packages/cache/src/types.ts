/** Minimal cache interface — Redis in prod, in-memory locally. */
export interface CacheClient {
  readonly backend: "memory" | "upstash";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Invalidate keys matching a prefix (best-effort; memory scans, Redis uses SCAN stub). */
  invalidatePrefix(prefix: string): Promise<number>;
}
