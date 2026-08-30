# Phase 0 runbooks

Runbook set ID: `RUNBOOK-HRMNY-20260829-001`
Date/scope: 2026-08-29; `client-uae-creative-01/hrmny-os`
Actor: host `Bukhari-Laptop`; `Codex /root`; branch `ahmadbukhari097/codex/phase-0-baseline-20260829`; baseline `c9b420d9ad3852ea5aef042b3ad21c0399f2f72a`; implementation commit `1d0920cb49a8142c3141288a80fb7d028fe6a96c`.

## Deterministic verification

1. Use Node 24 and pnpm 9.15.9.
2. Install from the frozen lockfile.
3. Run ordinary tests with database/provider values cleared or forced to mock.
4. Verify live-only tests are excluded and outbound network is denied.
5. Run fresh lint/type-check/tests/build without accepting shared-cache output as new evidence.
6. Record counts, failures, branch, commit, environment class, and skipped live suites.

Rollback/correction: revert the test-isolation commit. Never solve a deterministic-test failure by injecting a live key or production database URL.

## Synthetic Postgres proof

1. Create/select a separately approved disposable Supabase project.
2. Bind its exact project ref as the expected repository/environment variable and its URL as a dedicated secret reference.
3. Provide a time-bounded authorization receipt and exact confirmation.
4. Preflight must parse the URL/ref, reject production `klrugedztqxlvyghyzxs`, reject mismatch/expiry, and print no URL or secret.
5. Force all external providers to mock and accounting writes off.
6. Run the explicit live-only command; retain synthetic IDs and cleanup plan.
7. Reconcile created records, then remove only the named disposable target after a separate destructive-action approval.

Rollback/correction: stop the workflow; discard the isolated target only with explicit approval. Never clean up by connecting to production.

## Provider bridge activation

For each bridge: verify current official source; name source/destination/object/event/auth/scopes/owner; configure secret references securely; commit inbox before acknowledgement; enforce idempotency/replay; preview and authorize the exact effect; perform one canary; provider readback; destination reconciliation; immutable receipt; revocation; rollback; recovery; named UAT. Keep every lifecycle state separate.

## Authenticated production walkthrough

1. Use the dedicated `hrmny.co` browser profile.
2. Human completes Google SSO/MFA; no credential enters chat/logs.
3. Confirm exact deployment/commit identity before acceptance.
4. Visit role home, owned work, Sales Growth, Work, connections, diagnostics, and portal boundary read-only.
5. Do not click create/approve/enrich/send/publish/invite/rotate/configure controls.
6. Record navigation/control truth without copying client-sensitive content.
7. Sign-out/revocation is a separate approved action.

## Restore drill

1. Obtain explicit approval for an isolated restore target and storage destination.
2. Verify source artifact hashes, custody, decryptability, and target non-production identity.
3. Restore database and Storage; never overwrite production.
4. Verify journal/schema/constraints/RLS, object hashes, critical reads, portal denials, and application startup.
5. Measure RPO and RTO; inject restart/dependency failure; verify no duplicate effects.
6. Retain redacted receipts. Dispose of the exact restore target only after separate approval.

## Harness and Graphify transition

After each material task or gap transition: record the execution task with a receipt; update persistent gaps; run memory status; refresh the selected run graph; confirm each visible connection resolves to a component, official contract, bridge, test, or explicit gap. Generic Neon/Redis/Cloudflare/Spaces/PostHog nodes remain unaccepted hypotheses unless an ADR and proof supersede them.
