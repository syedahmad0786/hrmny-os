# hrmny OS — Credentials & Access Needed (ordered by blocking impact)

**Prepared:** 2026-07-30 · **Updated:** 2026-09-03 · **Owner:** Ahmad Bukhari
**Rule:** never send secrets through chat/email/git. Put each value in the approved Keeper folder (or paste directly into Vercel env), and reply only "done" per line item.

**Start here:** fill [BUILD-ACCESS-INVENTORY.md](./BUILD-ACCESS-INVENTORY.md) first. Client lock: `XERO_WRITE_ENABLED=false`, dual OpenRouter workspaces (general + privileged).

Companion: `PRODUCTION-OWNERSHIP-ACCESS-REGISTER.md` (ownership + how each connection is accepted), `MASTER-PLAN-V2.md` (what each key unblocks), `docs/audits/2026-08-27-os-completion/HUMAN-GATES.md` (consolidated request).

## Tier 1 — blocks everything AI (Phase 0 / M7)

| # | What | Env var(s) | Where to get it | Unblocks |
|---|---|---|---|---|
| 1 | OpenRouter API key (+ set provider) | `OPENROUTER_API_KEY`, `LLM_PROVIDER=openrouter`, `LLM_MONTHLY_CAP_AED=1500` | openrouter.ai → Keys | All AI milestones M7–M12 |
| 2 | OpenAI API key (embeddings only) | `OPENAI_API_KEY` (`EMBEDDING_PROVIDER=openai`, model `text-embedding-3-small`) | platform.openai.com → API keys | Semantic memory, intelligence graph, M10 |
| 3 | Anthropic API key (optional second provider for high-stakes gates) | `ANTHROPIC_API_KEY` | console.anthropic.com | Model routing for gate/scoring calls |

## Tier 2 — blocks M8 Lead-Gen Engine

| # | What | Env var(s) | Where to get it | Unblocks |
|---|---|---|---|---|
| 4 | Apollo API key (scoped to hrmny OS, with a monthly credit limit) | `APOLLO_API_KEY`, `APOLLO_MODE=live` | app.apollo.io → Settings → API | Lead sourcing + enrichment |
| 5 | Hunter team API key **with funded Email Verifier credits** (account currently dead — needs re-provisioning) | `HUNTER_API_KEY`, `HUNTER_MODE=live` | hunter.io → API | Verified-email gate — **an M3 payment trigger** |
| 6 | NeverBounce API key + credits (currently 0) | `NEVERBOUNCE_API_KEY`, `NEVERBOUNCE_MODE=live`, optional `EMAIL_VERIFICATION_PROVIDER=neverbounce` | neverbounce.com → API | Verification fallback (no longer requires `HUNTER_MODE=live`) |
| 7 | Composio workspace + API key; then authorize **Gmail** connection in-app | `COMPOSIO_API_KEY`, `COMPOSIO_WEBHOOK_SECRET` | app.composio.dev → Settings → API keys | HITL outreach send (M8); LinkedIn publish (M9); code is already wired |
| 8 | Inngest account keys | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | app.inngest.com → project keys | Daily AI pipelines (5-min cron can't run them) |

## Tier 3 — infrastructure control (so agents can deploy/manage prod)

| # | What | How | Unblocks |
|---|---|---|---|
| 9 | Vercel access for developer@hrmny.co team `team_1JFUzpwQIfMIYzFhsmVaBatl` — team token, or add Ahmad's MCP-connected account as member | vercel.com → team settings → Tokens/Members | Automated deploys, env management for the REAL prod project `hrmny-os` |
| 10 | Supabase access token for the org owning ref `klrugedztqxlvyghyzxs` — personal access token, or org invite | supabase.com/dashboard → Access Tokens | Migrations, logs, advisors on the REAL prod DB |
| 11 | n8n API key for `hrmny.app.n8n.cloud` | n8n → Settings → API | `N8N_API_KEY`, `N8N_WEBHOOK_SECRET` — automation seams |
| 12 | Google Chat alert webhook plus Chat app service account | Chat space → Apps & integrations → Webhooks; Google Cloud project owning the Chat app → service account JSON | `GOOGLE_CHAT_WEBHOOK_URL` — health + cap alerts; `GOOGLE_CHAT_SERVICE_ACCOUNT_JSON` and exact `GOOGLE_CHAT_AUDIENCE` — durable threaded assistant replies |

### Company brain cutover

Deploy `garrytan/gbrain` `v0.48.2.0` at commit `5cfb84f1d3a809c70064c292c23db3d538d5c551` with its own PostgreSQL database. Register one `hrmny-os` write client bound server-side to `hrmny/knowledge/`, then set `GBRAIN_MCP_URL`, `GBRAIN_ACCESS_TOKEN`, and `GBRAIN_SOURCE_ID=hrmny-os` in Vercel. Never give hrmny OS or QM the raw GBrain database credential.

## Tier 4 — milestone-specific (can arrive later, before their milestone)

| # | What | Env var(s) | Needed by |
|---|---|---|---|
| 13 | Xero developer app (client id/secret, redirect URL, webhook key) + finance-owner tenant authorization | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `XERO_WEBHOOK_KEY`, `XERO_MODE=live` | M5-live (finance) |
| 14 | Composio LinkedIn connection (authorize in-app) | — (uses #7) | M9 publish |
| 15 | Canva team access (Connect integration or via Composio) | — | M9 creative |
| 16 | Meta Business Manager invite + ad account IDs (read/report scopes only) | adapter config | M11 |
| 17 | Google Ads manager/customer IDs + read-only OAuth | adapter config | M11 |
| 18 | TikTok Business account IDs (optional, read-only) | adapter config | M11 |
| 19 | Sentry DSN (prod monitoring) | `SENTRY_DSN` | M12 hardening |
| 20 | Upstash Redis (if rate-limit/cache goes live) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | M12 |
| 21 | Transactional email / SMTP for portal magic links (+ SPF/DKIM/DMARC on hrmny.co) | Supabase Auth SMTP config | Portal go-live |
| 22 | Bayzat: full exports (no public API — CSV/XLSX path stays) | `BAYZAT_SOURCE=csv` | HR programme |
| 23 | Asana workspace access for developer@hrmny.co (export + OAuth/service token) | — | Work migration |
| 24 | Airtable PAT + base IDs (if retained as record system) | — | Work migration |
| 25 | Tejari/eSupply account access | `TEJARI_CREDENTIALS` | Gov-RFP lane |
| 26 | DocuSign account (e-signature, optional V1) | — | Onboarding |

Already set in prod (no action): Supabase URL/keys/`DATABASE_URL`, Google OAuth client, `CRON_SECRET`, DAM config.

## Email-ready request text

> Subject: hrmny OS — access needed to switch the AI layer live
>
> To go from demo-mode to live AI, I need the following. Please add each to the Keeper folder (never email the values) and tick them off:
>
> **This week (blocks everything):** 1) OpenRouter API key, 2) OpenAI API key, 3) Apollo API key, 4) Hunter account re-activated + verifier credits, 5) NeverBounce credits, 6) Composio workspace + API key with Gmail authorized, 7) Inngest keys, 8) add me to the developer@hrmny.co Vercel team + Supabase org (or issue me tokens), 9) n8n API key, 10) a fresh Google Chat webhook plus the Chat app service-account JSON added directly to Vercel, 11) the dedicated GBrain MCP URL plus its source-scoped projector token added directly to Vercel.
>
> **Before their milestones (2–8 weeks out):** Xero developer app + finance authorization; Composio LinkedIn + Canva connections; Meta/Google/TikTok ads read-only access; Sentry; transactional email/SMTP for the portal; Bayzat exports; Asana + Airtable access; Tejari access.
>
> Spend guardrail already coded: AED 1,500/month AI cap, human approval required on every external send.
