# Consolidated human-gate request

Stop here for credentials, provider accounts, permissions, spend, production changes, destructive actions, and external communication. **Do not send secret values back.** Store each value in Keeper `hrmny-os / production` (or Vercel env) and reply “done” with the row number.

Production app URL used below: `https://hrmny-os.vercel.app`

| # | Account / console | Scope | Callback / URL / reference | Why | Verification (no secrets) |
|---|-------------------|-------|----------------------------|-----|---------------------------|
| 1 | OpenRouter → Keys · workspace **A** (general) | Chat completions, free-route models only until spend approved | Env `OPENROUTER_API_KEY`, `OPENROUTER_WORKSPACE_ID`. Do **not** set `LLM_PROVIDER=openrouter` in this repo default; set only in Vercel after UAT. | Unlocks live agents | `/api/ready` shows `llmProvider` after the approved flip; one outreach-draft run + audit row |
| 2 | OpenRouter → workspace **B** (privileged) | Salaries / finance prompts only | `OPENROUTER_PRIVILEGED_API_KEY`, `OPENROUTER_PRIVILEGED_WORKSPACE_ID` | Separation of privileged data | Privileged key never appears on `/api/ready`; finance-assist uses it when enabled |
| 3 | OpenAI platform → API keys | Embeddings `text-embedding-3-small` only | `OPENAI_API_KEY` (or keep local hash until approved) | Semantic memory | `memory_chunk.embedding` non-null after backfill with provider live |
| 4 | Apollo → Settings → API | People match + company search, monthly credit cap | `APOLLO_API_KEY`, `APOLLO_MODE=live` | M8 sourcing | One people/match readback for a non-sensitive test email |
| 5 | Hunter → API · **re-provision + Email Verifier credits** | `email-verifier` | `HUNTER_API_KEY`, `HUNTER_MODE=live` | Verified-email payment gate | Known-good → `deliverable`; known-bad → not verified |
| 6 | NeverBounce → Custom Integration | `v4.2/single/check` credits | `NEVERBOUNCE_API_KEY`, `NEVERBOUNCE_MODE=live`, optional `EMAIL_VERIFICATION_PROVIDER=neverbounce` | Fallback verifier (no longer coupled to Hunter mode) | Same two-address readback |
| 7 | Composio → Settings → API keys + webhook subscription | Gmail connect (M8); later Canva/LinkedIn/Asana | `COMPOSIO_API_KEY`, `COMPOSIO_WEBHOOK_SECRET`. Webhook URL: `https://hrmny-os.vercel.app/api/webhooks/composio` | HITL send + trigger ack | Signed test delivery → health `composio_webhook`; Gmail connected in UI |
| 8 | Xero Developer → My Apps | **Read scopes only** | Redirect `https://hrmny-os.vercel.app/api/integrations/xero/callback`. Webhook `https://hrmny-os.vercel.app/api/webhooks/xero`. Env `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_WEBHOOK_KEY`, `XERO_MODE=live`. **Keep `XERO_WRITE_ENABLED=false`.** | Finance mirror | Intent to Receive = OK; `xero_invoice_mirror` rows increase; no OS invoice appears in Xero |
| 9 | Xero tenant | Finance-owner authorisation of the org | Tenant name + authorising person (names only) | Completes OAuth connections list | `/connections` returns a tenantId after callback |
| 10 | n8n Cloud `hrmny.app.n8n.cloud` | API + webhook secret | `N8N_API_KEY`, `N8N_WEBHOOK_SECRET`. Import `docs/automations/n8n/*.json` into **hrmny** tenant only | Automations | `automation.health` live; inbound lead pin-test |
| 11 | Google Chat space | Incoming webhook (rotate the leaked one) | `GOOGLE_CHAT_WEBHOOK_URL` | Health / cap alerts | One scheduled `health_signal` card appears |
| 12 | Vercel team `team_1JFUzpwQIfMIYzFhsmVaBatl` project `hrmny-os` | Member or team token for developer@hrmny.co | Add Ahmad’s MCP-connected account **or** issue a team token into Keeper (not chat) | Env + deploy control | `vercel ls` / MCP sees `hrmny-os` |
| 13 | Supabase org owning `klrugedztqxlvyghyzxs` | PAT or org invite | Dashboard Access Tokens | Migrations, advisors, logs | `list_tables` / advisors on the real project |
| 14 | Google Cloud OAuth client | Staff SSO + Workspace refresh | Already has prod callback; confirm `GOOGLE_OAUTH_CLIENT_ID/SECRET` in Vercel | Login | Dubai first-login UAT (M1 script) |
| 15 | Resend (or Supabase SMTP) + SPF/DKIM/DMARC on `hrmny.co` | Transactional mail | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_MODE=live` | Portal magic links + reports | One portal invite received |
| 16 | Inngest project | Event + signing keys | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Long AI jobs (optional; cron substitute exists) | Workflow appears in Inngest dashboard |
| 17 | Asana workspace | Export + Composio/Asana connect for `developer@hrmny.co` | Feature `asana.sync` | Work migration | Import dry-run counts match |
| 18 | Sentry project | Next.js DSN | `SENTRY_DSN` | Prod observability | One test event in Sentry |
| 19 | Upstash Redis | REST URL + token | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Cache / rate limits | `PONG` via REST |
| 20 | Meta / Google Ads (later) | **Read/report only** | Account IDs; no write scopes | M11 pacing | `analytics.adsInsights` live mode after approved scope |
| 21 | Ayham / Molham | Written M1 + Module-1 acceptance | — | Commercial closeout | Signed note; no production data in the reply |
| 22 | Archive duplicate Vercel projects | `hrmny-os-web`, `hrmny-sales-growth` on personal team | Owner OK required | Stop wrong-project deploys | Only `hrmny-os` receives production |

Rows 1–3, 8–9, 11–14, 21 are the blocking path for a truthful “production OS” claim. Rows 4–7, 10, 15 unlock CRM/AI differentiators. Rows 16–20 are milestone-specific.
