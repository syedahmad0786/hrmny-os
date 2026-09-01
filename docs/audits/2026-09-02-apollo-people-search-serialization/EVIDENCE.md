# Evidence

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commits `fc2d288074bc44624abbb9e701b5c5ffa7adb775` and
`900bc0e548061b5b6872c3552b18ff8d1c309a6b`; base
`8b672fd4e1ee2671d6919011e29b91886d706278`.

## `EVID-HRMNY-20260902-APOLLO-021` — deterministic local source gate

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
- Affected components: all implementation files in commits `fc2d288` and
  `900bc0e`.
- Status: local source gate accepted; hosted database gate pending.
- Supersedes/superseded-by: will be supplemented, not replaced, by hosted
  evidence.
- Rollback/correction: any source change invalidates this exact-head receipt and
  requires the full gate again.

## `EVID-HRMNY-20260902-APOLLO-022` — adversarial review and loss modeling

- Decision/finding: independent read-only reviewers challenged provider-wide
  scope, revoke ordering, stale completion, actor/role loss, credential
  rotation, stale 401 handling, migration exactness, paid-operation leakage,
  and UI ambiguity. They found an in-place Vault-rotation fence gap and two
  terminal paths that could drop prior ambiguity. Commit `900bc0e` added the
  Vault-row version fence and preserved ambiguity. Final re-audit found no
  remaining P0/P1/P2 code defect in the corrected free-People-Search slice.
- Reason: concurrency and external-effect boundaries require adversarial races,
  not only line coverage.
- Alternatives considered: self-review only; allow reviewers to provision a
  provider or edit overlapping files.
- Trade-offs: review cannot replace the excluded PostgreSQL execution suite,
  provider readback, recovery drill, or UAT.
- Evidence: forced `pg_terminate_backend` test, concurrent independent-client
  claim tests, in-flight revoke case, exact actor/connection/Vault loss cases,
  stale 401 after Vault-only rotation, role-loss and attempt-limit ambiguity
  preservation, Search-to-Match migration transition proof, and final
  SQL/hash/security re-review.
- Confidence/freshness: high for current source; hosted runtime pending.
- Affected components: runtime claimant, receipts, migration, connection fence,
  and operator copy.
- Status: read-only review accepted with documented residual gaps.
- Supersedes/superseded-by: none.
- Rollback/correction: reopen the exact finding and preserve failure history if
  hosted proof disagrees.

## `EVID-HRMNY-20260902-APOLLO-023` — initial hosted matrices failed honestly

- Decision/finding: both hosted matrices for initial head
  `afc708a078eb72de98200195e8faed03fb51ca90` failed and are not accepted. The
  verify jobs, migration verification/application, Sales PostgreSQL proof,
  previews, and security review passed. Apollo PostgreSQL proof and one browser
  assertion failed.
- Reason: the first concurrency test expected the obsolete ten-minute lease
  retry rather than the bounded five-second busy retry. Its assertion exited
  before releasing the first provider promise, so the open advisory transaction
  caused 24 cascading busy results. The browser test still expected the old
  `reconciled from receipt` wording after status copy changed to identify the
  current attempt and receipt explicitly.
- Alternatives considered: rerun the same head; hide cascade failures; reuse
  successful verify/preview checks as whole-matrix acceptance.
- Trade-offs: the failed evidence remains permanent, while corrected head
  `900bc0e548061b5b6872c3552b18ff8d1c309a6b` requires fresh hosted matrices.
- Evidence: push run `33549333254`, database job `99994613400`, e2e job
  `99994613933`, verify job `99994613796`; pull-request run `33549371235`,
  database job `99994746031`, e2e job `99994746036`, verify job
  `99994745678`; PR <https://github.com/syedahmad0786/hrmny-os/pull/246>.
- Confidence/freshness: high on 2026-09-02.
- Affected components: hosted PostgreSQL proof, browser acceptance, and source
  acceptance state; no provider or production resource.
- Status: initial head tested and failed; corrections locally verified and not
  yet hosted.
- Supersedes/superseded-by: does not supersede an acceptance receipt; a later
  exact-head hosted receipt must supplement it.
- Rollback/correction: keep the PR unmerged and production unchanged; require
  both corrected push and pull-request matrices before source acceptance.
