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
| `discovery-public-news.json` | `POST /webhook/hrmny-discovery-public-news` | OS trigger only (no Schedule Trigger) → respond 202 → read pinned Campaign ME RSS → map `public_url` observations → sign HS256 JWT (`iss`/`aud`/`kid`/`bodyHash`) → POST exact raw body to `/api/integrations/discovery/callback` → completion. Stays **inactive**. |
| `discovery-callback-contract.json` | n/a | Signed callback/configuration authority for the Discovery workflow. Not a CRM `N8N_EVENT_MAP` entry. |
| `discovery-scheduler.json` | n/a | Inngest `sales/discovery.wake.v1` + `sales/discovery.interpret.v1` + repair `/api/cron/discovery`. Does not add a Vercel cron in-repo. |

All target URLs are n8n Variables, while secrets stay in tenant-owned encrypted credentials. The
exports contain placeholder credential IDs only; replace every placeholder with the matching hrmny
tenant credential before validation. No secret value is embedded in these files.

## Required environment variables (set in the hrmny tenant, not in a node)

Set these on the n8n instance (env / `.env` for self-hosted, **Variables** in n8n Cloud) before activating:

| Variable | Used by | Example |
|---|---|---|
| `HRMNY_OS_BASE_URL` | lead ingestion | `https://hrmny-os.vercel.app` |
| `HRMNY_N8N_WEBHOOK_SECRET` | lead ingestion (`X-Webhook-Secret` header the OS inbound route checks) | shared secret, matches the OS env |
| `N8N_OUTBOUND_WEBHOOK_SECRET` | reference only: matching value is stored in the n8n Header Auth credential on OS-triggered webhook nodes | matches the OS env; sent as `X-Hrmny-Os-Secret` |
| `GOOGLE_CHAT_WEBHOOK_URL` | ops alert fan-out + lead ingestion error path | `https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…` |
| `DISCOVERY_N8N_CALLBACK_KID` | Non-secret n8n Variable used as Discovery JWT `kid` | must exist in OS `DISCOVERY_N8N_CALLBACK_KEYS_JSON` |
| `HRMNY_OS_BASE_URL` | Discovery callbacks (same var as lead ingestion) | no trailing slash |

Discovery Header Auth on `Discovery Public-News Webhook` must match OS `DISCOVERY_N8N_TRIGGER_SECRET` (`X-Hrmny-Os-Secret`). Attach a scoped encrypted `jwtAuth` credential named `HRMNY Discovery callback signing` to both native JWT nodes; the secret must never be an n8n Variable or Code-node value. That is separate from the CRM `N8N_OUTBOUND_WEBHOOK_SECRET`. Do not add an n8n Schedule Trigger. Do not activate this workflow on import. `DISCOVERY_EXECUTION_ENABLED` stays unset/false until owner-gated live collection.

The public-news collector does not infer a company from a headline. It currently emits an empty
`companyHints` list, so the OS quarantines each observation as `COMPANY_IDENTITY_MISSING`. A later
collector revision must supply an explicit, evidenced company identity before an observation can
become a review candidate; do not substitute the article title as a company name.

## Import steps

1. In the hrmny tenant: **Workflows → Import from File** and select each JSON.
2. Set the variables above. The workflow exports are intentionally inactive and use placeholder
   tenant credential IDs. Before validation, create or select the scoped credentials:
   - on `Lead Inbound Webhook`, require the exact upstream header/value agreed with that lead source;
   - on `Ops Alert Webhook` (and every OS-triggered webhook), require header
     `X-Hrmny-Os-Secret` with the value matching the OS `N8N_OUTBOUND_WEBHOOK_SECRET` reference.
   - on `Discovery Public-News Webhook`, replace the Header Auth placeholder with the credential
     whose `X-Hrmny-Os-Secret` value matches OS `DISCOVERY_N8N_TRIGGER_SECRET`;
   - on both Discovery JWT nodes, replace the `jwtAuth` placeholder with the same scoped encrypted
     `HRMNY Discovery callback signing` credential and confirm its key matches the OS key selected
     by `DISCOVERY_N8N_CALLBACK_KID`.
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
5. Verify the imported Webhook nodes display Header Auth—not `None`—and that the selected credentials
   belong to the hrmny project. Verify the two Discovery signing nodes are native JWT nodes using
   the scoped `jwtAuth` credential. Keep Discovery inactive while `companyHints` remain unresolved.
   For the other OS→n8n calls, activate only after their existing approval and production-trigger
   gates pass. Do not activate any workflow on import.

## Validation evidence (staging tenant)

Both workflows passed `validate_workflow` and were executed with pinned trigger + HTTP data
(no live HTTP fired):

- **lead ingestion** — the older staging proof covered email routing only. The new stable-event-ID,
  Header Auth, and OS replay checks require a fresh pin-test in the client-owned tenant before activation.
  The `Notify Ops on Error` → Respond
  502 branch was not exercised (the forward node was pinned to success).
- **ops alert fan-out** — the Code node built the full `cardsV2` payload for real; Post to Google
  Chat (pinned) → **Respond 200 Sent**.
