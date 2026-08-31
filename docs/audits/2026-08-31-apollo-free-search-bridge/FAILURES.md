# Failures

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`.

## `FAIL-HRMNY-20260831-APOLLO-001` — direct Windows Next transport timed out

- Decision/finding: all five focused browser cases timed out at initial
  navigation against the direct Next production server on port 3100.
- Reason: the Windows Next streaming transport reproduced the repository's
  known local pending-request behavior; product assertions were not reached.
- Alternatives considered: mark HTTP health as browser proof; remove the tests;
  change the operating system.
- Trade-offs: the checked-in Windows local bridge was required for trustworthy
  local browser proof.
- Evidence: five timeout receipts followed by bridge runs in
  `EVID-HRMNY-20260831-APOLLO-005`.
- Confidence/freshness: high for the local session; not evidence of production
  application failure.
- Affected components: local browser harness/transport.
- Status: preserved; product journeys later passed through the bridge.
- Supersedes/superseded-by: superseded for local product behavior by
  `EVID-HRMNY-20260831-APOLLO-005`, but retained as transport evidence.
- Rollback/correction: retain hosted Linux browser checks as authoritative and
  investigate Windows transport separately.

## `FAIL-HRMNY-20260831-APOLLO-002` — incomplete safe environment blocked fixture

- Decision/finding: the first bridge attempt passed four cases but the synthetic
  Apollo fixture case failed because `syntheticSalesFixtures` was false.
- Reason: the server was started without the complete documented safe synthetic
  environment.
- Alternatives considered: weaken the fixture gate; hard-code test mode.
- Trade-offs: explicit environment configuration adds setup, while preventing
  synthetic endpoints from appearing in an unsafe runtime.
- Evidence: failed 4/5 run; corrected 1/1 fixture run; final 5/5 run.
- Confidence/freshness: high.
- Affected components: local test server configuration.
- Status: corrected; no source gate weakened.
- Supersedes/superseded-by: superseded by the final complete safe-environment
  receipt.
- Rollback/correction: use the exact runbook environment and keep paid/provider
  modes disabled.

## `FAIL-HRMNY-20260831-APOLLO-003` — local PostgreSQL proof unavailable

- Decision/finding: the exact Supabase PostgreSQL migration/concurrency verifier
  could not run locally because Docker is unavailable on this host.
- Reason: the disposable database dependency was not present; production was
  not an acceptable substitute.
- Alternatives considered: exercise production; install/start a new billable or
  privileged service; claim unit tests as database proof.
- Trade-offs: the exact proof is deferred to hosted CI.
- Evidence: local environment audit and CI database job contract.
- Confidence/freshness: high.
- Affected components: migration 0075 and PostgreSQL concurrency proof.
- Status: open until hosted job passes.
- Supersedes/superseded-by: none.
- Rollback/correction: use the disposable hosted service, retain the database
  only through its proof step, and never point this test at production.

## `FAIL-HRMNY-20260831-APOLLO-004` — legacy pathways violated current boundary

- Decision/finding: review found a Research Console direct live-call bypass and
  a paid-match path dependent on generic confirmation/caller candidate data.
- Reason: older implementation assumptions predated the durable effect and
  exact-candidate approval requirements.
- Alternatives considered: document the bypass; leave paid UI hidden; rely on
  operator discipline.
- Trade-offs: the bypass is now disabled and paid matching is unavailable until
  a new approval slice exists.
- Evidence: remediated source and two independent reviews with no remaining
  P0/P1 in scope.
- Confidence/freshness: high on the implementation commit.
- Affected components: Research Console, enrichment service, paid People Match.
- Status: corrected in code; live acceptance remains absent.
- Supersedes/superseded-by: superseded by
  `ADR-HRMNY-20260831-APOLLO-001/004`.
- Rollback/correction: never restore direct provider calls or generic paid
  confirmations; correct through the shared bridge/effect broker.

No failed path called a live provider, consumed a credit, sent a message,
migrated production, deployed a revision, changed an account, or wrote Xero.

## `FAIL-HRMNY-20260831-APOLLO-005` — credentialed redirects could expose a key

- Decision/finding: pre-landing review reproduced Node forwarding `X-Api-Key`
  across a cross-origin 302 because both Apollo fetches used the default redirect
  policy.
- Reason: the transport attached an employee-scoped credential without
  constraining redirect behavior.
- Alternatives considered: accept the risk because Apollo is trusted; repair
  only the currently callable free-search path.
- Trade-offs: both free and locked paid paths now fail closed on every redirect.
- Evidence: reproduction, commit `d66be9d`, 15/15 adapter tests, lint,
  typecheck, and independent closure review.
- Confidence/freshness: high as of 2026-08-31.
- Affected components: Apollo adapter and personal provider credential.
- Status: corrected before push; no live credential or provider was used.
- Supersedes/superseded-by: superseded by
  `ADR-HRMNY-20260831-APOLLO-008`; none.
- Rollback/correction: preserve `redirect: "error"` and its regression
  assertions in every forward transport change.

## `FAIL-HRMNY-20260831-APOLLO-006` — sibling CI proofs conflicted

- Decision/finding: the Apollo and Phase 4c sibling branches both edited the
  database job and claimed `test:ci:postgres`; without Phase 4c, Apollo's hosted
  proof would also require TLS against a plaintext loopback service and fail
  before its tests.
- Reason: the branch started from their common product base instead of the
  already proven PostgreSQL proof branch.
- Alternatives considered: publish an expected-red branch; replace the older
  proof; copy its TLS exception into a sibling.
- Trade-offs: Phase 4d now stacks on Phase 4c, retains both proof commands, and
  inherits one fail-closed connection policy.
- Evidence: Phase 4c failure/correction receipts, merge `a343a51`, distinct CI
  commands, and setup-module fix `a6ed4e3`.
- Confidence/freshness: high locally; hosted execution pending.
- Affected components: CI database job, web test setup, database TLS policy.
- Status: source conflict corrected; exact-SHA hosted proof remains open.
- Supersedes/superseded-by: superseded by
  `ADR-HRMNY-20260831-APOLLO-009`; none.
- Rollback/correction: preserve the Phase 4c dependency or an equivalent landed
  policy and keep Apollo's database/name/write gates distinct.

The additional failures above also caused no live provider call, credit, send,
production migration, deployment, account change, or Xero write.

## `FAIL-HRMNY-20260831-APOLLO-007` — public diff contained credential-shaped fixtures

- Decision/finding: the public-repository redaction gate classified synthetic
  embedded-password PostgreSQL URLs as high-severity findings even though every
  value was a loopback CI or contract-test fixture.
- Reason: a literal credential-shaped URL is indistinguishable from a real
  secret to a safe static scanner and creates avoidable review ambiguity.
- Alternatives considered: waive the high findings; disclose literal values in
  review evidence; remove the database tests.
- Trade-offs: CI now assembles the loopback URL from named synthetic fields and
  contract tests use a helper, preserving behavior while eliminating literal
  embedded-password patterns.
- Evidence: public-diff redaction scan changed from 13 high findings on added
  lines to zero; database 30/30, lint, typecheck, YAML parse, and diff check pass.
- Confidence/freshness: high locally as of 2026-08-31.
- Affected components: CI Apollo proof, production-migration contract tests,
  public review hygiene.
- Status: corrected before push.
- Supersedes/superseded-by: none.
- Rollback/correction: keep test credentials synthetic and constructed; never
  waive a high finding without target-by-target proof.

## `FAIL-HRMNY-20260831-APOLLO-008` — runtime contract treated a fail-fast stub as a Node workflow

- Decision/finding: both initial hosted verify jobs failed because the Node 24
  contract still expected the retired, dependency-free migration refusal stub
  to configure Node, while omitting the new executable 0075 workflow.
- Reason: the workflow inventory was not reconciled when the old runner became
  a bash-only refusal path and the reviewed replacement was added.
- Alternatives considered: add an unnecessary setup-node step or a matching
  comment to the refusal stub; weaken the repository runtime contract.
- Trade-offs: the test now enumerates the real Node workflow and separately
  proves the old runner exits without Node, package, database, or secret access.
- Evidence: failed verify jobs in GitHub Actions runs `33412756597` and
  `33412781344`; corrected AI tests 56/56.
- Confidence/freshness: high locally; corrected hosted receipt pending.
- Affected components: runtime contract and production migration workflow
  inventory.
- Status: corrected locally before the next push.
- Supersedes/superseded-by: none.
- Rollback/correction: keep executable and refusal workflows in separate test
  lists; never satisfy the contract with a comment-only pin.

## `FAIL-HRMNY-20260831-APOLLO-009` — PostgreSQL rejected a smallint catalog argument

- Decision/finding: both initial hosted database jobs reached the disposable
  Supabase PostgreSQL service, applied migrations, and then failed discovery
  because the query assumed an undocumented three-argument
  `pg_catalog.get_attname` overload.
- Reason: static/unit checks did not execute the catalog query and local Docker
  was unavailable; the hosted runtime exposed the exact function boundary.
- Alternatives considered: cast the function result or compare only constraint
  names; remove exact column readback.
- Trade-offs: the first bounded repair cast the attribute number to integer, but
  the second hosted run proved that no three-argument overload exists.
- Evidence: failed database jobs in GitHub Actions runs `33412756597` and
  `33412781344`, followed by the same function-resolution failure with an
  integer argument in run `33413605732`.
- Confidence/freshness: high for the failure; the first correction was incomplete.
- Affected components: migration 0075 schema discovery and hosted verifier.
- Status: first repair superseded; no production or provider effect occurred.
- Supersedes/superseded-by: superseded by
  `FAIL-HRMNY-20260831-APOLLO-010` and `ADR-HRMNY-20260831-APOLLO-010`.
- Rollback/correction: use documented catalog joins and require the disposable
  PostgreSQL job for every discovery-query change.

## `FAIL-HRMNY-20260831-APOLLO-010` — undocumented catalog helper had no compatible overload

- Decision/finding: the second hosted database run rejected
  `get_attname(oid, integer, boolean)`, proving the helper itself—not only the
  integer width—was the wrong portability boundary.
- Reason: an internal/undocumented helper was used where documented
  `pg_attribute` and `pg_constraint` catalogs provide the exact relationship.
- Alternatives considered: try a two-argument overload; dynamically probe
  function signatures; compare only constraint names.
- Trade-offs: explicit catalog joins are longer but directly verify local and
  foreign column names without depending on an undocumented helper.
- Evidence: GitHub Actions run `33413605732`, official PostgreSQL 17 catalog
  documentation/source, and zero remaining `get_attname` uses in both discovery
  and the production guard.
- Confidence/freshness: high locally; corrected hosted execution pending.
- Affected components: migration verifier and protected production readback.
- Status: corrected locally; exact-head hosted proof pending.
- Supersedes/superseded-by: supersedes the repair claim in
  `FAIL-HRMNY-20260831-APOLLO-009`; none.
- Rollback/correction: retain documented joins and validate the same query in
  the disposable Supabase PostgreSQL image before production consideration.

## `FAIL-HRMNY-20260831-APOLLO-011` — disposable proof required a production-only identity

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
  `ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; failing head
  `6828a1a16c6c38592f81200419645dddf85e2279`; repair commit
  `2b62db13ea29b32f6a3a9eba850c285a596f6f3c`.
- Decision/finding: both third-run database jobs proved all nine 0075 columns,
  three foreign keys, two indexes, two secured tables, and zero backfill
  violations, then failed only because the fresh repository database did not
  claim the reconciled production legacy identity.
- Reason: `priorContractReady` includes historical production-only
  `health_signal.delivery_status` and `employee_role_employee_role_uniq`, while
  canonical migrations define `health_signal.notified_at` and
  `employee_role_uniq`.
- Alternatives considered: weaken or rename production objects; rewrite the
  immutable bootstrap; treat the failure as migration-0075 schema drift.
- Trade-offs: the disposable verifier now proves canonical migration behavior
  separately; production identity remains fail-closed and unexecuted.
- Evidence: push run `33414276233` / database job `99561088496`; PR run
  `33414282467` / database job `99561108215`; both verify and both 90-test
  browser jobs passed on the same failing head.
- Confidence/freshness: high; independently reproduced by three read-only
  reviews.
- Affected components: `packages/db/src/verify-migrations.ts` and hosted
  migration proof.
- Status: corrected locally; exact-head hosted execution pending; no production
  or provider effect occurred.
- Supersedes/superseded-by: refines the next failure boundary after
  `FAIL-HRMNY-20260831-APOLLO-010`; none.
- Rollback/correction: preserve production validation unchanged, require the
  canonical disposable assertion, and rerun both GitHub event matrices.

## `FAIL-HRMNY-20260831-APOLLO-012` — 0074 preflight fixture used an invalid receipt state

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
  `ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; failing head
  `07d9917008d8eb16f5abdf07c153abe852fadb0e`; repair commit
  `8a6ed2cbdbbd3727b7940cf0c3d23d66021fdc11`.
- Decision/finding: both fourth-run database jobs advanced through the repaired
  fresh-schema assertion, then the exact-0074 upgrade preflight rejected its
  synthetic receipt because the fixture requested status `pending`.
- Reason: migration 0074's enforced receipt states are `received`, `processing`,
  `completed`, and `failed`; the durable bridge begins a receipt at `received`.
- Alternatives considered: weaken the check constraint; omit status and rely on
  the same default implicitly; skip the safe-backfill fixture.
- Trade-offs: the explicit fixture now documents the real pre-migration state
  without changing schema or runtime behavior.
- Evidence: push run `33416638313` / database job `99568753091`; PR run
  `33416642940` / database job `99568768913`; PostgreSQL error `23514` named
  `integration_inbox_status_check` in both.
- Confidence/freshness: high; both event receipts and checked-in 0074 SQL agree.
- Affected components: exact-0074 disposable preflight fixture only.
- Status: corrected locally; hosted repair receipt pending; no production or
  provider effect occurred.
- Supersedes/superseded-by: follows `FAIL-HRMNY-20260831-APOLLO-011`; none.
- Rollback/correction: keep the fixture on an allowed 0074 state and require the
  hosted upgrade path to reach the later database proofs.
