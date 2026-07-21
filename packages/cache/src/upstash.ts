import type { CacheClient } from "./types";

export type UpstashConfig = {
  url: string;
  token: string;
};

/**
 * Upstash Redis REST client (no SDK dep in P0).
 * Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 */
export function createUpstashCache(config: UpstashConfig): CacheClient {
  const base = config.url.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };

  async function command<T>(body: unknown[]): Promise<T> {
    const res = await fetch(`${base}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upstash ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { result: T };
    return json.result;
  }

  return {
    backend: "upstash",
    async get(key) {
      const result = await command<string | null>(["GET", key]);
      return result ?? null;
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds != null) {
        await command(["SET", key, value, "EX", String(ttlSeconds)]);
        return;
      }
      await command(["SET", key, value]);
    },
    async del(key) {
      await command(["DEL", key]);
    },
    async invalidatePrefix(prefix) {
      // P0 stub: SCAN not fully wired — callers should prefer explicit keys.
      // Return 0 so callers can fall back to TTL expiry.
      void prefix;
      return 0;
    },
  };
}
