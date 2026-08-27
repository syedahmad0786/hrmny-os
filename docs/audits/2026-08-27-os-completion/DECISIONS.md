# Decisions, constraints, gaps, outcomes

Recorded 2026-08-27 during the Harmony OS completion audit (cloud agent, no `system_harness` binary).

## Constraints (honoured)

| Constraint | Action |
|------------|--------|
| `XERO_WRITE_ENABLED=false` | Default unchanged in both `.env.example` files. Live `createInvoice` / `createJournal` still throw even if someone flips the flag. `disburse` always throws. |
| `LLM_PROVIDER=mock` | Default unchanged. Embed backfill uses the local hash vector while mock is on. No OpenRouter spend. |
| `DAM_STORAGE=memory` | Default unchanged. Supabase storage still fail-loud without URL + server secret. |
| Never request/store raw secrets | Human-gates table uses env **names** only. |
| No production / provider account changes | No Vercel env writes, no n8n import, no Xero app create, no outbound mail. |

## Material decisions

1. **Harness substitute.** The Windows `platform-capability-graph` tree is not on this VM. We executed the same goal against the Harmony repo and wrote this audit pack + code. Tradeoff: no harness JSON schema from that repo; we invented a compatible `harness-result.json`.
2. **Do not add the Inngest package.** Daily lead-gen, reports, competitor scan, retainer drafts, Xero mirror, and memory backfill now hang off the existing cron sweeper. Tradeoff: 5-minute GitHub cron cannot run multi-minute LLM jobs; that remains a human gate (`INNGEST_*`).
3. **NeverBounce is a first-class mode.** Official current path is `/v4.2/single/check`. Mode keys off `NEVERBOUNCE_MODE` / `NEVERBOUNCE_API_KEY`, not `HUNTER_MODE`. Tradeoff: operators must set the new vars; old Hunter-only setups are unchanged.
4. **Apollo URL left on `/v1`.** Official docs increasingly show `/api/v1`. Changing it without a live key is an unverified break. Recorded as a source gap.
5. **Xero webhook returns empty 200/401.** Official Intent to Receive fails if the body/cookies are wrong. We process invoice events internally but still return an empty body.
6. **Composio inbound is ack-only.** Official HMAC is implemented; we do not execute tools or mutate connections from the webhook until a subscription exists. Prevents surprise side effects.
7. **Ads insights stay mock.** Adapter exists so dashboards have a contract. Live HTTP throws. Matches PLAN-PRODUCTION M11 cut.
8. **Scorecards do not rate people.** New collectors are lead/deal/client/campaign/vendor/system_health only. Employee kinds still throw.
9. **Leads are deals.** The lead collector scores the CRM deal row (lane + verification + temperature). No second lead table.
10. **Client scores use the demo/OS client store**, not CRM companies. Companies are the vendor collector.
11. **Portal staff chrome** was already redirected in `StaffShell`. Inventory P1 `portal-staff-soft-boundary` is closed in code; leftover risk is a brief flash before `auth.session` resolves. No `middleware.ts` added (would need a cookie/session design).
12. **Sentry SDK not added.** Env-only DSN without a project is dead code. Human gate #18 first.
13. **Inventory docs are historical.** We appended a delta pointer rather than rewriting 600+ baseline rows.

## Failures and workarounds

| Failure | Workaround |
|---------|------------|
| `system_harness` not installed | This document set + tests |
| Granola MCP discovery error | Used in-repo Granola URL from BUILD-ACCESS-INVENTORY; did not retrieve meeting notes |
| No Vercel team / Supabase org token | Could not read prod `/api/ready` or apply migrations |
| Hunter account historically dead | Code path ready; credits are gate #5 |
| Execution-spec markdown missing | Relinked n8n GET docs to `docs/automations/n8n/README.md` |

## Outcomes

- Safe local adapters, jobs, webhook contracts, tests, and env examples landed on branch `ahmadbukhari097/harmony-os-audit-complete-1f15`.
- Remaining work is almost entirely human gates (accounts, keys, UAT, sign-off) plus later milestones (live ads, Inngest, Sentry SDK, UAE residency).

## Rollback

- Revert the PR. No migrations were added.
- Cron sweepers are additive JSON fields; old schedulers ignore unknown keys.
- Webhook routes are new — removing them only disables unused URLs.
- Env-example additions are comments + empty names; no default lock flipped.
