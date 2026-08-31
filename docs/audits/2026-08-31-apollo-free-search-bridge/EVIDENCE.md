# Evidence and acceptance

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`. Evidence is local/synthetic
unless explicitly marked otherwise. It is not deployment, provider,
destination, recovery, user, or production acceptance.

## `EVID-HRMNY-20260831-APOLLO-001` — immutable implementation slice

- Decision/finding: commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`
  contains 40 code/workflow/migration/test files and excludes `.system-harness/`.
- Reason: bind review to one exact Git object and preserve local harness memory.
- Alternatives considered: one uncommitted worktree; include generated memory.
- Trade-offs: evidence documentation follows in a separate commit.
- Evidence: Git status, cached file list, cached diff check, and commit object.
- Confidence/freshness: high.
- Affected components: all files in the Sales bridge slice.
- Status: passed source-integrity gate; hosted checks pending.
- Supersedes/superseded-by: none.
- Rollback/correction: reviewed revert or forward fix; do not delete receipts.

## `EVID-HRMNY-20260831-APOLLO-002` — local repository gates

- Decision/finding: root lint passed 7/7 tasks; root typecheck passed 7/7;
  root test passed 7/7, including 127 web files/702 tests, 15 integration
  files/100 tests, and 4 database files/26 tests; root build passed 2/2 and
  produced the web route graph. Final database typecheck, 26/26 database tests,
  and diff checks passed after the last hostile-URL fixture correction.
- Reason: cover compile, behavior, schema contract, adapter, security, retry,
  and application integration before hosted review.
- Alternatives considered: focused tests only; source review only.
- Trade-offs: the local host cannot provide the disposable PostgreSQL service.
- Evidence: terminal outputs from 2026-08-31.
- Confidence/freshness: high for the exact implementation worktree.
- Affected components: monorepo packages, web application, database contracts.
- Status: passed locally; exact-SHA hosted receipt open.
- Supersedes/superseded-by: none.
- Rollback/correction: rerun the full gate after every source correction.

## `EVID-HRMNY-20260831-APOLLO-003` — migration and workflow identity

- Decision/finding: migration 0075 SHA-256 is
  `8bae97228f848fde220193d8783672636670940dcb59e39bd5f98ef05212f201`
  and equals the production contract. The guarded workflow pins checkout
  `3d3c42e5aac5ba805825da76410c181273ba90b1`, setup-node
  `820762786026740c76f36085b0efc47a31fe5020`, and pnpm setup
  `0977fd99725f1db4007ccb2928dbb4e90d06cc86`.
- Reason: make source and runner identity reviewable before any production
  authority or secret is introduced.
- Alternatives considered: floating production action tags; unhashed SQL;
  manual console migration.
- Trade-offs: upstream action upgrades require explicit review.
- Evidence: local hash readback, official action repository tags/commits, and
  production contract tests.
- Confidence/freshness: high as of 2026-08-31.
- Affected components: migration 0075 and production runner.
- Status: source verified; workflow unexecuted.
- Supersedes/superseded-by: retires the old 0068–0074 runner.
- Rollback/correction: update both source and hash contract in one reviewed
  commit; never bypass a mismatch.

## `EVID-HRMNY-20260831-APOLLO-004` — deterministic bridge contracts

- Decision/finding: tests cover exact idempotency, payload mismatch, owner
  isolation, credential refusal, role changes, revoke races, attempt-token
  fencing, leases, cancellation, retry/dead letter, reconciliation, provider
  401/403, safe result mapping, no raw/private persistence, Inngest validation,
  cron health failure, retention bounds, migration reapply, RLS/grants, indexes,
  foreign keys, and prior-schema compatibility.
- Reason: prove negative boundaries as well as the happy path.
- Alternatives considered: one success test; mock only the UI.
- Trade-offs: the test suite is larger and the live canary remains separate.
- Evidence: named test files in the implementation commit and local green gates.
- Confidence/freshness: high locally; hosted PostgreSQL proof pending.
- Affected components: bridge, adapter, queue, scheduler, database, UI.
- Status: passed locally.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve regression fixtures with any forward fix.

## `EVID-HRMNY-20260831-APOLLO-005` — desktop/mobile browser journeys

- Decision/finding: with the exact safe synthetic environment and checked-in
  Windows local bridge, Playwright passed 5/5 in 7.5 seconds: synthetic Apollo
  fixture to deal/detail, disconnected fail-closed state, rejection of global
  readiness as employee connection, pending identity after reload, and 390×844
  no-overflow navigation.
- Reason: validate real controls and state transitions, including reload and
  mobile containment.
- Alternatives considered: component inspection; direct HTTP only.
- Trade-offs: the first direct transport and incomplete-environment failures are
  retained in `FAILURES.md`.
- Evidence: final 5/5 local Playwright output plus preceding negative runs.
- Confidence/freshness: high for the safe synthetic runtime.
- Affected components: Sales Hunt UI, session state, role/connection messages.
- Status: local browser proof passed; hosted/browser/UAT acceptance pending.
- Supersedes/superseded-by: supersedes the incomplete local product-behavior
  result, not its transport failure record.
- Rollback/correction: rerun desktop and mobile journeys after every UI change.

## `EVID-HRMNY-20260831-APOLLO-006` — independent review and non-events

- Decision/finding: three bounded specialist audits concluded with no remaining
  P0/P1 in their final bridge/fencing scope after remediation. They explicitly
  did not grant hosted database, deployment, provider, destination, recovery,
  UAT, or production acceptance. No live external effect occurred.
- Reason: challenge authorization, data minimization, retry/fencing, migration,
  and workflow claims independently.
- Alternatives considered: supervisor-only sign-off; treat review as runtime
  acceptance.
- Trade-offs: acceptance remains conservative until exact receipts exist.
- Evidence: final audit reports from `apollo_acceptance_audit`,
  `apollo_bridge_review`, and `apollo_fencing_design`; source state.
- Confidence/freshness: high for the reviewed commit.
- Affected components: full slice and acceptance ledger.
- Status: code review clear; operational states open.
- Supersedes/superseded-by: supersedes remediated findings in
  `FAIL-HRMNY-20260831-APOLLO-004`; none.
- Rollback/correction: repeat bounded review after material fixes.
