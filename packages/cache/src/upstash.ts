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
      // Official Upstash Redis REST: POST ["SCAN", cursor, "MATCH", glob, "COUNT", n]
      // https://upstash.com/docs/redis/features/restapi
      // https://github.com/upstash/upstash-redis
      const glob = prefix.endsWith("*") ? prefix : `${prefix}*`;
      let cursor = "0";
      let deleted = 0;
      for (let i = 0; i < 50; i += 1) {
        const scanned = await command<[string | number, string[]]>([
          "SCAN",
          cursor,
          "MATCH",
          glob,
          "COUNT",
          "100",
        ]);
        const next = String(scanned?.[0] ?? "0");
        const keys = Array.isArray(scanned?.[1]) ? scanned[1] : [];
        for (const key of keys) {
          await command(["DEL", key]);
          deleted += 1;
        }
        cursor = next;
        if (cursor === "0") break;
      }
      return deleted;
    },
  };
}
