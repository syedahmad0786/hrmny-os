# Two-sided bridges

Every connection is specified as source operation → destination operation. Secrets are referenced by env name only.

## 1. Xero read / mirror

| Side | Detail |
|------|--------|
| Account owner | hrmny finance owner (unnamed) authorises tenant; app owned under developer@hrmny.co Xero app |
| Source | Xero Accounting API `GET /Invoices` + webhook `INVOICE/*` |
| Destination | OS `xero_invoice_mirror` via `syncXeroInvoiceMirror()` |
| OAuth callback | Prod `https://hrmny-os.vercel.app/api/integrations/xero/callback` · local `http://localhost:3000/api/integrations/xero/callback` |
| Webhook URL | `https://hrmny-os.vercel.app/api/webhooks/xero` |
| Scopes | `openid profile email accounting.transactions.read accounting.contacts.read offline_access` |
| Secret refs | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_WEBHOOK_KEY` → Vercel + Vault (`connection_account`) |
| Idempotency | `external_id` upsert; webhook ITR is signature-only |
| Retries | Cron sweeper once/day; webhook triggers an extra sync |
| Readback | `listInvoices` after OAuth; `/api/ready` `tools.xero` |
| Reconciliation | Daily `xero_mirror_sync` health signal + row count |
| Revocation | Disconnect in Connections UI; delete Xero app consent; rotate webhook key |
| Verification | Intent to Receive status **OK** in Xero developer portal; OS health signal `xero_webhook` |
| Constraint | `XERO_WRITE_ENABLED=false` — no invoice/journal POST, no disbursement |

## 2. Google Workspace (mail / calendar / drive)

| Side | Detail |
|------|--------|
| Account owner | Each `@hrmny.co` staff member; SSO client owned by developer@hrmny.co |
| Source | Google OAuth authorization code |
| Destination | Vault token + Connections `probeGoogleWorkspace` |
| Callback | `https://hrmny-os.vercel.app/api/integrations/google-workspace/callback` |
| Scopes | gmail / calendar / drive / sheets as requested by Connections |
| Secret refs | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_STATE_SECRET` |
| Idempotency | One `connection_account` per employee + toolkit |
| Retries | Token refresh on probe |
| Revocation | Connections disconnect; Google Account → third-party access |
| Verification | Connections probe returns connected; first-login UAT |

## 3. n8n → OS inbound lead

| Side | Detail |
|------|--------|
| Account owner | hrmny n8n Cloud (`hrmny.app.n8n.cloud`) — not a personal tenant |
| Source | n8n workflow `lead-source-webhook-ingestion` POST |
| Destination | `POST /api/inbound/lead` → `leads.inbound.create` |
| Auth | `X-Webhook-Secret` or `X-Hrmny-N8n-Signature: sha256=<hex>` |
| Secret refs | `N8N_WEBHOOK_SECRET` / `HRMNY_N8N_WEBHOOK_SECRET` |
| Callback the other way | OS `automation.trigger` → n8n webhook path (HITL, `N8N_ALLOW_PRODUCTION_TRIGGER=false`) |
| Idempotency | CRM create is insert; callers should send a stable email+company |
| Retries | n8n workflow retry; OS returns 4xx/5xx for n8n error branch |
| Verification | Pin-test in hrmny tenant; inbound deal appears in CRM |

## 4. Composio triggers → OS

| Side | Detail |
|------|--------|
| Account owner | Composio workspace (unprovisioned) |
| Source | Composio webhook subscription |
| Destination | `POST /api/webhooks/composio` (ack + audit only) |
| Headers | `webhook-id`, `webhook-timestamp`, `webhook-signature` |
| Secret ref | `COMPOSIO_WEBHOOK_SECRET` |
| Reverse | OS `createComposioLive` authorize / execute allowlisted read tools |
| Idempotency | `webhook-id` |
| Verification | Signed test delivery → health signal `composio_webhook` |

## 5. Asana → native Work

| Side | Detail |
|------|--------|
| Source | Asana REST + webhooks via Composio or PAT |
| Destination | Work tables + `asana_sync` job + `/api/asana/webhooks/[token]` |
| Reverse | Import/reconcile only during cutover; Work is source of record after |
| Secret refs | `COMPOSIO_API_KEY` + connected Asana account |
| Verification | `asana.sync` feature on + verified connection; webhook handshake |

## 6. Apollo / Hunter / NeverBounce → CRM

| Side | Detail |
|------|--------|
| Source | Apollo people/company search; Hunter or NeverBounce verify |
| Destination | Lead-gen pipeline + verified-email gate (payment trigger) |
| Modes | `APOLLO_MODE`, `HUNTER_MODE`, `NEVERBOUNCE_MODE` independently |
| Provider pick | `EMAIL_VERIFICATION_PROVIDER=hunter\|neverbounce` |
| Secret refs | `APOLLO_API_KEY`, `HUNTER_API_KEY`, `NEVERBOUNCE_API_KEY` (or Vault) |
| Never invents | Unknown / accept_all stays unverified |
| Verification | One known-good and one known-bad address; audit row |

## 7. OpenRouter / embeddings → agents + memory

| Side | Detail |
|------|--------|
| Source | OpenRouter chat + embeddings (or local hash when `LLM_PROVIDER=mock`) |
| Destination | Agent runs, chat, `memory_chunk.embedding` |
| Secret refs | `OPENROUTER_API_KEY`, `OPENROUTER_PRIVILEGED_API_KEY`, optional `OPENAI_API_KEY` |
| Cap | `LLM_MONTHLY_CAP_AED=1500` |
| Backfill | Cron `memory_embed_backfill` uses local vectors while provider is mock |
| Verification | `/api/ready` `llmProvider` + one agent run after Phase 0 approval |

## 8. Cron / GitHub Actions → jobs

| Side | Detail |
|------|--------|
| Source | `.github/workflows/scheduler.yml` every 5 minutes + Vercel daily cron |
| Destination | `GET /api/cron/jobs` Bearer `CRON_SECRET` |
| Sweepers | work webhooks, AI cleanup, reports, CRM digest, lead-gen, Xero mirror, competitor scan, retainer drafts, memory embed |
| Failure | `job_lag` + Google Chat when webhook configured |
| Secret ref | `CRON_SECRET` / GitHub `HRMNY_CRON_SECRET` |

## 9. Portal magic link

| Side | Detail |
|------|--------|
| Source | Staff invite → Resend / SMTP |
| Destination | `/portal/login/verify` + `portal_session_grant` |
| Allowlist | convention `portal.allowed_contacts` |
| Isolation | `portalStaffBoundary` + StaffShell redirect |
| Secret refs | Supabase Auth + `RESEND_API_KEY` / `RESEND_FROM` |

## 10. Ads insights (read-only, mock)

| Side | Detail |
|------|--------|
| Source | Meta Insights / Google Ads (future) |
| Destination | `analytics.adsInsights` |
| Live | Fail-loud until M11 tokens approved |
| Writes | None — no budget mutation method on the adapter |
