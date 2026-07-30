# n8n workflows — staging exports

Two external-event glue workflows for hrmny OS, authored and validated in a **staging** n8n
tenant (Ahmad's personal `ahmadbukhari.app.n8n.cloud`) because the real hrmny tenant
(`hrmny.app.n8n.cloud`) has no API key yet (CREDENTIALS-NEEDED.md Tier 3 #11). The JSON here
is the source of truth for the tenant import; the staging copies are named
`hrmny-STAGING — …` and are left **inactive**.

| File | Webhook path | Flow |
|---|---|---|
| `lead-source-webhook-ingestion.json` | `POST /webhook/hrmny-lead-inbound` | normalize lead → reject if no email (400) → forward to OS `/api/inbound/lead` with `X-Webhook-Secret` → 200; on forward error, notify ops via Google Chat → 502 |
| `ops-alert-fanout.json` | `POST /webhook/hrmny-ops-alert` | build a Google Chat `cardsV2` payload (severity/source/message/timestamp) → POST to the Chat webhook → 200 |

All target URLs and secrets are n8n environment expressions, so the export imports cleanly
into any tenant without editing nodes. Nothing is hard-coded and no credentials are referenced.

## Required environment variables (set in the hrmny tenant, not in a node)

Set these on the n8n instance (env / `.env` for self-hosted, **Variables** in n8n Cloud) before activating:

| Variable | Used by | Example |
|---|---|---|
| `HRMNY_OS_BASE_URL` | lead ingestion | `https://hrmny-os.vercel.app` |
| `HRMNY_N8N_WEBHOOK_SECRET` | lead ingestion (`X-Webhook-Secret` header the OS inbound route checks) | shared secret, matches the OS env |
| `GOOGLE_CHAT_WEBHOOK_URL` | ops alert fan-out + lead ingestion error path | `https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…` |

## Import steps

1. In the hrmny tenant: **Workflows → Import from File** and select each JSON.
2. Set the three environment variables above. **Connect nothing else** — these workflows use no
   n8n credentials; auth to the OS is the `X-Webhook-Secret` header, and Google Chat auth is baked
   into the webhook URL.
3. Rename to drop the `hrmny-STAGING — ` prefix if desired.
4. **Pin-test in-tenant first.** Open each workflow, pin sample data on the webhook trigger
   (and on the HTTP Request nodes to avoid live outbound calls), and run once. Confirm the
   lead workflow routes a payload with an email to **Respond 200 Accepted** and one without to
   **Respond 400 Missing Email**, and the ops workflow reaches **Respond 200 Sent** with a fully
   built card.
5. **Only then activate** (and flip `N8N_ALLOW_PRODUCTION_TRIGGER`). Do not activate on import.

## Validation evidence (staging tenant)

Both workflows passed `validate_workflow` and were executed with pinned trigger + HTTP data
(no live HTTP fired):

- **lead ingestion** — happy path (email present) executed Normalize Lead → Has Email? (true) →
  Forward to hrmny OS (pinned) → **Respond 200 Accepted**; missing-email run executed Normalize
  Lead → Has Email? (false) → **Respond 400 Missing Email**. The `Notify Ops on Error` → Respond
  502 branch was not exercised (the forward node was pinned to success).
- **ops alert fan-out** — the Code node built the full `cardsV2` payload for real; Post to Google
  Chat (pinned) → **Respond 200 Sent**.
