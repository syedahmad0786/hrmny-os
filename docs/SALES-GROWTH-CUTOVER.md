# Sales Growth operating contract

**Canonical surface:** HRMNY OS (`/crm/hunt`, `/crm/research`, `/crm`, `/crm/outreach`)
**System of record:** Supabase PostgreSQL
**Rule:** AI and providers propose evidence; a person approves every paid lookup and outbound action.

This replaces the operator-facing Claude/Vercel prototype with a single CRM loop:

`Signal → Research → Person → Outreach → Pipeline → Learn → next signal`

The detailed company/contact/deal/admin objects remain available under the CRM **More** menu. Synthetic demo controls are collapsed and clearly labeled. Automated proof records are hidden from ordinary Chat views without being deleted.

## Daily operating loop

| Step     | HRMNY surface                 | Definition of done                                                                                                           |
| -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Signal   | Sales Growth / Inbound        | A real company moment, role, market, or warm introduction is captured with source evidence.                                  |
| Research | Research gates                | Company fit and timing are reviewed at Gate 1. Reject/rework remains explicit.                                               |
| Person   | Apollo free search / Contacts | People Search returns reviewable candidates at 0 credits. One decision-maker is chosen; enrichment is separately approved.   |
| Outreach | Outreach                      | A company-specific email/LinkedIn draft is approved or returned for rework. Nothing auto-sends.                              |
| Pipeline | Pipeline                      | The deal has one owner, current stage, and next action. Closed and automated synthetic deals do not inflate the Sales badge. |
| Learn    | Sales Growth settings         | Weekly changes are proposed from outcomes and require a separate Apply action.                                               |

## Apollo two-sided contract

### Free discovery

- Operation: `POST https://api.apollo.io/api/v1/mixed_people/api_search`.
- Apollo documents People API Search as 0 credits and says it does not return email or phone data.
- HRMNY sends the visible Job title as `person_titles`, fixes the market to `person_locations=["United Arab Emirates"]`, enables similar title matches, and sends the optional company/industry phrase only as documented `q_keywords`. It bounds results to 10, returns normalized fields to the browser, and does not write CRM state.
- The current People Search reference does not document `organization_industries`; the Apollo adapter refuses that unsupported mapping instead of guessing a vendor field.

### One approved connection proof

- Operation: `POST https://api.apollo.io/api/v1/people/match`.
- The request uses the Apollo person ID and available identity fields.
- `reveal_personal_emails=false`, `reveal_phone_number=false`, `run_waterfall_email=false`, and `run_waterfall_phone=false` are mandatory.
- The owner authorized exactly one enrichment. A fixed `integration_inbox` receipt is claimed before the call, so another candidate or uncertain retry is blocked.
- Apollo does not document a request idempotency key for this operation. A failed/uncertain receipt therefore requires provider-usage and CRM reconciliation, never automatic replay.
- A successful match dedupes/reuses one company, contact, and open deal. It never invents `hello@domain` and never calls Hunter/NeverBounce.
- One conservative `apollo_contact` credit is recorded after a provider attempt. The global Apollo paid-operation flag stays false.

## Outreach boundary

- Email remains two steps: **Approve draft** then an independently authorized Gmail send.
- LinkedIn remains copy/open/mark-sent assistance. Do not connect browser automation, unofficial MCP senders, sequences, or autonomous outreach.
- Suppression, unsubscribe, no-go sectors, and the global pause switch apply before any send.
- This release does not authorize an email, LinkedIn message, campaign, invoice, publication, or ad spend.

## Data clarity

- Known `E2E`, `Live Proof`, `Closed Loop`, `Demo Funnel`, `Handover Smoke`, and similar automated records remain in the database for audit and regression testing.
- Chat filters those records and generated proof agents by default, reports how many are hidden, and offers **Show test records** for operators.
- No cleanup control in Sales Growth deletes production data. Any archive/delete action requires an exact inventory and separate approval.

## Legacy cutover

1. HRMNY OS is the only destination for new research, contact review, outreach drafts, and pipeline movement.
2. Historical Sales Growth JSON/CSV imports run in dry-run mode first and preserve lineage for replay-safe application.
3. Asana “Lead Pipeline 2026” and spreadsheet trackers are not deal systems of record. Asana can remain a bounded import/reconciliation source until signed off.
4. Legacy Vercel/Claude assets are not deleted by this release. Archive decisions need exact asset IDs and separate destructive approval.

## Production acceptance

Accept each state separately:

1. **Code:** lint, typecheck, unit/contract tests, and production build pass at one SHA.
2. **Migration:** additive receipt schema is present; journal/index/RLS/grants read back.
3. **Deployment:** production resolves to the exact merged SHA and `/api/ready` is healthy.
4. **Free provider read:** live Apollo search returns plausible UAE professional candidates and explicitly reports 0 credits.
5. **One paid provider call:** exactly one People Match is accepted with all four paid-field flags false.
6. **Destination:** one receipt, one conservative credit entry, and one reconciled CRM company/contact/deal read back.
7. **Replay/reconciliation:** same candidate returns the prior result without another call; another candidate is blocked; uncertain state stops for review.
8. **Recovery:** previous deployment is identified; receipt-based reconciliation and forward-fix paths are documented; no destructive rollback is assumed.
9. **UX:** the Sales Growth loop, primary nav, compact settings, and default-hidden Chat test records pass authenticated desktop and narrow-viewport checks.
10. **User acceptance:** Ayham/Maolham approval is recorded separately; a green deployment is not inferred as client acceptance.

Official evidence: [Apollo People API Search](https://docs.apollo.io/reference/people-api-search), [Apollo People Enrichment](https://docs.apollo.io/reference/people-enrichment), and the [Apollo REST OpenAPI](https://docs.apollo.io/openapi/apollo-rest-api.json).
