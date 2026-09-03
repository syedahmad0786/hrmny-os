# hrmny OS — Build Access Inventory

**Purpose:** Fill this before Phase 1 product coding. Paste secrets into Keeper / Vercel / `.env.local` only — **never commit secret values**.

**Rule:** Mark each row `have` | `need` | `deferred` | `N/A`. Reply “done” per Tier-1 line when the secret is in Keeper/Vercel.

**Companion:** [CREDENTIALS-NEEDED.md](./CREDENTIALS-NEEDED.md) · root [`.env.example`](../.env.example) · [apps/web/.env.example](../apps/web/.env.example)

**Client lock (14 Aug 2026):** Xero read/mirror only · minimal admin HR · People = master headcount · separate OpenRouter workspace for privileged data.

---

## Status legend

| Status | Meaning |
|--------|---------|
| `have` | Credential/access already in Keeper or Vercel |
| `need` | Blocking — must fill before live cutover of that slice |
| `deferred` | Explicitly out of this phase; code stays mock/fail-closed |
| `N/A` | Not used this phase |

---

## 1. Projects & URLs (no secrets)

| System | URL / ID | Owner / login | Where config lives | Status | Notes |
|--------|----------|---------------|--------------------|--------|-------|
| Prod OS (Vercel) | `https://hrmny-os.vercel.app` · team `team_1JFUzpwQIfMIYzFhsmVaBatl` · project `hrmny-os` | developer@hrmny.co | Vercel → Settings → Environment Variables | `have` (URL) | MCP lacks hrmny team — secrets still need paste |
| Desk site | `https://hrmny-os-desk*.vercel.app` | same Vercel team | Vercel env | `deferred` | Public desk; not Phase 1 core |
| Blueprint | `https://hrmny-operating-system-blueprint.vercel.app/` | — | reference only | `have` | Spec canvas |
| Docs (Netlify) | `https://hrmny-os-docs.netlify.app` | — | reference | `have` | Spec HTML |
| Supabase | ref `klrugedztqxlvyghyzxs` · dashboard `https://supabase.com/dashboard/project/klrugedztqxlvyghyzxs` | org owner / PAT | Vercel + local `.env.local` | `partial` | URL + publishable filled locally; secret/DB still need |
| n8n Cloud | `https://hrmny.app.n8n.cloud` | n8n API key | `N8N_*` | `deferred` | Automations optional this phase |
| Google Workspace SSO | `@hrmny.co` | Google Cloud OAuth client | `GOOGLE_OAUTH_*`, Supabase Auth | `need` | Staff login |
| OpenRouter (general) | `https://openrouter.ai` · **workspace A** | API key A | `OPENROUTER_API_KEY` | `need` | Day-to-day agents |
| OpenRouter (privileged) | same account · **workspace B** | API key B | `OPENROUTER_PRIVILEGED_API_KEY` | `need` | Salaries / finance LLM only |
| OpenAI embeddings | `https://platform.openai.com` | API key | `OPENAI_API_KEY` | `deferred` | Memory until AI slice |
| Xero (read) | `https://developer.xero.com` | App + finance tenant auth | `XERO_*`, `XERO_MODE=live` | `need` | **Read/mirror only** |
| Apollo | app.apollo.io | API key | `APOLLO_*` | `deferred` | Lead-gen |
| Hunter | hunter.io | API key + credits | `HUNTER_*` | `deferred` | Lead-gen |
| NeverBounce | neverbounce.com | API key + credits | `NEVERBOUNCE_API_KEY` | `deferred` | Lead-gen |
| Composio | app.composio.dev | API key + Gmail connect | `COMPOSIO_*` | `deferred` | HITL send |
| Inngest | app.inngest.com | event + signing keys | `INNGEST_*` | `deferred` | Durable AI pipelines |
| GBrain | organization-owned dedicated runtime | source-scoped projector client | `GBRAIN_MCP_URL`, `GBRAIN_ACCESS_TOKEN`, `GBRAIN_SOURCE_ID` | `need` | Pinned `v0.48.2.0`; separate DB; writes fenced to `hrmny/knowledge/` |
| Upstash Redis | console.upstash.com | REST URL + token | `UPSTASH_*` | `deferred` | Cache / rate limits |
| Sentry | sentry.io | DSN | `SENTRY_DSN` | `deferred` | Monitoring |
| Bayzat | CSV exports only | HR export access | `BAYZAT_SOURCE=csv` | `have` | Parallel until native minimal HR |
| Keeper | team vault | vault owners | never git | `need` | Secret store of record |
| Granola notes | [hrmny - OS meeting](https://notes.granola.ai/t/95ef6637-f16f-4de0-be55-548721397604-00demib2) | — | reference | `have` | Client decisions |

### Confirm (names only — no secrets in this file)

| Item | Value to fill | Status |
|------|---------------|--------|
| Vercel project exact name | `hrmny-os` (confirm) | `need` |
| Supabase project name / region | | `need` |
| Xero organisation / tenant name | | `need` |
| Who authorises Xero tenant (finance owner) | | `need` |
| OpenRouter workspace A name | e.g. `hrmny-os-general` | `need` |
| OpenRouter workspace B name | e.g. `hrmny-os-privileged` | `need` |
| Google OAuth client display name | | `need` |
| Cron secret rotation owner | | `need` |

---

## 2. Tier-1 fill checklist (blocks live OS)

Copy each into Keeper folder `hrmny-os / production`, then into Vercel Production + Preview env (and local `.env.local` for dev).

| # | What | Env var(s) | Status | Done? |
|---|------|------------|--------|-------|
| 1 | Supabase URL | `NEXT_PUBLIC_SUPABASE_URL` | `need` | |
| 2 | Supabase publishable / anon | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `need` | |
| 3 | Supabase secret / service role | `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` | `need` | |
| 4 | Database URLs | `DATABASE_URL`, `DIRECT_URL` | `need` | |
| 5 | Auth mode + JWT | `AUTH_MODE=supabase`, `SUPABASE_JWT_SECRET` | `need` | |
| 6 | Google OAuth | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `need` | |
| 7 | App URLs | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PORTAL_URL` | `need` | |
| 8 | OpenRouter general | `OPENROUTER_API_KEY`, `OPENROUTER_WORKSPACE_ID`, `LLM_PROVIDER=openrouter` | `need` | |
| 9 | OpenRouter privileged | `OPENROUTER_PRIVILEGED_API_KEY`, `OPENROUTER_PRIVILEGED_WORKSPACE_ID` | `need` | |
| 10 | Xero read app | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `XERO_WEBHOOK_KEY`, `XERO_MODE=live` | `need` | |
| 11 | Xero write kill-switch | `XERO_WRITE_ENABLED=false` (**hard default — do not set true**) | `have` | code default |
| 12 | Cron | `CRON_SECRET` | `need` | |
| 13 | Monthly AI cap | `LLM_MONTHLY_CAP_AED=1500` | `have` | default in example |

**Gate:** Phase 1 code may land with mock/fail-closed behaviour, but **production invite launch** requires every Tier-1 row `have` (or explicitly `deferred` with written acceptance).

---

## 3. Tier-2 — this phase optional / deferred

| # | What | Env var(s) | Status |
|---|------|------------|--------|
| 14 | OpenAI embeddings | `OPENAI_API_KEY`, `EMBEDDING_*` | `deferred` |
| 15 | Anthropic (optional routing) | `ANTHROPIC_API_KEY` | `deferred` |
| 16 | Apollo / Hunter / NeverBounce | `APOLLO_*`, `HUNTER_*`, `NEVERBOUNCE_API_KEY` | `deferred` |
| 17 | Composio + Gmail | `COMPOSIO_API_KEY`, `COMPOSIO_WEBHOOK_SECRET` | `deferred` |
| 18 | Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | `deferred` |
| 19 | n8n | `N8N_API_KEY`, `N8N_MODE`, webhooks | `deferred` |
| 20 | Upstash | `UPSTASH_REDIS_REST_*` | `deferred` |
| 21 | Sentry | `SENTRY_DSN` | `deferred` |
| 22 | Google Chat alerts | `GOOGLE_CHAT_WEBHOOK_URL` | `deferred` |
| 23 | DAM supabase | `DAM_STORAGE=supabase`, `DAM_BUCKET` | `deferred` until storage go-live |

---

## 4. Explicitly out of scope this phase (do not provision for OS)

| Item | Why |
|------|-----|
| Meta / Google / TikTok ads | V2 / M11 cut |
| DocuSign | Optional later |
| Tejari | Gov-RFP lane later |
| Bayzat API | CSV only; no public API |
| AEO visibility tooling | Parallel commercial track — not OS |
| Xero write credentials / scopes beyond read | Client: OS never writes to Xero |

---

## 5. Local setup once secrets exist

```bash
cp .env.example .env.local
cp apps/web/.env.example apps/web/.env.local
# Fill values from Keeper — never commit these files
pnpm install
pnpm dev
```

Production: paste the same Tier-1 keys into Vercel project `hrmny-os` (Production + Preview), then redeploy.

---

## 6. Fill-in log

| Date | Who | What marked have / deferred |
|------|-----|-----------------------------|
| 2026-08-21 | Agent | Inventory created; Tier-1 status `need`; code defaults `XERO_WRITE_ENABLED=false`; privileged OpenRouter vars added to `.env.example` |
| 2026-08-21 | Agent | Filled local `.env.local` from prod public bundle (Supabase URL + publishable key, app URLs). See [ENV-FILL-STATUS.md](./ENV-FILL-STATUS.md) for remaining paste URLs. |
