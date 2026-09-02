# Failures

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commits `fc2d288074bc44624abbb9e701b5c5ffa7adb775` and
`900bc0e548061b5b6872c3552b18ff8d1c309a6b`, plus correction
`d1ab23c36ebbde5320967f0d806251193919b1c6` and no-helper correction
`8bce5127ef4c817789a3fe8ad3e10677bd9a9c82`, plus fixture correction
`0f3ac24ddd2645b4b03247ec720fe078406a0d15`.

## `FAIL-HRMNY-20260902-APOLLO-016` — ambiguity was initially understated

- Decision/finding: early status copy and the definitive 401/403 branch could
  hide ambiguity created by a prior lost authorized attempt.
- Reason: terminal-state code initially described only the latest attempt.
- Alternatives considered: leave the UI concise; clear ambiguity on any later
  response.
- Trade-offs: operator copy is more cautious but does not imply an unverified
  provider outcome.
- Evidence: adversarial review and regression tests for status copy and a lost
  attempt followed by definitive authentication failure.
- Confidence/freshness: high.
- Affected components: receipt projection, retry/dead-letter/revoked copy.
- Status: corrected before implementation commit.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve `providerOutcomeAmbiguous` across all terminal
  transitions and reopen this failure if any projection drops it.

## `FAIL-HRMNY-20260902-APOLLO-017` — reserved-key scope was initially one-way

- Decision/finding: an early trigger draft assigned the free-search key but did
  not clear it when a job changed to another kind, silently enrolling paid or
  unrelated work.
- Reason: the invariant was expressed as an assignment rule rather than a
  bidirectional reserved-key boundary.
- Alternatives considered: document that job kinds never change; permit other
  jobs to retain the key.
- Trade-offs: the corrected trigger is stricter and the CHECK is more verbose.
- Evidence: transition proof now covers Search-to-Match and direct Match insert
  with the reserved key.
- Confidence/freshness: high.
- Affected components: migration `0076`, discovery, and disposable verifier.
- Status: corrected before implementation commit.
- Supersedes/superseded-by: none.
- Rollback/correction: reject any migration whose readback permits a non-search
  row to retain `provider:apollo`.

## `FAIL-HRMNY-20260902-APOLLO-018` — migration syntax and security omissions were caught locally

- Decision/finding: an intermediate CHECK expression missed `AND`, and the
  first final draft omitted the repository-required RLS/Data API revocation
  stanza. Independent review and `migration-security.test.ts` caught both.
- Reason: iterative migration edits and a repository-wide security convention
  were not yet reflected in the draft.
- Alternatives considered: waive the generic migration test; rely on prior RLS
  state without explicit readback.
- Trade-offs: repeating RLS/revokes is redundant but auditable and fail-closed.
- Evidence: final database tests 38/38, clean diff, exact SQL hash, and
  independent re-review.
- Confidence/freshness: high.
- Affected components: migration `0076` and its immutable contract hash.
- Status: corrected before implementation commit.
- Supersedes/superseded-by: none.
- Rollback/correction: any SQL edit requires a new hash, full database/security
  tests, and fresh review.

## `FAIL-HRMNY-20260902-APOLLO-019` — local PostgreSQL runtime unavailable

- Decision/finding: `DATABASE_URL` was unset, no local PostgreSQL client was
  installed, and the available Docker executable had no usable daemon.
- Reason: the clean worktree had no safe disposable database runtime.
- Alternatives considered: use production; install/start infrastructure
  without scope; omit the evidence gap.
- Trade-offs: database execution proof waits for hosted CI.
- Evidence: environment checks and `GAP-HRMNY-20260902-APOLLO-014`.
- Confidence/freshness: high on 2026-09-02.
- Affected components: 40-case PostgreSQL runtime suite and disposable
  migration verifier.
- Status: unresolved locally; bounded hosted fallback selected.
- Supersedes/superseded-by: none.
- Rollback/correction: use CI's disposable PostgreSQL service and never point
  synthetic verification at production.

## `FAIL-HRMNY-20260902-APOLLO-020` — first hosted database assertion leaked its test lock

- Decision/finding: the initial push and pull-request database jobs failed.
  Migration verification/application and the Sales PostgreSQL proof passed,
  then the first Apollo concurrency case expected a ten-minute retry while the
  runtime correctly returned the bounded five-second retry. The assertion
  exited before releasing the first provider promise, leaving the lock-only
  transaction open and causing 24 later cases to report `busy`.
- Reason: the test expectation did not follow the provider-lock busy contract,
  and cleanup was not protected by `finally`.
- Alternatives considered: treat all 24 cascades as runtime defects; rerun the
  unchanged test; weaken the runtime busy bound.
- Trade-offs: correction adds explicit cleanup even when an assertion fails and
  keeps the intended five-second retry behavior.
- Evidence: push run `33549333254`, job `99994613400`; pull-request run
  `33549371235`, job `99994746031`; correction commit `900bc0e`; both later
  database matrices passed this corrected concurrency case before failing at a
  subsequent Vault boundary.
- Confidence/freshness: high on 2026-09-02 from both identical hosted failures.
- Affected components: Apollo PostgreSQL acceptance fixture and hosted database
  acceptance state; no production database.
- Status: correction hosted-verified; the failed whole matrices remain
  unaccepted and exact-current source acceptance is open.
- Supersedes/superseded-by: none.
- Rollback/correction: retain `try/finally` release plus `Promise.allSettled`,
  and never accept the failed runs as provider-slot evidence.

## `FAIL-HRMNY-20260902-APOLLO-021` — browser acceptance asserted obsolete receipt copy

- Decision/finding: 92 of 93 browser journeys passed in each initial matrix;
  the terminal-principal journey failed because it expected the obsolete
  wording “reconciled from receipt,” while the reviewed UI now reports the
  current Apollo attempt and the receipt identifier explicitly.
- Reason: the UI copy was hardened without updating the browser contract.
- Alternatives considered: restore ambiguous old wording; remove the status
  assertion; accept a flaky retry.
- Trade-offs: the corrected test asserts both `current Apollo mock attempt` and
  the synthetic receipt prefix. A local Windows replay hung at navigation, but
  four later hosted Linux e2e jobs passed this correction.
- Evidence: push run `33549333254`, job `99994613933`; pull-request run
  `33549371235`, job `99994746036`; correction commit `900bc0e`; passing later
  e2e jobs `100005748139`, `100005773580`, `100011167515`, and `100011185985`.
- Confidence/freshness: high for hosted failure cause and hosted correction.
- Affected components: one Playwright assertion and source acceptance state.
- Status: correction hosted-verified; whole-matrix and exact-current source
  acceptance remain open.
- Supersedes/superseded-by: none.
- Rollback/correction: keep the explicit current-attempt and receipt assertions;
  investigate local browser startup separately if hosted Linux disagrees.

## `FAIL-HRMNY-20260902-APOLLO-022` — runtime queried a Vault table outside its grant boundary

- Decision/finding: both second hosted database jobs passed migration
  verification/application and the Sales PostgreSQL proof, then failed the
  Apollo suite with `permission denied for table secrets`. The corrected
  browser journey and repository verify jobs passed in both matrices.
- Reason: the rotation fence joined or queried `vault.secrets` directly even
  though the application role's supported contract is
  `vault.decrypted_secrets` plus Vault functions.
- Alternatives considered: grant the application role direct table access;
  remove the rotation fence; treat the CI role as misconfigured; hide the
  failure because preview and browser checks passed.
- Trade-offs: correction `d1ab23c` moved the read to the permitted view without
  expanding privileges, but its retained `FOR SHARE` assumption failed in the
  next hosted matrices and is separately recorded as `FAIL-023`.
- Evidence: push run `33552684634`, database job `100005748422`; pull-request
  run `33552691805`, database job `100005773724`; both e2e jobs and both verify
  jobs passed; official Supabase Vault repository and extension SQL.
- Confidence/freshness: high on 2026-09-02 from identical disposable-database
  failures and primary-source verification.
- Affected components: owned Apollo key resolution, dispatch fence, stale-auth
  reconciliation, and hosted database acceptance; no production database.
- Status: direct-table defect removed in `d1ab23c`; that intermediate design was
  rejected by `FAIL-023` and superseded in source by `8bce512`.
- Supersedes/superseded-by: supplemented by `FAIL-023`; no acceptance receipt
  superseded.
- Rollback/correction: keep the PR unmerged and Apollo closed; do not restore
  direct Vault-table access or broaden Vault grants.

## `FAIL-HRMNY-20260902-APOLLO-023` — runtime attempted to row-lock the permitted Vault view

- Decision/finding: both third hosted database jobs passed migration
  verification/application and the Sales PostgreSQL proof, then the Apollo
  suite failed with `permission denied for view decrypted_secrets`. Both e2e
  jobs and both repository verify jobs passed. Neither matrix is accepted.
- Reason: correction `d1ab23c` moved reads from the forbidden base table to the
  permitted view but retained `FOR SHARE`, which still requires a relation
  privilege the application runtime role does not have.
- Alternatives considered: grant row-lock privileges on Vault relations; add a
  privileged helper; drop the action-time revision check; claim successful
  browser/verify jobs as full acceptance.
- Trade-offs: correction `8bce512` locks only operational connection rows and
  serializes supported save/disconnect through the Apollo lane. Direct
  privileged Vault-only edits are no longer a supported concurrent operation
  and must be quiesced. Fresh hosted matrices are required.
- Evidence: push run `33554283761`, database job `100011168058`, e2e job
  `100011167515`, verify job `100011167816`; pull-request run `33554289195`,
  database job `100011185659`, e2e job `100011185985`, verify job
  `100011185901`; exact hosted error and official Supabase Vault extension SQL.
- Confidence/freshness: high on 2026-09-02 from identical disposable-database
  failures.
- Affected components: final credential authorization, stale 401/403
  reconciliation, governed rotation/disconnect, hosted database acceptance;
  no production database or provider.
- Status: corrected locally in
  `8bce5127ef4c817789a3fe8ad3e10677bd9a9c82`; exact-head hosted proof pending.
- Supersedes/superseded-by: does not supersede `FAIL-022`; together they record
  the two distinct rejected Vault privilege assumptions; none.
- Rollback/correction: keep PR #246 unmerged and production unchanged. Do not
  restore a Vault relation lock or broaden grants; correct forward and require
  both exact-head hosted matrices.

## `FAIL-HRMNY-20260902-APOLLO-024` — exact-head fixture violated database-owned invariants

- Decision/finding: both exact-head database jobs failed identically because
  the PostgreSQL fixture conflated the injected application clock with the
  database clock, attempted to delete append-only audit evidence, asserted
  absolute audit totals across a reused synthetic identity, and did not
  deterministically settle and close force-terminated database clients.
- Reason: deterministic unit-test conventions were carried into a hosted
  PostgreSQL proof whose clock, immutable ledger, and connection lifecycle are
  owned by the database and driver.
- Alternatives considered: alter runtime behavior to match the fixture;
  disable append-only enforcement; erase historical audit evidence; reuse a
  killed client for recovery; classify all five failures as production logic
  defects.
- Trade-offs: correction `0f3ac24` retains the fixed synthetic employee and
  immutable audit history, baselines audit counts before each operation,
  retires only mutable connection/Vault fixture state, brackets retry timing
  with database timestamps, explicitly closes extra clients, and creates a
  fresh client after backend loss. This adds fixture lifecycle code without
  changing the production contract.
- Evidence: push run `33578743186`, database job `100088315750`;
  pull-request run `33578745871`, database job `100088323877`; each reported
  35/40 tests, four `audit_event is append-only` failures, one database-clock
  retry mismatch, and one late Postgres.js write-after-close error.
- Confidence/freshness: high on 2026-09-02 from identical hosted results and
  direct source comparison.
- Affected components: one PostgreSQL acceptance test file and current-source
  acceptance; no provider, production database, migration, or application
  runtime.
- Status: reproduced and corrected in test-only source `0f3ac24`; exact-head
  hosted correction receipts pending.
- Supersedes/superseded-by: distinct from
  `FAIL-HRMNY-20260902-APOLLO-020`, which recorded the earlier unreleased test
  lock. It does not supersede any acceptance receipt.
- Rollback/correction: never weaken database-clock leases or append-only audit
  enforcement to make CI pass. Preserve the failed receipts and require both
  fresh hosted matrices before acceptance.

## `FAIL-HRMNY-20260902-APOLLO-025` — Postgres.js can queue a write after its socket closes

- Decision/finding: the hosted force-termination proof reproduced a fatal
  Postgres.js `3.4.9` race: a small write deferred with `setImmediate` can run
  after connection cleanup has set the socket to `null`, throwing outside the
  query promise. The test correction disposes deliberately killed clients in
  time, but it does not remove the runtime dependency defect.
- Reason: backend termination is a deterministic trigger for an upstream
  connection-pool race that can also follow failover, pooler resets, backend
  restarts, or network loss.
- Alternatives considered: hide the unhandled error; treat explicit test
  disposal as a production fix; apply an unreviewed one-line patch in this
  already-scoped PR; wait indefinitely for upstream.
- Trade-offs: isolating a consumer patch keeps PR #246 reviewable and allows a
  child-process chaos test to prove bounded query settlement and reconnection,
  not merely absence of the crash. Connection-loss resilience remains
  unaccepted until that separate slice passes.
- Evidence: hosted database jobs `100088315750` and `100088323877`; local
  `postgres@3.4.9` `connection.js`; upstream issue
  <https://github.com/porsager/postgres/issues/1066>; open upstream PR
  <https://github.com/porsager/postgres/pull/1168>; independent architecture
  review.
- Confidence/freshness: high for the race and affected pinned version on
  2026-09-02; medium for any proposed consumer patch until the required chaos
  proof passes.
- Affected components: PostgreSQL client availability, transaction cleanup,
  worker/API process stability, failover, recovery evidence, and deployment.
- Status: reproduced dependency defect; unresolved in runtime; tracked by
  `GAP-HRMNY-20260902-APOLLO-019`.
- Supersedes/superseded-by: none.
- Rollback/correction: keep connection-loss recovery unaccepted; implement a
  pinned, checksummed consumer patch in a separate reviewable branch, prove
  pre/post behavior under Node 24 against a disposable database, and remove it
  only after an upstream release passes the same proof.
