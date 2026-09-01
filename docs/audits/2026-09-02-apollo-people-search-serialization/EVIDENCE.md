# Evidence

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commit `fc2d288074bc44624abbb9e701b5c5ffa7adb775`; base
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
- Trade-offs: the default web suite excludes the 27-case PostgreSQL runtime
  file, so this is not database-runtime acceptance.
- Evidence: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, formatter
  check, `git diff --check`, exact migration-hash comparison, and a secret
  pattern scan over 24 implementation files. The only credential-shaped string
  was the existing localhost disposable-database fixture.
- Confidence/freshness: high on 2026-09-02.
- Affected components: all implementation files in commit `fc2d288`.
- Status: local source gate accepted; hosted database gate pending.
- Supersedes/superseded-by: will be supplemented, not replaced, by hosted
  evidence.
- Rollback/correction: any source change invalidates this exact-head receipt and
  requires the full gate again.

## `EVID-HRMNY-20260902-APOLLO-022` — adversarial review and loss modeling

- Decision/finding: independent read-only reviewers challenged provider-wide
  scope, revoke ordering, stale completion, actor/role loss, credential
  rotation, stale 401 handling, migration exactness, paid-operation leakage,
  and UI ambiguity. Final accepted diff had no remaining P0/P1/P2 code finding
  in the free-People-Search slice.
- Reason: concurrency and external-effect boundaries require adversarial races,
  not only line coverage.
- Alternatives considered: self-review only; allow reviewers to provision a
  provider or edit overlapping files.
- Trade-offs: review cannot replace the excluded PostgreSQL execution suite,
  provider readback, recovery drill, or UAT.
- Evidence: forced `pg_terminate_backend` test, concurrent independent-client
  claim tests, in-flight revoke case, exact actor/connection loss cases,
  Search-to-Match migration transition proof, and final SQL/hash/security
  re-review.
- Confidence/freshness: high for current source; hosted runtime pending.
- Affected components: runtime claimant, receipts, migration, connection fence,
  and operator copy.
- Status: read-only review accepted with documented residual gaps.
- Supersedes/superseded-by: none.
- Rollback/correction: reopen the exact finding and preserve failure history if
  hosted proof disagrees.

## `EVID-HRMNY-20260902-APOLLO-023` — hosted exact-head acceptance placeholder

- Decision/finding: no hosted receipt exists yet for this documentation head.
- Reason: the branch has not been pushed and no pull request exists at the time
  of this record.
- Alternatives considered: reuse a prior phase's CI; claim local proof as
  hosted.
- Trade-offs: `GAP-HRMNY-20260902-APOLLO-014` remains open.
- Evidence: none; pending push and both GitHub event matrices, disposable
  migration verification, 27-case PostgreSQL runtime suite, preview builds, and
  security review.
- Confidence/freshness: high that acceptance is absent on 2026-09-02.
- Affected components: source/CI/preview acceptance only.
- Status: planned, not tested.
- Supersedes/superseded-by: when populated, may narrowly supersede the local-open
  portion of prior free-search concurrency gaps; none now.
- Rollback/correction: do not change status without exact run/job/commit receipts.
