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

## `EVID-HRMNY-20260831-APOLLO-007` — corrected stacked head verification

- Decision/finding: Phase 4c head
  `ff80e3ac8befbd2075b537ce23018072b3790203` is now the exact review base.
  The Apollo redirect repair is `d66be9d`; the dependency merge is `a343a51`;
  the setup-module repair is `a6ed4e3`. On that source state, root lint passed
  7/7, typecheck 7/7, test 7/7, database 30/30, integrations 100/100, web
  702/702, and build 2/2. YAML/JSON parse, conflict scan, diff check, and a
  high-confidence secret scan passed.
- Reason: bind local acceptance to the actual stacked dependency and corrected
  transport, not the earlier sibling source state.
- Alternatives considered: preserve the old dependency receipt; wait for CI
  before recording local failures and corrections.
- Trade-offs: hosted disposable PostgreSQL and full Linux browser execution are
  still required for exact-SHA hosted acceptance.
- Evidence: local terminal receipts and three independent read-only audits.
- Confidence/freshness: high locally at commit `a6ed4e3`.
- Affected components: full review slice, CI, database proof, Apollo transport.
- Status: local synthetic/static/build accepted; hosted and every operational
  state remain open.
- Supersedes/superseded-by: supersedes the dependency/head scope of
  `EVID-HRMNY-20260831-APOLLO-001/002/006`; none.
- Rollback/correction: rerun all gates after any further source change and bind
  the hosted receipt to the final pushed SHA.

## `EVID-HRMNY-20260831-APOLLO-008` — path coverage reaches the review target

- Decision/finding: an independent GStack-style coverage map initially found
  21/30 path groups (70%). Three bounded offline test additions cover provider
  transport/parse/error taxonomy, criteria normalization/clamping, and Inngest
  terminal/dispatch branches, raising the static map to 24/30 (80%).
- Reason: meet the review target before publication without widening the
  provider or production scope.
- Alternatives considered: publish at the 60% minimum; add broad UI or database
  changes during ship preparation.
- Trade-offs: six lower-priority coverage groups remain in the explicit backlog;
  no production source changed for this improvement.
- Evidence: 26/26 focused Apollo adapter tests, 111/111 full integrations tests,
  17/17 focused durable-search tests, 11/11 focused Inngest tests, and the final
  full local gates: lint 7/7, typecheck 7/7, test 7/7 including web 712/712 and
  database 30/30, plus build 2/2.
- Confidence/freshness: high locally for the source and tests represented by
  this record; exact-SHA hosted execution remains pending.
- Affected components: Apollo adapter, durable search contract, Inngest bridge,
  review acceptance.
- Status: local review target met; hosted/operational acceptance absent.
- Supersedes/superseded-by: extends
  `EVID-HRMNY-20260831-APOLLO-007`; none.
- Rollback/correction: preserve the deterministic tests and rerun the coverage
  map after material control-flow changes.

## `EVID-HRMNY-20260831-APOLLO-009` — public-diff redaction gate

- Decision/finding: the final added-line scan reports zero high-severity secret
  findings. Medium matches resolve to deterministic UUID/timestamp fixtures and
  one explicitly synthetic phone fixture in an adapter test; no real identity
  or customer data was found.
- Reason: the canonical repository is public and every candidate secret/PII
  signal must be resolved before push.
- Alternatives considered: rely only on an earlier regex scan; treat synthetic
  database URLs as acceptable high findings.
- Trade-offs: fixture construction is slightly more verbose and safer to review.
- Evidence: GStack public-repository added-line scan, exact-location masked
  classification, and `FAIL-HRMNY-20260831-APOLLO-007` correction.
- Confidence/freshness: high on the final local review candidate.
- Affected components: full Phase 4d diff and PR publication boundary.
- Status: local redaction gate passed; hosted security checks pending.
- Supersedes/superseded-by: extends the high-confidence secret scan in
  `EVID-HRMNY-20260831-APOLLO-007`; none.
- Rollback/correction: rerun after every source or PR-body change and block on
  any unresolved high finding.

## `EVID-HRMNY-20260831-APOLLO-010` — first hosted run produced bounded repair evidence

- Decision/finding: PR #244 triggered independent push and pull-request runs.
  Both reproduced the same two failures: stale Node-workflow inventory in the
  verify job and an exact PostgreSQL catalog argument-type mismatch in the
  migration verifier. Neither failure reached Apollo, production, or a secret.
- Reason: retain failures as useful runtime evidence instead of rerunning until
  green without diagnosis.
- Alternatives considered: rerun unchanged; weaken exact schema readback;
  configure Node in the retired workflow.
- Trade-offs: the review head must advance and all exact-head checks rerun.
- Evidence: GitHub Actions runs `33412756597` and `33412781344`; repair commit
  `bb75712`; AI 56/56, database 30/30, and a forced uncached root test run with
  7/7 tasks, integrations 111/111, and web 712/712.
- Confidence/freshness: high for reproduced failure and local repair; hosted
  correction pending.
- Affected components: CI verify, disposable PostgreSQL proof, evidence ledger.
- Status: diagnostic evidence accepted; hosted acceptance remains open.
- Supersedes/superseded-by: none.
- Rollback/correction: push only the minimal repairs, then bind acceptance to the
  new exact head after both event runs reach terminal green.

## `EVID-HRMNY-20260831-APOLLO-011` — second hosted database run corrected the diagnosis

- Decision/finding: exact head `86115f5` closed the verify failure, but its first
  database repair still failed because PostgreSQL 17 exposes no compatible
  three-argument `get_attname` overload. The failure occurred during disposable
  schema discovery after migration apply and before the Sales/Apollo proofs.
- Reason: distinguish an incomplete repair from a flaky rerun and update the
  permanent diagnosis.
- Alternatives considered: retry the same cast; weaken constraint readback.
- Trade-offs: the head advances again and the full hosted matrix must restart.
- Evidence: GitHub Actions run `33413605732`, job `99558879774`, and
  `FAIL-HRMNY-20260831-APOLLO-010`; replacement commit `e033206`.
- Confidence/freshness: high for failure diagnosis; replacement query locally
  linted, typed, and covered by database 30/30.
- Affected components: hosted database job, discovery query, acceptance ledger.
- Status: failure retained; corrected hosted execution pending.
- Supersedes/superseded-by: refines the database portion of
  `EVID-HRMNY-20260831-APOLLO-010`; none.
- Rollback/correction: require terminal hosted proof of the documented catalog
  joins before closing the database gap.
