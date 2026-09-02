# Evidence

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commits `fc2d288074bc44624abbb9e701b5c5ffa7adb775` and
`900bc0e548061b5b6872c3552b18ff8d1c309a6b`, plus correction
`d1ab23c36ebbde5320967f0d806251193919b1c6` and no-helper correction
`8bce5127ef4c817789a3fe8ad3e10677bd9a9c82`, plus fixture correction
`0f3ac24ddd2645b4b03247ec720fe078406a0d15`; base
`8b672fd4e1ee2671d6919011e29b91886d706278`.

## `EVID-HRMNY-20260902-APOLLO-021` — historical local source gate, invalidated

- Decision/finding: root lint passed seven tasks; root typecheck passed seven
  tasks; root tests passed 962 cases (web 728, database 38, integrations 111,
  gate 25, AI 56, cache 4); and both web production builds completed. Database
  security/contract tests passed 38/38 and AI tests passed 56/56.
- Reason: freeze the implementation only after the complete deterministic
  repository gate, not only focused happy paths.
- Alternatives considered: focused tests only; live Apollo; skip production
  build.
- Trade-offs: the default web suite excludes the 29-case PostgreSQL runtime
  file, so this is not database-runtime acceptance.
- Evidence: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, formatter
  check, `git diff --check`, exact migration-hash comparison, and a secret
  pattern scan. The focused changed-file scan found no credential-shaped
  assignment; the broader initial scan found only the existing localhost
  disposable-database fixture.
- Confidence/freshness: high on 2026-09-02.
- Affected components: all implementation files in commits `fc2d288`,
  `900bc0e`, and `d1ab23c`.
- Status: historical receipt invalidated by source commit `8bce512`; it is not
  exact-current acceptance.
- Supersedes/superseded-by: superseded by
  `EVID-HRMNY-20260902-APOLLO-024` for the current source.
- Rollback/correction: any source change invalidates this exact-head receipt and
  requires the full gate again.

## `EVID-HRMNY-20260902-APOLLO-022` — adversarial review and loss modeling

- Decision/finding: independent read-only reviewers challenged provider-wide
  scope, revoke ordering, stale completion, actor/role loss, credential
  rotation, stale 401 handling, migration exactness, paid-operation leakage,
  and UI ambiguity. They found an in-place Vault-rotation fence gap and two
  terminal paths that could drop prior ambiguity. Commit `900bc0e` added the
  Vault rotation fence and preserved ambiguity. Hosted execution then found
  unsupported direct-table and view-lock permission assumptions. Review of the
  no-helper redesign found one unleased-processing mutation-fence gap; commit
  `8bce512` corrected it and the final exact-source re-review found no remaining
  concrete P0/P1/P2 defect.
- Reason: concurrency and external-effect boundaries require adversarial races,
  not only line coverage.
- Alternatives considered: self-review only; allow reviewers to provision a
  provider or edit overlapping files.
- Trade-offs: review cannot replace the excluded PostgreSQL execution suite,
  provider readback, recovery drill, or UAT.
- Evidence: forced `pg_terminate_backend` test, concurrent independent-client
  claim tests, in-flight revoke case, exact actor/connection/Vault loss cases,
  stale 401 after Vault-only rotation, role-loss and attempt-limit ambiguity
  preservation, canonical and legacy mutation fences, null-lease fail-closed
  proof, missing-Vault status projection, Search-to-Match migration transition
  proof, and final SQL/hash/security re-review.
- Confidence/freshness: high for current source; hosted runtime pending.
- Affected components: runtime claimant, receipts, migration, connection fence,
  and operator copy.
- Status: read-only review accepted with documented residual gaps.
- Supersedes/superseded-by: none.
- Rollback/correction: reopen the exact finding and preserve failure history if
  hosted proof disagrees.

## `EVID-HRMNY-20260902-APOLLO-023` — hosted failures remained visible and bounded

- Decision/finding: both hosted matrices for initial head
  `afc708a078eb72de98200195e8faed03fb51ca90` and both matrices for corrected
  head `d1a137d42fa81daa3a9844d0dcc79bba2dfe9b8e`, plus both matrices for head
  `65748a1bf88076ebc240cd17737f28e7fa7b7c56`, failed and are not accepted.
  The second matrices proved the browser correction but exposed an unsupported
  direct `vault.secrets` assumption; the third exposed the same unsupported
  row-lock assumption through `vault.decrypted_secrets`.
- Reason: the first concurrency test expected the obsolete ten-minute lease
  retry rather than the bounded five-second busy retry. Its assertion exited
  before releasing the first provider promise, so the open advisory transaction
  caused 24 cascading busy results. The browser test still expected the old
  `reconciled from receipt` wording after status copy changed to identify the
  current attempt and receipt explicitly. The next implementation queried
  `vault.secrets` directly even though the runtime role is granted the
  supported `vault.decrypted_secrets` view. The next correction still requested
  `FOR SHARE` through that view, which the runtime role also cannot do.
- Alternatives considered: rerun the same head; hide cascade failures; reuse
  successful verify/preview checks as whole-matrix acceptance.
- Trade-offs: all failed evidence remains permanent. The no-helper correction
  `8bce5127ef4c817789a3fe8ad3e10677bd9a9c82` requires fresh hosted matrices and
  does not inherit successful sub-jobs from any failed head.
- Evidence: push run `33549333254`, database job `99994613400`, e2e job
  `99994613933`, verify job `99994613796`; pull-request run `33549371235`,
  database job `99994746031`, e2e job `99994746036`, verify job
  `99994745678`; second push run `33552684634`, database `100005748422`, e2e
  `100005748139`, verify `100005748387`; second pull-request run `33552691805`,
  database `100005773724`, e2e `100005773580`, verify `100005773396`; third
  push run `33554283761`, database `100011168058`, e2e `100011167515`, verify
  `100011167816`; third pull-request run `33554289195`, database
  `100011185659`, e2e `100011185985`, verify `100011185901`; PR
  <https://github.com/syedahmad0786/hrmny-os/pull/246>.
- Confidence/freshness: high on 2026-09-02.
- Affected components: hosted PostgreSQL proof, browser acceptance, and source
  acceptance state; no provider or production resource.
- Status: three source heads tested and failed honestly; `8bce512` is locally
  verified and not yet hosted.
- Supersedes/superseded-by: does not supersede an acceptance receipt; a later
  exact-head hosted receipt must supplement it.
- Rollback/correction: keep the PR unmerged and production unchanged; require
  both corrected push and pull-request matrices before source acceptance.

## `EVID-HRMNY-20260902-APOLLO-024` — exact-current deterministic source gate

- Decision/finding: source head
  `8bce5127ef4c817789a3fe8ad3e10677bd9a9c82` passed seven lint tasks, seven
  type-check tasks, 964 deterministic tests (web 730, database 38,
  integrations 111, gate 25, AI 56, cache 4), and both production builds. The
  web build generated 86 routes. The focused import contract passed 3/3.
- Reason: the no-helper credential lifecycle, database-clock leases,
  missing-Vault projection, and null-lease mutation fence changed source after
  the prior local receipt.
- Alternatives considered: inherit `EVID-021`; run only focused tests; treat
  reviewer approval as execution proof; call a live provider.
- Trade-offs: the 40-case PostgreSQL runtime file is intentionally excluded
  from the default suite and remains pending on CI's disposable database. The
  local machine still has no safe PostgreSQL URL or working Docker daemon.
- Evidence: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, formatter
  check, `git diff --check`, zero changed-file credential-shape findings,
  PostgreSQL case count 40, and unchanged migration SHA
  `4941903ab873fabbb4a7359a83b95a48daee1df9eddae9ba38fa3cfb78bd68a7`.
  Three independent reviews ended with no remaining P0–P2 finding.
- Confidence/freshness: high for exact local source on 2026-09-02; hosted
  PostgreSQL confidence remains pending.
- Affected components: the eight implementation/test files in `8bce512`, the
  Apollo runtime contract, connection status projection, and acceptance state.
- Status: exact-current local source gate accepted; hosted, provider,
  deployment, recovery, user, and production acceptance remain open.
- Supersedes/superseded-by: supersedes `EVID-HRMNY-20260902-APOLLO-021` only as
  the current local source receipt; none.
- Rollback/correction: any later source edit invalidates this receipt and
  requires the complete deterministic gate again.

## `EVID-HRMNY-20260902-APOLLO-025` — exact-head hosted matrices exposed bounded fixture defects

- Decision/finding: push run `33578743186` and pull-request run
  `33578745871` tested exact head
  `cd146c35db0840fcaffed580c4644ecb6b6e28e5`. Both repository verify jobs
  and both browser jobs passed. Both disposable-database jobs passed migration
  verification/application and the Sales PostgreSQL proof, then the 40-case
  Apollo suite finished with 35 passed, five failed, and one unhandled error.
  One assertion expected an injected application-clock retry timestamp while
  the runtime correctly used the database clock. Four cases attempted to
  remove prior `audit_event` fixture rows even though the ledger is
  append-only. A force-terminated PostgreSQL client also emitted a late
  write-after-close error.
- Reason: the exact no-helper source needed hosted execution against a real
  disposable PostgreSQL runtime. That execution correctly rejected fixture
  assumptions that contradicted the database-clock and append-only-audit
  contracts.
- Alternatives considered: accept the successful sub-jobs as whole-matrix
  proof; change production retry timing to satisfy the fixture; weaken or
  bypass the append-only trigger; reuse a terminated database client; rerun
  the unchanged head.
- Trade-offs: the bounded correction changes only
  `apps/web/src/server/sales-os/apollo-search-postgres.test.ts`. It brackets the
  five-second retry with database timestamps, preserves immutable audit rows
  and asserts audit deltas from a captured baseline, waits for killed backend
  PIDs to disappear, closes independent or terminated database clients, and
  uses a fresh recovery client. The source change invalidates the prior
  exact-current local receipt and requires fresh deterministic and hosted
  proof.
- Evidence: push run
  <https://github.com/syedahmad0786/hrmny-os/actions/runs/33578743186>,
  database job `100088315750`, e2e job `100088315513`, verify job
  `100088315747`; pull-request run
  <https://github.com/syedahmad0786/hrmny-os/actions/runs/33578745871>,
  database job `100088323877`, e2e job `100088323939`, verify job
  `100088323748`; PR
  <https://github.com/syedahmad0786/hrmny-os/pull/246>; bounded fixture
  correction `0f3ac24ddd2645b4b03247ec720fe078406a0d15`.
- Confidence/freshness: high on 2026-09-02 from two identical hosted
  disposable-database failures and the bounded test-only source delta.
- Affected components: Apollo PostgreSQL acceptance fixture, disposable client
  lifecycle, and source acceptance state; no production database, provider,
  migration, or runtime implementation.
- Status: negative hosted evidence accepted; both whole matrices remain
  unaccepted. The fixture correction requires both fresh hosted event
  matrices.
- Supersedes/superseded-by: supplements
  `EVID-HRMNY-20260902-APOLLO-023`. It invalidates
  `EVID-HRMNY-20260902-APOLLO-024`; `EVID-026` is the replacement local-source
  receipt.
- Rollback/correction: preserve both failed runs, keep PR #246 unmerged,
  exclude unrelated `.system-harness/` state, and require terminal push and
  pull-request matrices on the corrected exact head.

## `EVID-HRMNY-20260902-APOLLO-026` — fixture-corrected deterministic source gate

- Decision/finding: source commit
  `0f3ac24ddd2645b4b03247ec720fe078406a0d15` passed seven lint tasks, seven
  type-check tasks, 964 deterministic tests (web 730, database 38,
  integrations 111, gate 25, AI 56, cache 4), and both production builds. The
  web build generated 86 routes. The focused Apollo import contract passed
  3/3, formatting and `git diff --check` passed, and independent read-only
  review found no actionable defect.
- Reason: the hosted fixture correction changed source after `EVID-024`, so a
  complete deterministic gate was required before another push.
- Alternatives considered: inherit `EVID-024`; run only the focused contract;
  rely on the passing hosted verify and browser sub-jobs; call a live provider.
- Trade-offs: the 40-case PostgreSQL runtime file still requires CI's
  disposable database. This receipt does not cure or accept the upstream
  Postgres.js queued-write-after-close risk recorded in `GAP-019`.
- Evidence: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, focused
  import-contract run, formatter, `git diff --check`, exact source commit
  `0f3ac24ddd2645b4b03247ec720fe078406a0d15`, and clean independent review.
- Confidence/freshness: high for exact implementation source on 2026-09-02;
  hosted PostgreSQL confidence remains pending.
- Affected components: one Apollo PostgreSQL acceptance test file and source
  acceptance state; production code, migration, provider, and production
  resources are unchanged.
- Status: exact-current local implementation gate accepted; hosted, provider,
  deployment, recovery, user, and production acceptance remain open.
- Supersedes/superseded-by: supersedes
  `EVID-HRMNY-20260902-APOLLO-024` only as the current local-source receipt;
  none.
- Rollback/correction: any later implementation source edit invalidates this
  receipt and requires the complete deterministic gate again.

## `EVID-HRMNY-20260902-APOLLO-027` — exact-head hosted acceptance

- Decision/finding: exact evidence head
  `ca6408b2e50cc0ece42b5859770785d93bed8147` passed both independent hosted
  CI event paths. Each matrix passed the disposable migration verifier, Sales
  PostgreSQL proof, all 40 Apollo receipt/queue cases, repository lint,
  type-checking, deterministic tests, production builds, and Playwright browser
  acceptance.
- Reason: the fixture correction could be accepted only after the push and
  pull-request workflows independently exercised the same exact head and
  reached terminal success.
- Alternatives considered: accept only the database jobs; inherit the earlier
  successful browser/verify jobs; rely on local proof; call a live provider.
- Trade-offs: this closes synthetic hosted proof for Phase 4f but does not fix
  or accept the Postgres.js runtime dependency gap, merge the branch, deploy to
  production, contact Apollo, consume credit, verify recovery, or complete UAT.
- Evidence: push run
  <https://github.com/syedahmad0786/hrmny-os/actions/runs/33582006041>,
  database job `100098044556`, e2e job `100098044547`, verify job
  `100098044260`; pull-request run
  <https://github.com/syedahmad0786/hrmny-os/actions/runs/33582008378>,
  database job `100098051293`, e2e job `100098051528`, verify job
  `100098051432`; PR
  <https://github.com/syedahmad0786/hrmny-os/pull/246>.
- Confidence/freshness: high on 2026-09-02 for exact head `ca6408b` from two
  terminal hosted matrices.
- Affected components: migration `0076`, Sales PostgreSQL runtime proof, Apollo
  provider-lane serialization, full repository verification, and browser
  journeys; no live provider or production resource.
- Status: local and synthetic hosted source acceptance complete; merge,
  deployment, provider, destination, recovery, user, and production acceptance
  remain open.
- Supersedes/superseded-by: supersedes the hosted-pending part of
  `EVID-HRMNY-20260902-APOLLO-025/026`; none.
- Rollback/correction: any later implementation or acceptance-fixture source
  change invalidates this receipt and requires both hosted event matrices again.
