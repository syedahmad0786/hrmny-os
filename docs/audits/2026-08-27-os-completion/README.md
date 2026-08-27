# Harmony HRMNY OS — 2026-08-27 completion audit

The Windows `system_harness` repo (`platform-capability-graph`) is not present in this cloud environment. This folder is the equivalent run: discover the live repo, verify each platform against official docs + GitHub, close every safe local gap, and stop at human gates.

**Repo HEAD at start:** `b697fb0` on `main` (`syedahmad0786/hrmny-os`).  
**Safety locks preserved:** `XERO_WRITE_ENABLED=false`, `LLM_PROVIDER=mock`, `DAM_STORAGE=memory`.

| Artifact | What it is |
|----------|------------|
| [OFFICIAL-VERIFY.md](./OFFICIAL-VERIFY.md) | Provider docs + reciprocal GitHub checked against our adapters |
| [BRIDGES.md](./BRIDGES.md) | Two-sided source → destination contracts |
| [HUMAN-GATES.md](./HUMAN-GATES.md) | One consolidated request (no secret values) |
| [DECISIONS.md](./DECISIONS.md) | Decisions, tradeoffs, source gaps, workarounds |
| [SCORES.md](./SCORES.md) | Plan-readiness and delivery-evidence scores |
| [harness-result.json](./harness-result.json) | Machine-readable harness equivalent |

## What this run implemented locally

- Hunter / NeverBounce mode decoupling (`NEVERBOUNCE_MODE`, `EMAIL_VERIFICATION_PROVIDER`)
- Official NeverBounce path `GET /v4.2/single/check`
- Read-only `AdsInsightsAdapter` mock + `analytics.adsInsights`
- Scorecard collectors for lead, client, campaign, vendor, system_health
- Cron sweepers: Xero invoice mirror, competitor scan, retainer month-start, memory embed backfill
- Official Xero webhook receiver (`x-xero-signature`, Intent to Receive)
- Official Composio webhook receiver (`webhook-id` / `timestamp` / `v1,base64`)
- Upstash `SCAN` prefix invalidation
- `/api/inbound/lead` route tests; `N8N_WEBHOOK_REQUIRE_SECRET`
- Env-example sync + missing `PRODUCTION-OWNERSHIP-ACCESS-REGISTER.md`

## What this run did not do

- No live provider calls, no production env writes, no secret collection
- No Xero write POST (client lock)
- No Inngest package (cron remains the substitute)
- No Sentry SDK (DSN still a human gate)
- No Meta/Google Ads live HTTP
