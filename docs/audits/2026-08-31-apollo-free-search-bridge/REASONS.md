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
