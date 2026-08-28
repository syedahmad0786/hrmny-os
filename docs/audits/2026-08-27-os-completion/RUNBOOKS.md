# HRMNY completion runbooks

All commands run from the canonical worktree. Never substitute a production target into a development command without a separate reviewed approval.

## 1. Deterministic local verification

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Record command, exit code, test count, build route count, SHA, and timestamp. Live-only tests remain skipped unless their exact account/spend gates are approved. The final local receipt was lint 7/7, typecheck 7/7, tests 772 passed/3 skipped, build 2/2 with 86 main-app pages.

### Windows browser acceptance

On this host, native `next dev` and `next start` can send dynamic response headers without completing the body even though direct handlers pass. Use the checked-in local bridge only for local acceptance; it is not a production server.

1. Build once with explicit `AUTH_MODE=dev`, `ALLOW_DEV_AUTH=true`, `DATABASE_MODE=memory`, all provider modes set to mock, Xero/n8n write flags false, and no live key values.
2. Terminal A: run `pnpm --filter @hrmny/web exec next start -p 3100` with the same safe environment.
3. Terminal B: run `pnpm e2e:bridge` with the same safe environment.
4. Terminal C:

```powershell
$env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3500'
pnpm --filter @hrmny/web e2e
```

The clean receipt is 74/74. Do not immediately loop the suite on this Windows session: the reliable forced-close transport can leave thousands of loopback sockets in `CLOSING` and cause false `EADDRINUSE` failures. Use a fresh CI/preview runner or wait for socket state to clear; changing TCP settings, rebooting, or terminating unrelated processes requires separate approval. Always retain a failed rerun as a separate receipt.

## 2. Migration 0074 fresh and upgrade verification

This runbook is destructive only to two hard-coded disposable databases: `hrmny_migration_fresh` and `hrmny_migration_upgrade`. The verifier refuses non-local hosts and refuses to run without the explicit flag.

Preconditions:

1. Obtain G1 approval and a local Supabase PostgreSQL 17.6.1.141 instance with `vector` and `supabase_vault` available.
2. Confirm the admin URL points only to `127.0.0.1`, `localhost`, or the local Docker service `postgres`.
3. Confirm neither disposable database contains required data.

```powershell
$env:DATABASE_URL = '<resolve from approved MIGRATION_TEST_DATABASE_URL reference>'
$env:MIGRATION_TEST_ALLOW_DROP = 'true'
pnpm db:verify
```

Expected evidence:

- journal head is `0074_integration_inbox_invoice_metadata`;
- all migrations apply to a fresh database;
- 0073→0074 and a second 0074 application are idempotent;
- inbox unique index/RLS/browser revokes exist;
- invoice metadata columns and a replay test pass;
- both disposable databases are dropped in `finally`.

Do not use this command against Supabase production. Production migration is a separate G2/G3 action with backup, direct connection, single writer, lock review, and post-migration readback.

## 3. Preview release order

1. Confirm clean diff and approved remote target.
2. Push/open PR only if G2 explicitly permits it.
3. Let CI verify lint, typecheck, tests, build, e2e, and disposable-DB migrations.
4. Deploy a preview only if approved; do not inherit production-only secrets casually.
5. Read `/api/ready`, login, Connections, billing, inbound routes, and job registration from the preview.
6. Run synthetic fixtures; no customer records, external sends, paid lookups, or finance writes.
7. Record deployment ID/SHA, environment, readback, logs, and rollback target.
8. Request production approval only after preview evidence is reviewed.

## 4. Production migration and application verification

1. Confirm backup/PITR and separate Storage-object recovery receipt.
2. Confirm direct migration connection, runtime pool connection, database version/extensions, and one migration writer.
3. Review lock/rewrite risk of migration 0074; it is additive, but table locks and live traffic still matter.
4. Apply the reviewed migration once through the approved deployment mechanism.
5. Verify migration journal/checksum, columns, FKs, unique index, RLS, grants, and application queries.
6. Deploy the exact tested SHA; check `/api/ready` and error telemetry.
7. If failure occurs, stop traffic-changing actions. Prefer forward-fix; restore only with explicit destructive approval and RPO/RTO acknowledgement.

## 5. Xero read-only activation

1. Bind Xero refs; keep `XERO_WRITE_ENABLED=false`.
2. Register the exact callback and webhook URLs.
3. Select/confirm `XERO_TENANT_ID`; do not pick the first connection.
4. Complete OAuth as the named finance owner.
5. Pass Intent-to-Receive, then send a signed synthetic event.
6. Verify the inbox receipt before webhook acknowledgement.
7. Run scheduled mirror sync and compare invoice count/status to Xero.
8. Link one synthetic OS invoice by external ID and verify paid reconciliation only from Xero `PAID`.
9. Revoke consent and verify HRMNY reports reconnect-required without losing audit history.

## 6. Google Workspace pilot

1. Bind the exact Cloud project/client and dedicated state-secret refs.
2. Register the exact callback; confirm consent-screen and restricted-scope status.
3. Connect one approved `@hrmny.co` pilot user.
4. Verify state expiry/signature/redirect negative tests, token refresh, and employee binding.
5. Read one approved Gmail/Calendar/Drive fixture.
6. Preview any send; obtain separate external-send approval; verify recipient delivery.
7. Revoke and reconnect, retaining only connection/audit references.

## 7. n8n import and activation

1. Import both JSON exports into the client-owned project **inactive**.
2. Configure upstream→n8n Header Auth on the inbound Webhook node.
3. Configure n8n→HRMNY auth using the inbound secret/HMAC convention.
4. Configure HRMNY→n8n Header Auth with exact header `X-Hrmny-Os-Secret` and the separate outbound secret.
5. Pin all HTTP nodes; test valid, invalid, missing-event-ID, replay, conflicting-payload, and downstream-failure branches.
6. Verify CRM/inbox destination state independently.
7. Obtain explicit activation approval; enable one workflow and monitor one synthetic execution.
8. Recovery: deactivate, set `N8N_ALLOW_PRODUCTION_TRIGGER=false`, rotate only the affected secret, reconcile retained event IDs.

## 8. Composio activation

1. Select project/environment/auth config, stable HRMNY user, connected account, and exact tool/trigger slugs.
2. Bind key/webhook refs and register `/api/webhooks/composio`.
3. Verify ACTIVE connection before exposing tools.
4. Send signed synthetic webhook; test replay and conflicting ID.
5. Verify inbox receipt, then reconcile canonical provider state.
6. Any write tool follows preview → human approval → execution → provider readback → destination verification.
7. Revoke connected account and confirm tool access closes.

## 9. Inngest single-scheduler cutover

1. Bind project/event/signing refs and sync `/api/inngest` in the approved environment.
2. Confirm both `hrmny-leadgen-daily` and report scheduler are discovered.
3. Verify signed cron skips those jobs only when both keys exist.
4. Run one synthetic due schedule and inspect retries/step output.
5. Verify downstream CRM/report/email state separately.
6. Recovery: pause provider functions or remove both refs, then verify signed cron becomes the single fallback runner.

## 10. Sentry acceptance

1. Select SaaS org/project/region/environment and approve retention/PII policy.
2. Bind runtime DSN; bind release token only to the deployment job if source maps are approved.
3. Trigger one synthetic handled error with a harmless correlation ID.
4. Verify event, environment, release, stack mapping, and absence of request/client/credential payload.
5. Disable DSN to prove the application remains operational without telemetry.

## 11. Paid provider activation

For Apollo, Hunter, NeverBounce, and paid embeddings:

1. Confirm account/plan, exact operation, synthetic target, monthly cap, and owner.
2. Bind key without flipping mode or paid flag.
3. Run the free credential probe where available.
4. Approve one paid call; flip only that provider's paid flag.
5. Record request/result, credit/usage delta, CRM/memory readback, duplicate behavior, and failure path.
6. Return the paid flag to false if the pilot is complete.

### Apollo one-person production canary

This release has a narrower owner authorization than the generic paid-provider flow:

1. Verify `/api/ready` reports the Apollo credential configured and verify the exact production deployment SHA.
2. In Sales Growth, run People Search first. It is a 0-credit read and must return reviewable professional candidates without an email/phone unlock.
3. Select one candidate by the deterministic fit rule recorded with the acceptance receipt. Confirm the dialog that states one credit and the disabled phone/personal-email/waterfall fields.
4. Execute only `salesOs.apollo.enrichOne`. Do not enable the global paid flag and do not invoke organization search, bulk match, waterfall, phone, Hunter, NeverBounce, sequence, or outbound actions.
5. Read back the fixed `integration_inbox` receipt, one conservative `apollo_contact` ledger count, and the reconciled CRM company/contact/open deal. Confirm the CRM note carries the receipt ID and all four paid-field flags as false.
6. Re-submit the same candidate only as a replay test: it must return the completed result without a provider call or second ledger entry. A different candidate must fail locally before Apollo.
7. If the call times out or the receipt is `processing`/`failed`, stop. Compare Apollo usage with CRM and the receipt before requesting any new allowance. Never delete the receipt to retry.

## 12. Sales Growth and Chat browser acceptance

1. Open `/crm/hunt` at the exact deployment SHA. Confirm the full operating loop, free-search action, connection guardrails, and research gates are visible without scrolling through a branded splash screen.
2. Confirm primary CRM navigation contains Sales Growth, Research, Pipeline, Outreach, and Tasks; detailed records/settings are under **More**.
3. Run one free Apollo search and verify candidate names/roles/company profiles are returned, the status explicitly says 0 credits, and no CRM deal is created yet.
4. After the separately bounded Apollo canary, follow its CRM link and verify company, contact, deal, source note, and open-pipeline status.
5. Open `/chat`. Confirm generated proof/E2E agents, clients, and sessions are absent by default, a hidden-record count is disclosed, and **Show test records** restores them without any deletion.
6. Check desktop and narrow viewport keyboard focus, menu operation, labels, empty states, console errors, and authenticated navigation loops.

## 13. UAT and acceptance

Ayham and Maolham should sign each domain separately:

- identity/RBAC and portal isolation;
- CRM sourcing/inbound/replay;
- Work migration and task operations;
- invoice issue with legal TRN and read-only Xero payment convergence;
- scheduler, report delivery, and failure/retry behavior;
- integration disconnect/revoke;
- backup/restore or agreed recovery drill.

A green deployment is not UAT. Record actor, environment, fixture IDs, expected/actual outcome, defects, acceptance, and any waived limitation.
