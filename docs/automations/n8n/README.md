# n8n workflows — staging exports

Two external-event glue workflows for hrmny OS, authored and validated in a **staging** n8n
tenant (Ahmad's personal `ahmadbukhari.app.n8n.cloud`) because the real hrmny tenant
(`hrmny.app.n8n.cloud`) has no API key yet (CREDENTIALS-NEEDED.md Tier 3 #11). The JSON here
is the source of truth for the tenant import; the staging copies are named
`hrmny-STAGING — …` and are left **inactive**.

| File | Webhook path | Flow |
|---|---|---|
| `lead-source-webhook-ingestion.json` | `POST /webhook/hrmny-lead-inbound` | normalize lead → require email + stable upstream `eventId` (400) → forward to OS `/api/inbound/lead` with bridge secret + `Idempotency-Key` → 200; on forward error, notify ops via Google Chat → 502 |
| `ops-alert-fanout.json` | `POST /webhook/hrmny-ops-alert` | build a Google Chat `cardsV2` payload (severity/source/message/timestamp) → POST to the Chat webhook → 200 |

All target URLs and bridge-secret values are n8n environment expressions, so the export imports
cleanly without embedding a secret value. Webhook-node Header Auth credentials are deliberately
not assigned in the JSON because credential IDs are tenant-owned assets; both must be selected in
the client tenant before activation.

## Required environment variables (set in the hrmny tenant, not in a node)

Set these on the n8n instance (env / `.env` for self-hosted, **Variables** in n8n Cloud) before activating:

| Variable | Used by | Example |
|---|---|---|
| `HRMNY_OS_BASE_URL` | lead ingestion | `https://hrmny-os.vercel.app` |
| `HRMNY_N8N_WEBHOOK_SECRET` | lead ingestion (`X-Webhook-Secret` header the OS inbound route checks) | shared secret, matches the OS env |
| `N8N_OUTBOUND_WEBHOOK_SECRET` | reference only: matching value is stored in the n8n Header Auth credential on OS-triggered webhook nodes | matches the OS env; sent as `X-Hrmny-Os-Secret` |
| `GOOGLE_CHAT_WEBHOOK_URL` | ops alert fan-out + lead ingestion error path | `https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…` |

## Import steps

1. In the hrmny tenant: **Workflows → Import from File** and select each JSON.
2. Set the variables above. Both exports are intentionally inactive and have no tenant credential
   IDs. Before activation, create and select two scoped n8n **Header Auth** credentials:
   - on `Lead Inbound Webhook`, require the exact upstream header/value agreed with that lead source;
   - on `Ops Alert Webhook` (and every OS-triggered webhook), require header
     `X-Hrmny-Os-Secret` with the value matching the OS `N8N_OUTBOUND_WEBHOOK_SECRET` reference.
   Do not leave either production trigger at `authentication: none`. n8n→OS auth is separate:
   `Forward to hrmny OS` sends `X-Webhook-Secret`, and the stable upstream `eventId` is forwarded as
   `Idempotency-Key`. Google Chat auth remains inside its separately scoped webhook URL.
3. Rename to drop the `hrmny-STAGING — ` prefix if desired.
4. **Pin-test in-tenant first.** Open each workflow, pin sample data on the webhook trigger
   (and on the HTTP Request nodes to avoid live outbound calls), and run once. Confirm the
   lead workflow routes a payload with an email and stable `eventId` to **Respond 200 Accepted**;
   one missing either field must reach **Respond 400 Missing Required Fields**. Confirm that replaying
   the same `eventId` returns the original OS `dealId`. The ops workflow reaches **Respond 200 Sent** with a fully
   built card.
5. Verify the imported Webhook nodes display Header Auth—not `None`—and that the selected credential
   belongs to the hrmny project. **Only then request activation approval** and, for OS→n8n calls,
   flip `N8N_ALLOW_PRODUCTION_TRIGGER`. Do not activate on import.

## Validation evidence (staging tenant)

Both workflows passed `validate_workflow` and were executed with pinned trigger + HTTP data
(no live HTTP fired):

- **lead ingestion** — the older staging proof covered email routing only. The new stable-event-ID,
  Header Auth, and OS replay checks require a fresh pin-test in the client-owned tenant before activation.
  The `Notify Ops on Error` → Respond
  502 branch was not exercised (the forward node was pinned to success).
- **ops alert fan-out** — the Code node built the full `cardsV2` payload for real; Post to Google
  Chat (pinned) → **Respond 200 Sent**.
