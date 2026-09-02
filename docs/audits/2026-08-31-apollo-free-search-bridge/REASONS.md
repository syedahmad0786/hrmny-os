# Reasons

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`.

## `REASON-HRMNY-20260831-APOLLO-001` — receipt and job are one transaction

- Decision/finding: the accepted request must never exist without its job, and
  the job must never exist without its immutable request identity.
- Reason: partial persistence creates lost work or an unauditable effect.
- Alternatives considered: insert then enqueue; best-effort repair; browser
  resubmission.
- Trade-offs: the store API is stricter and requires transactional support.
- Evidence: atomic-create and idempotency tests; `ADR-HRMNY-20260831-APOLLO-001`.
- Confidence/freshness: high for memory and source contracts; disposable
  PostgreSQL exact-SHA proof pending.
- Affected components: integration inbox, jobs, Sales service.
- Status: implemented and locally tested.
- Supersedes/superseded-by: none.
- Rollback/correction: reject the request if either record cannot commit.

## `REASON-HRMNY-20260831-APOLLO-002` — revocation wins over queued work

- Decision/finding: provider 401/403 or administrator revocation marks only the
  exact owner's connection unavailable and prevents a stale queued attempt from
  publishing success.
- Reason: connection discovery is not enduring authorization, and one user's
  failure must not revoke another user's connection.
- Alternatives considered: retry unauthorized responses; disable Apollo
  tenant-wide; treat enqueue-time state as final.
- Trade-offs: the user must reconnect before retrying legitimate work.
- Evidence: connection isolation and revoke-race tests.
- Confidence/freshness: high locally.
- Affected components: worker, Vault resolver, connected-app state, UI status.
- Status: implemented; live revocation acceptance pending.
- Supersedes/superseded-by: none.
- Rollback/correction: reconcile the exact connection and issue a new request;
  never recycle the old attempt token.

## `REASON-HRMNY-20260831-APOLLO-003` — errors are classified, not guessed

- Decision/finding: retry only typed transport/provider-transient failures;
  programming errors remain visible and lease-recoverable, while terminal
  policy or authorization failures do not call Apollo again.
- Reason: broad retries can repeat effects and hide defects.
- Alternatives considered: retry every exception; retry no failures; convert
  all `TypeError` instances into network errors.
- Trade-offs: unknown defects require operator correction rather than automatic
  recovery.
- Evidence: typed adapter and worker failure tests.
- Confidence/freshness: high for enumerated cases.
- Affected components: Apollo adapter, worker, cron health signal, dead letter.
- Status: implemented; live rate-limit behavior pending.
- Supersedes/superseded-by: none.
- Rollback/correction: add a reviewed typed category and fixture before making
  it retryable.

## `REASON-HRMNY-20260831-APOLLO-004` — historical receipts do not accept new code

- Decision/finding: the current UI reports the durable bridge as unaccepted
  until its own request, worker, provider readback, and destination receipt are
  proven on the deployed revision.
- Reason: the 2026-08-27 zero-credit result exercised an older direct pathway.
- Alternatives considered: inherit provider acceptance from operation name;
  display global Apollo readiness as user readiness.
- Trade-offs: the UI remains conservative after a successful historical
  provider call.
- Evidence: prior audit receipt and current status contracts.
- Confidence/freshness: high.
- Affected components: Hunt UI, acceptance evidence, connection status.
- Status: implemented.
- Supersedes/superseded-by: corrects the scope of older acceptance claims; none.
- Rollback/correction: retain revision-bound receipt identity in every future
  acceptance record.

## `REASON-HRMNY-20260831-APOLLO-005` — redirects are an authentication boundary

- Decision/finding: a credentialed provider call treats every redirect as an
  error before a second network request can be made.
- Reason: redirect following changes the destination after authorization and
  can expose an employee's provider key outside the reviewed origin.
- Alternatives considered: rely on provider reputation; inspect only the final
  URL; allow redirects in paid code because that path is currently locked.
- Trade-offs: fail-closed behavior may surface a provider routing change, which
  is preferable to silent credential disclosure.
- Evidence: `ADR-HRMNY-20260831-APOLLO-008` and commit `d66be9d`.
- Confidence/freshness: high.
- Affected components: Apollo transport and employee connection isolation.
- Status: implemented.
- Supersedes/superseded-by: none.
- Rollback/correction: review a new destination and authorization model before
  permitting any redirect.

## `REASON-HRMNY-20260831-APOLLO-006` — reuse the proven CI database boundary

- Decision/finding: Phase 4c's loopback-only plaintext exception is inherited
  instead of recreated, and Apollo retains a separate proof command/database.
- Reason: one shared, narrowly gated transport policy prevents drift while
  distinct commands keep each acceptance receipt attributable.
- Alternatives considered: separate SSL implementations; one combined opaque
  database test; production database proof.
- Trade-offs: this slice cannot publish independently of Phase 4c.
- Evidence: `ADR-HRMNY-20260831-APOLLO-009` and the merged CI job.
- Confidence/freshness: high locally.
- Affected components: CI, PostgreSQL connection policy, proof attribution.
- Status: implemented; hosted execution pending.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve both fail-closed setup modules and commands if
  the stack is reordered.

## `REASON-HRMNY-20260831-APOLLO-007` — database identity is not schema compatibility

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
  `ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; commit
  `2b62db13ea29b32f6a3a9eba850c285a596f6f3c`.
- Decision/finding: canonical migration compatibility and the reconciled
  production legacy identity are asserted separately.
- Reason: matching 0075 objects proves the change can apply safely to the
  repository chain; it does not prove that a database is Harmony production or
  owns its immutable legacy journal.
- Alternatives considered: use one boolean as both identity and compatibility;
  accept multiple production identities.
- Trade-offs: production preflight remains an additional checkpoint.
- Evidence: `ADR-HRMNY-20260831-APOLLO-011` and hosted failure receipts.
- Confidence/freshness: high.
- Affected components: migration verification and release authority.
- Status: active.
- Supersedes/superseded-by: none.
- Rollback/correction: reunify the assertions only after a reviewed production
  baseline migration and new recovery receipt.
