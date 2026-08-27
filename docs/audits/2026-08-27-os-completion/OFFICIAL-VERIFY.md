# Official documentation verification

Checked 2026-08-27 against current official docs and reciprocal GitHub repositories. “Match” means our adapter’s URL, auth, and signature scheme agree with the official contract. Live HTTP was not executed.

| Platform | Official docs | Reciprocal GitHub | Our implementation | Verdict |
|----------|---------------|-------------------|--------------------|---------|
| Xero OAuth + Accounting API | [OAuth 2.0](https://developer.xero.com/documentation/guides/oauth2/overview) · [Invoices](https://developer.xero.com/documentation/api/accounting/invoices) | [XeroAPI/xero-node](https://github.com/XeroAPI/xero-node) · [Xero-OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI) | `login.xero.com/identity/connect/authorize`, `identity.xero.com/connect/token`, `api.xero.com/connections`, `GET /api.xro/2.0/Invoices`. Scopes: `openid profile email accounting.transactions.read accounting.contacts.read offline_access`. Writes locked. | **Match (read).** Write POST deliberately unwired. |
| Xero webhooks | [Webhooks overview](https://developer.xero.com/documentation/guides/webhooks/overview/) | [xero-webhooks.yaml](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-webhooks.yaml) | `x-xero-signature` = Base64(HMAC-SHA256(raw body, webhook key)). 200 match / 401 mismatch, empty body. Empty `events` = Intent to Receive. | **Match.** Receiver added this run. |
| Hunter Email Verifier | [v2 email-verifier](https://hunter.io/api-documentation/v2#email-verifier) | [hunter-io](https://github.com/hunter-io) | `GET https://api.hunter.io/v2/email-verifier?email=&api_key=` | **Match.** |
| NeverBounce single check | [single-check](https://developers.neverbounce.com/reference/single-check) · [auth](https://developers.neverbounce.com/reference/authentication) | [NeverBounceApi-Node](https://github.com/NeverBounce/NeverBounceApi-Node) | Was `GET /v4/single/check`. Official current is **`/v4.2/single/check`** with `key` + `email`. | **Updated to v4.2.** Mode no longer depends on `HUNTER_MODE`. |
| Apollo people/companies | [People enrichment](https://docs.apollo.io/reference/people-enrichment) | [apolloio](https://github.com/apolloio) | We call `https://api.apollo.io/v1/people/match` + `mixed_companies/search` with `X-Api-Key`. Official current base is often `https://api.apollo.io/api/v1/...`. | **Source gap.** Legacy `/v1` still widely accepted; do not flip URL without a live key + readback. |
| Composio webhooks | [Webhook verification](https://docs.composio.dev/docs/webhook-verification) | [ComposioHQ/composio](https://github.com/ComposioHQ/composio) | `webhook-signature` = `v1,` + Base64(HMAC-SHA256(`id.timestamp.body`, secret)). 300s skew. | **Match.** Receiver added this run. |
| Composio SDK | [Toolkits](https://docs.composio.dev) | same repo | `@composio/core` 0.14.0 live client already in tree | **Match (library).** Key is a human gate. |
| n8n Cloud | [n8n API](https://docs.n8n.io/api/) · [webhooks](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/) | [n8n-io/n8n](https://github.com/n8n-io/n8n) | REST health/workflows + HMAC or shared-secret header. n8n has no single official HMAC scheme — our `sha256=` header is a documented convention. | **Match (convention).** Tenant import is a human gate. |
| Asana webhooks + REST | [Webhooks](https://developers.asana.com/docs/webhooks) | [Asana/node-asana](https://github.com/Asana/node-asana) | Existing HMAC + handshake in `asana-webhooks.ts` | **Match.** Live connection is a human gate. |
| Google Workspace OAuth | [OAuth 2.0](https://developers.google.com/identity/protocols/oauth2) | [googleapis](https://github.com/googleapis) | Native callback `/api/integrations/google-workspace/callback`; SSO via Supabase Google, `hd=hrmny.co` | **Match.** |
| Supabase Auth / Storage / Vault | [Auth](https://supabase.com/docs/guides/auth) | [supabase/supabase](https://github.com/supabase/supabase) | Publishable + secret keys; RLS lock-down; Vault for connection secrets | **Match.** Org token is a human gate. |
| Vercel | [Web services / env](https://vercel.com/docs) | [vercel/next.js](https://github.com/vercel/next.js) | `apps/web/vercel.json` region `sin1`; cron `/api/cron/jobs` | **Match.** Team token is a human gate. |
| OpenRouter | [API](https://openrouter.ai/docs) | [OpenRouterTeam](https://github.com/OpenRouterTeam) | Free-route allowlist; privileged key separate | **Match.** Default remains `mock`. |
| Resend | [Send email](https://resend.com/docs/api-reference/emails/send-email) | [resend/resend-node](https://github.com/resend/resend-node) | Mock/live adapter already in tree | **Match.** Key is a human gate. |
| Upstash Redis REST | [REST API](https://upstash.com/docs/redis/features/restapi) | [upstash/upstash-redis](https://github.com/upstash/upstash-redis) | `POST ["SCAN", cursor, "MATCH", glob, "COUNT", n]` then `DEL` | **Match.** Implemented this run. |
| Meta Ads Insights | [Insights](https://developers.facebook.com/docs/marketing-api/insights) | [facebook-nodejs-business-sdk](https://github.com/facebook/facebook-nodejs-business-sdk) | Read-only contract + mock. Live throws fail-loud. | **Contract only.** M11 human gate. |
| Google Ads | [API start](https://developers.google.com/google-ads/api/docs/start) | [google-ads-nodejs](https://github.com/googleads/google-ads-nodejs) | Same as Meta — mock / fail-loud live | **Contract only.** |
| Canva Connect | [Connect API](https://www.canva.com/developers/docs/connect/api-reference) | via Composio | Live path exists; stub fallback when disconnected | **Partial.** Needs Composio Canva account. |
| LinkedIn | via Composio; V1 remains human-sent | — | Publish adapter after HITL; copy-draft otherwise | **Partial by product rule.** |
| Sentry | [SDK](https://docs.sentry.io/platforms/javascript/guides/nextjs/) | [getsentry/sentry-javascript](https://github.com/getsentry/sentry-javascript) | `SENTRY_DSN` env only — no SDK | **Gap.** Do not add until DSN is issued. |
| Inngest | [docs](https://www.inngest.com/docs) | [inngest/inngest](https://github.com/inngest/inngest) | Package intentionally absent; cron substitutes daily lead-gen + reports | **Deferred.** Keys are a human gate. |
| Bayzat | No public API | — | CSV/XLSX mirror only | **Confirmed no API.** |

## Source gaps (do not silently “fix”)

1. Apollo official base path may be `/api/v1` vs our `/v1`. Keep current URL until a live key can read back.
2. n8n has no single official HMAC header — we document `X-Hrmny-N8n-Signature: sha256=<hex>` as the OS convention.
3. Hunter account was previously dead; credits are a commercial gate, not a code gate.
4. Execution-spec files (`hrmny_OS_Execution/11-N8N-SETUP.md`, agent “see also” paths) are not in this repo. n8n GET now points at `docs/automations/n8n/README.md`.
