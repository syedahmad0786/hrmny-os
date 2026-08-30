# Runbooks

Common scope/date/actor for every record: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; supervisor
`Codex /root`; tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-2-portal-approval-boundary-20260830`; implementation
commit `b2fea0bc9ae94e38595841783e177065a9a378d7`.

## `RUNBOOK-HRMNY-20260830-PORTAL-001` — verify the authority boundary

- Decision/finding: run focused authority tests, full `pnpm test`, `pnpm lint`,
  `pnpm typecheck`, `pnpm build`, diff/credential hygiene, independent review,
  and hosted Linux browser CI.
- Reason: combine direct behavior, regression, static, compile, adversarial, and
  visible UI gates.
- Alternatives considered: accept from one unit test.
- Trade-offs: additional execution time and staged evidence.
- Evidence: `EVID-HRMNY-20260830-PORTAL-002` through `-008`.
- Confidence/freshness: high for local gates; CI pending.
- Affected components: entire slice.
- Status: local portion executed; hosted Linux pending.
- Supersedes/superseded-by: none.
- Rollback/correction: stop the release on any failure and record the exact
  receipt.

## `RUNBOOK-HRMNY-20260830-PORTAL-002` — investigate a denied decision

- Decision/finding: treat `CLIENT_PORTAL_ACTOR_REQUIRED` and
  `PORTAL_IDENTITY_NOT_BOUND` as intentional fail-closed outcomes; inspect the
  verified principal, permission, client scope, active canonical user, and
  session binding without bypassing the service guard.
- Reason: operational pressure must not turn staff/agent identity into client
  authority.
- Alternatives considered: retry through staff preview or the legacy AI tool.
- Trade-offs: a client may remain unable to decide if canonical data is missing,
  duplicated, inactive, or the hosted session path is not accepted.
- Evidence: boundary/service tests and hosted-session gap.
- Confidence/freshness: high.
- Affected components: portal support and approvals.
- Status: active containment runbook.
- Supersedes/superseded-by: none.
- Rollback/correction: correct canonical identity/session state; never edit an
  approval directly or impersonate the client.

## `RUNBOOK-HRMNY-20260830-PORTAL-003` — rollback

- Decision/finding: no data rollback is required because this slice introduces
  no migration and performs no live mutation. Prefer a forward fix. A reviewed
  code revert may target only `b2fea0bc9ae94e38595841783e177065a9a378d7`
  while retaining
  an equivalent staff/AI denial boundary.
- Reason: reverting without replacement would restore client impersonation.
- Alternatives considered: direct production edits; delete approval history;
  restore old behavior wholesale.
- Trade-offs: a conventional revert cannot be promoted until containment is
  restored.
- Evidence: implementation commit and no-migration/no-live receipts.
- Confidence/freshness: high.
- Affected components: source release only.
- Status: documented; not executed.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve portal records and audit history. Synthetic
  fixtures may run only in exact dev+memory+sandbox. Re-enablement requires a
  superseding ADR plus identity, isolation, audit, browser, and named-user proof.

## `RUNBOOK-HRMNY-20260830-PORTAL-004` — advance acceptance states

- Decision/finding: after a green stacked PR, prove the implemented canonical
  session path and campaign transaction against isolated hosted dependencies
  before any deployment promotion; then progress separately through recovery,
  named-employee/client UAT, and production acceptance.
- Reason: code and CI do not imply external operational acceptance.
- Alternatives considered: collapse all states into “done.”
- Trade-offs: more explicit checkpoints and smaller releases.
- Evidence: gap register and acceptance-state table.
- Confidence/freshness: high.
- Affected components: portal release governance.
- Status: pending; no live authority is granted by this runbook.
- Supersedes/superseded-by: none.
- Rollback/correction: stop at the first failed state and preserve receipts.

## `RUNBOOK-HRMNY-20260830-PORTAL-005` — recover a pending campaign projection

- Decision/finding: verify the terminal item body contains the same action,
  normalized feedback, portal user, decision time, and audit ID as the pending
  `portal.campaign.decision:<item-id>` intent. Re-submit only the exact same
  decision to re-drive the locked projector; never submit an opposite action or
  changed feedback as recovery.
- Reason: exact replay is the current bounded recovery trigger and preserves
  the first client decision.
- Alternatives considered: edit state/outbox directly; fabricate a replacement
  audit; use staff/AI approval.
- Trade-offs: unattended retry/dead-letter remains an explicit gap.
- Evidence: projector failure/replay and conflict tests.
- Confidence/freshness: high for current implementation.
- Affected components: campaign decision receipt, outbox, feedback and staff
  notification.
- Status: locally tested; operational worker/reconciliation pending.
- Supersedes/superseded-by: none.
- Rollback/correction: if receipt fields disagree, stop and preserve evidence;
  do not mutate the terminal decision outside an approved correction procedure.
