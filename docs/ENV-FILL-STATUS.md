# Env fill status — what we already have vs what you paste next

**Updated:** 2026-08-21 (post operational boot + demo funnel CI green)  
**Local files written (gitignored):** [`.env.local`](../.env.local), [`apps/web/.env.local`](../apps/web/.env.local)

## Live now (local `/api/ready`)

`database:up` · `pgvector:true` · `authMode:supabase` · `llmProvider:openrouter` · `xeroWriteEnabled:false`

| Tool | Status |
|------|--------|
| Composio / Google OAuth / OpenRouter / n8n | **configured** |
| Apollo / Hunter / Xero client | **mock** until API keys pasted |

Demo funnel and portal CI e2e pass with mock prospecting. Paste Apollo/Hunter for live ICP enrichment; Xero client id/secret for live invoice mirror (writes stay off).

## Access reality check

| Source | Status |
|--------|--------|
| Live prod public JS (`hrmny-os.vercel.app`) | Used — Supabase URL + publishable key |
| Local `.env.local` (user-filled) | Used — Supabase secret, DB URLs, JWT, Google, OpenRouter, Composio, n8n, Inngest |
| Vercel MCP | Personal team only — **not** hrmny team → cannot read remaining prod secrets |
| Supabase MCP | Personal org only |

---

## Already filled locally

Tier-1 (Supabase, DB, JWT, Google OAuth, OpenRouter general, Composio, n8n, Inngest) is filled. Modes: `AUTH_MODE=supabase`, `LLM_PROVIDER=openrouter`, `DAM_STORAGE=supabase`, `N8N_MODE=live`, `XERO_WRITE_ENABLED=false`.

---

## Paste next for full live tools

| Env var | Where |
|---------|--------|
| `APOLLO_API_KEY` | https://app.apollo.io/#/settings/integrations/api — or paste via `/settings/connections` → Apollo |
| `HUNTER_API_KEY` | https://hunter.io/api-keys — or paste via `/settings/connections` → Hunter |
| `NEVERBOUNCE_API_KEY` (optional) | https://app.neverbounce.com/settings/api |
| `XERO_CLIENT_ID` + `XERO_CLIENT_SECRET` | https://developer.xero.com/app/manage |
| `XERO_ACCESS_TOKEN` + `XERO_TENANT_ID` (optional) | After OAuth authorize — or paste from Keeper |
| `OPENROUTER_PRIVILEGED_API_KEY` | https://openrouter.ai/keys (salaries workspace) |
| `CRON_SECRET` | Vercel hrmny-os env or new random |

Vault paste on Connections is enough for Apollo/Hunter (no redeploy). Env keys still win when set.

After Apollo/Hunter paste: leave modes unset (auto-live) or set `APOLLO_MODE=live` / `HUNTER_MODE=live`.

---

## Demo without those keys

- Prospecting uses Apollo/Hunter **mock** adapters (deterministic enrich/verify)
- Outreach HITL + Composio stub send still works
- Funnel: `node scripts/demo-funnel.mjs` + `e2e/funnel-demo.spec.ts` (CI green)
