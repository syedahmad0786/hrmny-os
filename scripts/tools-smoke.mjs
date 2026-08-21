#!/usr/bin/env node
/**
 * Tools connectivity smoke — no secrets printed.
 * Usage: node scripts/tools-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* optional */
  }
}
loadEnv(join(root, "apps/web/.env.local"));
loadEnv(join(root, ".env.local"));

const has = (k) => Boolean(process.env[k]?.trim());

async function probe(name, fn) {
  try {
    const r = await fn();
    return { name, ...r };
  } catch (e) {
    return { name, ok: false, error: String(e.message || e).slice(0, 120) };
  }
}

const results = [];

results.push(
  await probe("n8n", async () => {
    if (!has("N8N_API_KEY")) return { ok: false, status: "missing_key" };
    const base = (process.env.N8N_BASE_URL || "https://hrmny.app.n8n.cloud").replace(
      /\/$/,
      "",
    );
    const res = await fetch(`${base}/api/v1/workflows?limit=1`, {
      headers: {
        "X-N8N-API-KEY": process.env.N8N_API_KEY,
        Accept: "application/json",
      },
    });
    return { ok: res.ok, http: res.status };
  }),
);

results.push(
  await probe("composio", async () => {
    if (!has("COMPOSIO_API_KEY")) return { ok: false, status: "missing_key" };
    const res = await fetch("https://backend.composio.dev/api/v3/toolkits?limit=1", {
      headers: {
        "x-api-key": process.env.COMPOSIO_API_KEY,
        Accept: "application/json",
      },
    });
    return { ok: res.ok, http: res.status };
  }),
);

results.push(
  await probe("openrouter", async () => {
    if (!has("OPENROUTER_API_KEY")) return { ok: false, status: "missing_key" };
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    return { ok: res.ok, http: res.status };
  }),
);

results.push({
  name: "apollo",
  ok: has("APOLLO_API_KEY"),
  status: has("APOLLO_API_KEY") ? "key_present" : "mock_until_key",
});
results.push({
  name: "hunter",
  ok: has("HUNTER_API_KEY"),
  status: has("HUNTER_API_KEY") ? "key_present" : "mock_until_key",
});
results.push({
  name: "xero",
  ok: has("XERO_CLIENT_ID"),
  status: has("XERO_CLIENT_ID") ? "key_present" : "mock_until_key",
  writeEnabled: process.env.XERO_WRITE_ENABLED === "true",
});
results.push({
  name: "google_oauth",
  ok: has("GOOGLE_OAUTH_CLIENT_ID") && has("GOOGLE_OAUTH_CLIENT_SECRET"),
  status: has("GOOGLE_OAUTH_CLIENT_ID") ? "configured" : "missing",
});

const liveOk = results.filter((r) => r.ok).length;
const out = {
  ok: results.some((r) => r.name === "n8n" && r.ok),
  liveOk,
  total: results.length,
  results,
};
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 2);
