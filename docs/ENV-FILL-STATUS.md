# Env fill status — what we already have vs what you paste next

**Updated:** 2026-08-21  
**Local files written (gitignored):** [`.env.local`](../.env.local), [`apps/web/.env.local`](../apps/web/.env.local)

## Access reality check

| Source | Status |
|--------|--------|
| Live prod public JS (`hrmny-os.vercel.app`) | Used — Supabase URL + publishable key |
| Docs / repo knowledge | Used — app URLs, n8n base, feature defaults, Xero write lock |
| Vercel MCP | Connected to **personal** team only — **not** hrmny team `team_1JFUzpwQIfMIYzFhsmVaBatl` → cannot read prod secrets |
| Supabase MCP | Connected to Ahmad personal org only — **not** org owning `klrugedztqxlvyghyzxs` → cannot read service role / DB URL |
| GitHub Actions secrets | `403` — read-only CLI cannot list secrets |

To let this agent pull remaining secrets automatically later: invite the MCP-connected Vercel/Supabase accounts into the **hrmny** Vercel team + Supabase org (or paste values into Keeper / local `.env.local`).

---

## Already filled locally

| Variable | Value source |
|----------|--------------|
| `NEXT_PUBLIC_APP_URL` | `https://hrmny-os.vercel.app` |
| `NEXT_PUBLIC_PORTAL_URL` | `https://hrmny-os.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://klrugedztqxlvyghyzxs.supabase.co` (verified live) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from prod client bundle (`sb_publishable_…`) |
| `XERO_REDIRECT_URI` | `https://hrmny-os.vercel.app/api/integrations/xero/callback` |
| `XERO_WRITE_ENABLED` | `false` (client lock) |
| `XERO_MODE` / `LLM_PROVIDER` / Apollo/Hunter/n8n modes | `mock` until live keys |
| `N8N_BASE_URL` | `https://hrmny.app.n8n.cloud` |
| `LLM_MONTHLY_CAP_AED` | `1500` |
| Feature flags | minimal HR on; ESS/benefits/workplace/cards/demo resets off |
| `AUTH_MODE` | `dev` until Google + JWT secrets are pasted (then flip to `supabase`) |

---

## Paste these next (Tier-1) — with exact URLs

Copy each into `.env.local` **and** Vercel project `hrmny-os` → Settings → Environment Variables (Production + Preview). Prefer Keeper first; never commit.

| # | Env var | Where to get it | Notes |
|---|---------|-----------------|-------|
| 1 | `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` | [Supabase → Project Settings → API Keys](https://supabase.com/dashboard/project/klrugedztqxlvyghyzxs/settings/api-keys) | Prefer modern **secret** key; legacy `service_role` also works |
| 2 | `DATABASE_URL` | [Supabase → Project Settings → Database](https://supabase.com/dashboard/project/klrugedztqxlvyghyzxs/settings/database) | Use **Transaction pooler** URI (port 6543) with `?pgbouncer=true` if prompted |
| 3 | `DIRECT_URL` | Same Database page | Direct connection (port 5432) for migrations |
| 4 | `SUPABASE_JWT_SECRET` | [API Settings → JWT Secret](https://supabase.com/dashboard/project/klrugedztqxlvyghyzxs/settings/api) | Needed for verifying SSO sessions server-side |
| 5 | `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` | [Google Cloud Console → APIs & Credentials](https://console.cloud.google.com/apis/credentials) **or** copy from existing Vercel env on hrmny team | Also confirm in [Supabase Auth → Providers → Google](https://supabase.com/dashboard/project/klrugedztqxlvyghyzxs/auth/providers) |
| 6 | `OPENROUTER_API_KEY` (+ optional `OPENROUTER_WORKSPACE_ID`) | [OpenRouter → Keys](https://openrouter.ai/keys) — **workspace A (general)** | Then set `LLM_PROVIDER=openrouter` |
| 7 | `OPENROUTER_PRIVILEGED_API_KEY` (+ workspace id) | [OpenRouter → Keys](https://openrouter.ai/keys) — create **separate workspace B** for salaries/finance | Required by client sandbox lock |
| 8 | `XERO_CLIENT_ID` + `XERO_CLIENT_SECRET` | [Xero Developer → My Apps](https://developer.xero.com/app/manage) | Redirect URI must match value already filled; scopes read-only |
| 9 | `XERO_WEBHOOK_KEY` | Same Xero app → Webhooks (optional this phase) | Can leave blank until webhooks |
| 10 | `CRON_SECRET` | Copy from [Vercel → hrmny-os → Environment Variables](https://vercel.com/team_1JFUzpwQIfMIYzFhsmVaBatl/hrmny-os/settings/environment-variables) **or** rotate a new random 32+ char string | Must match GitHub secret `HRMNY_CRON_SECRET` used by scheduler |

After Tier-1 is pasted: set `AUTH_MODE=supabase` and `XERO_MODE=live` (still keep `XERO_WRITE_ENABLED=false`).

---

## Deferred / optional — get later if needed

| Env var | URL |
|---------|-----|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `APOLLO_API_KEY` | https://app.apollo.io/#/settings/integrations/api |
| `HUNTER_API_KEY` | https://hunter.io/api-keys |
| `NEVERBOUNCE_API_KEY` | https://app.neverbounce.com/settings/api |
| `COMPOSIO_API_KEY` | https://app.composio.dev |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | https://app.inngest.com |
| `N8N_API_KEY` | https://hrmny.app.n8n.cloud → Settings → API |
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | https://console.upstash.com |
| `SENTRY_DSN` | https://sentry.io |
| `GOOGLE_CHAT_WEBHOOK_URL` | Google Chat space → Apps & integrations → Webhooks (**rotate** — old one was leaked in chat once) |

---

## Fast path for you

1. Open [Supabase API keys](https://supabase.com/dashboard/project/klrugedztqxlvyghyzxs/settings/api-keys) + [Database](https://supabase.com/dashboard/project/klrugedztqxlvyghyzxs/settings/database) → paste #1–4 into both `.env.local` files.
2. Open [Vercel hrmny-os env](https://vercel.com/team_1JFUzpwQIfMIYzFhsmVaBatl/hrmny-os/settings/environment-variables) → copy `CRON_SECRET`, Google OAuth, and any OpenRouter/Xero already there.
3. If OpenRouter/Xero are missing in Vercel, create them at the URLs in the Tier-1 table.
4. Reply “done” (or paste into chat only if you accept the risk — Keeper/Vercel preferred).

Local app will run on mock/dev until those blanks are filled; public Supabase URL + publishable key are already enough for browser auth client setup.
