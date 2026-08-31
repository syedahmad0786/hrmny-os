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
