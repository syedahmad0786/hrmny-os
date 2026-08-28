# HRMNY two-sided bridge contracts

Each contract names both interfaces, authority, exact operation, identity, idempotency, reconciliation, and stop boundary. Secret names are references only.

## 1. Xero Accounting → HRMNY finance mirror

| Contract field        | Evidence-backed design                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authority             | Xero remains accounting/payment authority. Supabase PostgreSQL owns the HRMNY mirror and OS workflow state.                                                                                                          |
| Source interface      | OAuth 2.0; `GET /connections`; `GET /api.xro/2.0/Invoices`; signed invoice webhooks.                                                                                                                                 |
| Destination interface | `POST /api/webhooks/xero` → `integration_inbox`; scheduled `syncXeroInvoiceMirror()` → `xero_invoice_mirror`; linked OS invoice status reconciliation.                                                               |
| Callback/webhook      | `/api/integrations/xero/callback`; `/api/webhooks/xero`.                                                                                                                                                             |
| Identity/scopes       | Explicit finance-owned tenant; `openid profile email accounting.transactions.read accounting.contacts.read offline_access`. Multiple connections require exact `XERO_TENANT_ID`; first-tenant guessing is forbidden. |
| Auth refs             | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, dedicated `XERO_OAUTH_STATE_SECRET`, `XERO_WEBHOOK_KEY`, optional `XERO_TENANT_ID`.                                                                                          |
| Event safety          | Base64 HMAC-SHA256 over raw body. Intent-to-Receive is acknowledged independently of database availability. Non-empty envelopes must be durably recorded before 200; failure returns 503.                            |
| Idempotency           | Webhook envelope SHA-256; `xero_invoice_mirror.external_id`; OS invoice link by `xero_invoice_id`.                                                                                                                   |
| Reconciliation        | Scheduled canonical invoice read. An OS invoice moves `issued → paid` only when the linked Xero mirror says `PAID`; the prior simulated paid mutation was removed.                                                   |
| Effects               | Xero writes and disbursement remain disabled. `XERO_WRITE_ENABLED=false` is a product lock, not a missing key.                                                                                                       |
| Acceptance            | Xero Intent-to-Receive OK; explicit tenant selected; mirror rows read back; linked payment state converges; audit receipt retained; no Xero object created by HRMNY.                                                 |

## 2. Google Workspace ↔ HRMNY staff connection

| Contract field        | Evidence-backed design                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authority             | Google owns Gmail, Calendar, Drive, and the connected identity. HRMNY owns per-employee connection metadata and encrypted token reference.                                              |
| Source interface      | Google OAuth authorization code and refresh-token endpoints; Gmail/Calendar/Drive REST operations already represented by the connection layer.                                          |
| Destination interface | `/api/integrations/google-workspace/callback` → one employee/toolkit `connection_account`; Connections probe performs canonical read.                                                   |
| Scopes                | `openid email profile`, `gmail.readonly`, `gmail.send`, `calendar.events.readonly`, `drive.file`, `drive.readonly`. Broad Gmail modify, Calendar write, and Sheets scopes were removed. |
| Auth refs             | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, dedicated `GOOGLE_OAUTH_STATE_SECRET` of at least 32 characters. No fallback to JWT, cron, or Xero secrets.                     |
| Identity              | Verified `@hrmny.co` account bound to the initiating employee and signed 15-minute state containing the exact redirect URI.                                                             |
| Idempotency/recovery  | One connection per employee/toolkit; refresh on probe; reconnect after invalid grant; disconnect and revoke at Google.                                                                  |
| Acceptance            | OAuth consent/review for restricted Gmail scopes; exact callback registered; connection probe succeeds; one read and approval-gated send exercised by the intended employee.            |

## 3. n8n → HRMNY inbound events

| Contract field | Evidence-backed design                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | Inactive client-owned n8n workflow with a stable upstream event ID.                                                                                         |
| Destination    | `POST /api/inbound/lead` or `POST /api/webhooks/n8n`; durable CRM create or generic `integration_inbox` receipt.                                            |
| Auth           | `N8N_WEBHOOK_SECRET` via `X-Webhook-Secret` or HMAC in `X-Hrmny-N8n-Signature` / `X-N8n-Signature`. There is no cron-secret fallback.                       |
| Idempotency    | `Idempotency-Key`, event ID, execution ID, or webhook ID is mandatory. Same ID/same payload replays; same ID/different payload returns 409.                 |
| Mapping        | `company + email` → CRM company/contact/deal with `leadSourceLane=inbound`; generic events are acknowledged as no-side-effect receipts.                     |
| Failure        | Invalid auth 401/503; invalid data 400; conflict 409; undurable receipt 503; n8n retry/error branch owns replay.                                            |
| Acceptance     | Import inactive, attach an upstream Header Auth credential, pin-test success/invalid/replay/conflict paths, then verify CRM and receipt rows independently. |

## 4. HRMNY → n8n bounded trigger

| Contract field | Evidence-backed design                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source         | HRMNY `N8N_EVENT_MAP` proposal and approved payload.                                                                                                         |
| Destination    | Exact n8n webhook path or declared `N8N_WEBHOOK_*` URL.                                                                                                      |
| Auth           | Dedicated `N8N_OUTBOUND_WEBHOOK_SECRET` sent as `X-Hrmny-Os-Secret`; the n8n Webhook node must use matching Header Auth. This is separate from inbound auth. |
| Gates          | A real POST requires `N8N_ALLOW_PRODUCTION_TRIGGER=true` or explicit per-call approval. Real mode requires `N8N_API_KEY`; missing key fails loudly.          |
| Readback       | HTTP response/execution ID, then `GET /api/v1/executions/{id}` when available; downstream destination verification remains separate.                         |
| Recovery       | Disable the workflow/flag, revoke key, rotate Header Auth, replay only the retained idempotent event.                                                        |

## 5. Composio triggers → HRMNY integration inbox

| Contract field | Evidence-backed design                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source         | Current Composio webhook subscription using `webhook-id`, `webhook-timestamp`, `webhook-signature`.                                                                |
| Destination    | `POST /api/webhooks/composio` → durable `integration_inbox` receipt, then health/audit metadata. No tool is executed from the webhook.                             |
| Verification   | `v1,` + Base64 HMAC-SHA256 over `{id}.{timestamp}.{rawBody}`, with 300-second tolerance.                                                                           |
| Idempotency    | `webhook-id` plus payload hash; replay is acknowledged, conflicting reuse returns 409, unavailable durability returns 503.                                         |
| Reverse path   | Existing Composio connection/tool layer remains user-scoped and allowlisted; a connected account does not grant blanket execution.                                 |
| Acceptance     | Exact project, environment, auth config, stable user binding, ACTIVE connection, subscription, signed test delivery, receipt readback, and reconciliation receipt. |

## 6. Apollo → CRM sourcing

| Contract field                     | Evidence-backed design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source side A — discovery          | Official `POST https://api.apollo.io/api/v1/mixed_people/api_search`. HRMNY maps the visible Job title to `person_titles`, the fixed UAE market to `person_locations`, enables similar documented title matches, and sends only an optional company/industry phrase through `q_keywords`. The adapter refuses the undocumented `organization_industries` field rather than inventing a mapping. Apollo documents the operation as 0 credits, returns `id`, `first_name`, `last_name_obfuscated`, title, and limited organization data, and states that it does not return email or phone data. |
| Source side B — one approved match | Official `POST https://api.apollo.io/api/v1/people/match` using the Apollo person ID and supported identity fields. `reveal_personal_emails=false`, `reveal_phone_number=false`, `run_waterfall_email=false`, and `run_waterfall_phone=false` are always sent. This bounds the call to the base business-profile/email lookup rather than the higher-cost phone/personal-email paths.                                                                                                                                                                                                          |
| Destination                        | Typed Apollo person → one normalized CRM company/contact/open deal. Company dedupes by domain/name, contact by business email/LinkedIn/name+company, and deal by open company opportunity. No guessed `hello@domain` address and no second verification provider are used.                                                                                                                                                                                                                                                                                                                     |
| Authority                          | Apollo owns its professional profile and credit accounting. Supabase PostgreSQL owns HRMNY CRM state, the credit ledger, and the integration receipt. A configured key is connection evidence, not blanket paid-operation authority.                                                                                                                                                                                                                                                                                                                                                           |
| Idempotency source gap             | Apollo's People Enrichment reference does not document a request idempotency key. HRMNY therefore claims fixed receipt `sales-growth-one-person-enrichment-v1` before the provider call. Same-payload completed replays return the prior CRM result; different-payload reuse and processing/failed states stop for reconciliation. An uncertain attempt is never retried automatically.                                                                                                                                                                                                        |
| Billing boundary                   | Ordinary provider adapters still require `APOLLO_ALLOW_PAID_OPERATIONS=true`. The dedicated canary bypasses that global flag only after `confirmCreditUse=true`, for this fixed one-shot receipt. A successful or uncertain provider attempt is conservatively recorded as one `apollo_contact` credit. No other paid provider call is enabled.                                                                                                                                                                                                                                                |
| Readback/reconciliation            | Provider response → CRM IDs → CRM note with receipt ID and paid-field flags → completed inbox result → status query. Production acceptance separately checks the Apollo response, one ledger entry, CRM company/contact/deal, and replay behavior.                                                                                                                                                                                                                                                                                                                                             |
| Recovery                           | A failed/uncertain receipt remains locked. Reconcile Apollo usage and CRM destination state by receipt/person ID before any future adapter version or manually approved retry. Do not delete the receipt to regain the allowance.                                                                                                                                                                                                                                                                                                                                                              |
| Acceptance                         | Free search returns real candidates; exactly one People Match is accepted; no phone/personal/waterfall data is requested; one credit at most is recorded; destination objects read back; the fixed allowance cannot enrich another candidate; no outreach is sent.                                                                                                                                                                                                                                                                                                                             |

## 7. Hunter or NeverBounce → verified-email gate

| Contract field   | Hunter                                                                                                                                              | NeverBounce                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Source operation | `GET https://api.hunter.io/v2/email-verifier`                                                                                                       | `GET https://api.neverbounce.com/v4/single/check`                     |
| Activation       | `HUNTER_MODE=live`                                                                                                                                  | `NEVERBOUNCE_MODE=live` and `EMAIL_VERIFICATION_PROVIDER=neverbounce` |
| Billing gate     | `HUNTER_ALLOW_PAID_OPERATIONS=true`                                                                                                                 | `NEVERBOUNCE_ALLOW_PAID_OPERATIONS=true`                              |
| Destination      | Canonical verification result; only explicit deliverable/valid state sets `emailVerified=true`. Unknown/accept-all never invents a positive result. |
| Acceptance       | Known deliverable and known invalid synthetic addresses, provider response receipt, credit delta, CRM gate readback.                                |

## 8. Resend → transactional email destination

| Contract field | Evidence-backed design                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | HRMNY portal invite or scheduled report after its application gate.                                                                                                                                     |
| Destination    | Resend `POST /emails` and recipient mailbox.                                                                                                                                                            |
| Auth refs      | `RESEND_API_KEY`, verified `RESEND_FROM`, explicit `RESEND_MODE=live`.                                                                                                                                  |
| Idempotency    | Every live send requires `Idempotency-Key`; portal invites hash the token and reports use stable schedule/date keys. Same key with different payload is rejected in mock and must never be reused live. |
| Acceptance     | Domain/SPF/DKIM/DMARC verified, API accepted, email received in intended mailbox, link/session isolated, audit receipt retained.                                                                        |

## 9. Embedding provider → governed memory

| Contract field | Evidence-backed design                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | OpenAI `POST /v1/embeddings` or OpenRouter `POST /api/v1/embeddings`, selected explicitly by `EMBEDDING_PROVIDER`.                                                                                   |
| Destination    | `memory_chunk.embedding` with source, audience, and entity scope preserved.                                                                                                                          |
| Safety         | `none` produces no embedding; `local` requires explicit development permission; live provider failure does not silently become a hash vector. Unscoped memory search throws `MEMORY_SCOPE_REQUIRED`. |
| Auth refs      | Provider-specific key and model; spend cap/retention approval.                                                                                                                                       |
| Acceptance     | One synthetic scoped chunk embedded, scoped query returns it, cross-scope query does not, provider usage receipt and deletion/rebuild path verified.                                                 |

## 10. Inngest → HRMNY durable jobs

| Contract field | Evidence-backed design                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | Inngest cron triggers for daily lead generation and report-scheduler ticks.                                                                   |
| Destination    | Official Next.js handler at `/api/inngest`, registered functions, existing idempotent job bodies.                                             |
| Auth refs      | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.                                                                                                   |
| Fallback       | Signed `/api/cron/jobs` continues those jobs until both keys exist; when both exist, the fallback skips them to prevent duplicate schedulers. |
| Reliability    | Two retries plus existing claims/idempotency keys; provider execution and final email/CRM state must be verified separately.                  |

## 11. HRMNY → Sentry telemetry

| Contract field | Evidence-backed design                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source         | Next.js server instrumentation, browser instrumentation, and global error boundary.                                                                    |
| Destination    | Exact Sentry SaaS project selected by HRMNY.                                                                                                           |
| Safety         | SDK is inert without DSN; PII, traces, and replay are disabled by default in this slice. Runtime DSNs and release-upload credentials are separate.     |
| Auth refs      | `SENTRY_DSN`, optional public DSN, and—only for deployment source maps—scoped `SENTRY_AUTH_TOKEN`, organization, and project references.               |
| Acceptance     | Synthetic handled error appears with expected environment/release and no client payload/credential; source-map mapping separately verified if enabled. |

## 12. Bayzat → payroll mirror source gap

Current official Bayzat public material did not establish an employee-list API operation, authentication contract, or official GitHub implementation source. The bounded adapter therefore supports approved CSV input only. `BAYZAT_SOURCE=api` always fails with `UNVERIFIED_INTERFACE`; an API key alone cannot activate a guessed endpoint. To replace CSV, the tenant must supply an official contract or provider-confirmed operation, after which both schemas, pagination, identity, reconciliation, and revocation must be reviewed.

## 13. Asana → native Work migration

Asana remains an import/reconciliation source during cutover; native Work becomes the operational authority only after approved count/hash comparison and user sign-off. Existing REST/webhook interfaces require exact workspace/project/resource GIDs, user-scoped authorization, raw-body handshake/signature validation, deduplication, fresh provider reads, and bounded reconciliation. No Asana write or subscription was performed in this run.

## 14. Ads platforms → read-only analytics

Meta and Google Ads adapters expose read/report contracts only. Live mode fails loudly until exact account IDs, read scopes, plan eligibility, and test assets are approved. No budget, campaign, audience, or conversion write exists in this completion slice.
