import { createMemoryCache } from "./memory";
import { createUpstashCache } from "./upstash";
import type { CacheClient } from "./types";

export type { CacheClient } from "./types";
export { createMemoryCache } from "./memory";
export { createUpstashCache } from "./upstash";

export type CreateCacheConfig = {
  upstashUrl?: string;
  upstashToken?: string;
  /** Force memory even if Upstash env present (tests). */
  forceMemory?: boolean;
};

/**
 * Prefer Upstash when REST URL + token are set; otherwise in-memory.
 */
export function createCache(config: CreateCacheConfig = {}): CacheClient {
  if (config.forceMemory) return createMemoryCache();

  const url =
    config.upstashUrl ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token =
    config.upstashToken ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

  if (url.trim() && token.trim()) {
    return createUpstashCache({ url: url.trim(), token: token.trim() });
  }
  return createMemoryCache();
}

/** Cache key helpers for CRM / memory hot paths. */
export const cacheKeys = {
  dealList: (scope: string) => `crm:deals:${scope}`,
  memoryRetrieve: (dealId: string, queryHash: string) =>
    `mem:retrieve:${dealId}:${queryHash}`,
  embedding: (contentHash: string) => `mem:embed:${contentHash}`,
} as const;
