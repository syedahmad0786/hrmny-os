# Decisions

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

## `ADR-HRMNY-20260902-APOLLO-013` — serialize free People Search in PostgreSQL

- Decision/finding: reserve `provider:apollo` for
  `apollo_people_search`; permit one running database holder and one active
  provider dispatch across cron, Inngest, employees, and jobs. Use a short
  claim transaction plus a separate transaction-scoped advisory lock around
  final authorization and the bounded provider call.
- Reason: scheduler-local concurrency and per-receipt tokens cannot coordinate
  independent workers or recover safely after leases expire.
- Alternatives considered: Inngest concurrency alone; a browser mutex; one
  long row-locking transaction; Redis-only locking; treating all Apollo
  operations as the same accepted lane.
- Trade-offs: a bounded lock-only transaction remains open during the request;
  session loss can make the provider outcome ambiguous; paid Match is not
  covered.
- Evidence: `EVID-HRMNY-20260902-APOLLO-022/023/024`.
- Confidence/freshness: high for reviewed code and local deterministic proof on
  2026-09-02; hosted PostgreSQL execution pending.
- Affected components: scheduled jobs, cron, Inngest, Apollo receipt state,
  database runtime, migration `0076`, and Hunt status copy.
- Status: implemented and locally verified; hosted exact-head proof pending.
- Supersedes/superseded-by: intended to supersede the free-People-Search remedy
  in `GAP-HRMNY-20260831-APOLLO-010` and
  `GAP-HRMNY-20260901-APOLLO-013` only after hosted PostgreSQL proof; none.
- Rollback/correction: keep Apollo People Search closed, revert the runtime
  commit before production migration, or deploy a reviewed forward correction
  while preserving receipts and ambiguity markers.

## `ADR-HRMNY-20260902-APOLLO-014` — reauthorize the exact principal and credential at dispatch

- Decision/finding: after credential resolution and immediately before the
  provider request, revalidate the receipt owner, payload actor, active
  employee, allowed Sales role, exact staff Apollo connection, secret ID,
  expiry, `connection_account.xmin`, and the permitted
  `vault.decrypted_secrets.updated_at` revision. A stale 401/403 may disable
  only the exact connection and Vault revisions that dispatched it.
- Reason: enqueue-time approval and an ACTIVE connection do not authorize a
  delayed external operation after role removal, revocation, or key rotation.
- Alternatives considered: trust the queued actor ID; compare display email;
  validate only connection status; disable any connection after a stale 401.
- Trade-offs: `connection_account.xmin` and the Vault update timestamp are
  short-lived fail-closed revision fences rather than business identifiers.
  Direct Vault-only rotation is detected, but the governed connection workflow
  remains required for audit and status reconciliation. A tiny
  database-to-provider TOCTOU remains unavoidable.
- Evidence: `EVID-HRMNY-20260902-APOLLO-022/023/024`,
  `FAIL-HRMNY-20260902-APOLLO-022/023`, and the forced rotation, revocation,
  and stale-401 cases.
- Confidence/freshness: high for code and deterministic tests; production
  credential-rotation operations are not accepted.
- Affected components: employee authorization, connection accounts, Vault
  lookup, receipt state, and provider error reconciliation.
- Status: implemented and locally verified; operational acceptance open.
- Supersedes/superseded-by: extends Phase 4d principal binding; none.
- Rollback/correction: disable the provider lane and restore only after exact
  actor/connection denial and rotation tests pass; never weaken action-time
  checks to recover availability.

## `ADR-HRMNY-20260902-APOLLO-016` — rejected proposal: lock the permitted Vault view

- Decision/finding: the historical proposal was to read and lock the exact row through
  `vault.decrypted_secrets`, and compare its `updated_at` value as the
  in-place-rotation revision. Do not grant the application role direct access
  to `vault.secrets`.
- Reason: hosted CI proved that the runtime's supported Vault contract permits
  the decrypted view but rejects direct table reads. The official extension
  updates `updated_at` when `vault.update_secret` rotates a secret.
- Alternatives considered: broaden application privileges on
  `vault.secrets`; remove the rotation fence; compare only the stable secret
  ID; introduce an additional security-definer function before trying the
  supported view.
- Trade-offs: timestamp equality remains useful as a technical revision marker,
  but hosted PostgreSQL proved that the runtime role cannot request `FOR SHARE`
  through this view. The proposal is retained as rejected history rather than
  rewritten as if it had worked.
- Evidence: push run `33554283761`, database job `100011168058`; pull-request
  run `33554289195`, database job `100011185659`; official Supabase Vault
  repository/extension SQL; rejected correction `d1ab23c`.
- Confidence/freshness: high for the rejection on 2026-09-02 from identical
  hosted PostgreSQL failures.
- Affected components: owned key resolution, final Apollo dispatch, stale-auth
  reconciliation, Vault permissions, and PostgreSQL acceptance.
- Status: rejected; never operationally accepted.
- Supersedes/superseded-by: corrected the direct-table detail in
  `ADR-HRMNY-20260902-APOLLO-014`; superseded by
  `ADR-HRMNY-20260902-APOLLO-017`.
- Rollback/correction: do not restore either direct Vault-table access or a
  Vault-view row lock. Keep this record as failure provenance.

## `ADR-HRMNY-20260902-APOLLO-017` — serialize supported credential mutations without a privileged helper

- Decision/finding: the runtime role must not rely on row-lock privileges for
  Vault relations. Final authorization and stale-auth reconciliation read the
  exact owned connection and Vault revision in one statement while locking
  only `connection_account`. Governed Apollo save and disconnect acquire the
  same transaction advisory lane as provider dispatch, lock the exact owned
  connection, and atomically update or tombstone the Vault secret with the
  connection and audit receipt. The mutation fence covers canonical
  authorized/ambiguous states, legacy `providerMaySettle`, and a running
  processing pair with either required lease missing. Claims and final
  authorization use database timestamps and paired lease values; null safety
  leases fail closed.
- Reason: hosted CI proved both `vault.secrets` and row locking through
  `vault.decrypted_secrets` exceed the runtime grant. Supabase Vault exposes
  security-definer create/update functions but no delete function, while the
  operational database can safely serialize supported mutations without a new
  privileged helper.
- Alternatives considered: broaden Vault grants; add a security-definer helper;
  split Vault, connection, and audit writes across transactions; keep direct
  Vault-only rotation as supported; remove action-time revision checks.
- Trade-offs: supported rotation/disconnect can return a bounded five-second
  busy result while provider state is unsettled. Disconnect retains a random
  tombstone instead of deleting the Vault row. Missing projections, corrupt
  null leases, and unsupported privileged Vault-only edits require quiescence
  and operator correction rather than optimistic continuation.
- Evidence: source commit
  `8bce5127ef4c817789a3fe8ad3e10677bd9a9c82`; push run `33554283761`,
  database job `100011168058`; pull-request run `33554289195`, database job
  `100011185659`; official Supabase Vault extension SQL; the 40-case
  PostgreSQL proof; and three independent final reviews with no remaining
  P0–P2 finding.
- Confidence/freshness: high for exact source and local deterministic proof on
  2026-09-02; exact-head hosted PostgreSQL execution is pending.
- Affected components: connection settings, Vault access, Apollo dispatch,
  receipt settlement, leases, stale 401/403 reconciliation, tRPC connection
  status, and recovery.
- Status: implemented and locally verified; hosted and operational acceptance
  remain open.
- Supersedes/superseded-by: supersedes
  `ADR-HRMNY-20260902-APOLLO-016` and corrects the implementation detail in
  `ADR-HRMNY-20260902-APOLLO-014`; none.
- Rollback/correction: keep Apollo closed, preserve receipts and tombstones,
  revert the unmerged source commit, or correct forward under a new ADR. Never
  repair a runtime failure by granting broad Vault relation access.

## `ADR-HRMNY-20260902-APOLLO-015` — require a quiesced migration cutover

- Decision/finding: migration `0076` may run only from an exact reviewed
  `main` SHA after backup and zero-running/quiescence receipts. The workflow
  applies only the reviewed migration, reads it back, and leaves Apollo People
  Search closed for a separate new-runtime deployment and canary.
- Reason: the old `0075` revocation path can release a running row while its
  provider request settles, so a rolling mixed-runtime cutover is unsafe.
- Alternatives considered: rolling zero-downtime migration; automatic runtime
  deploy from the migration job; best-effort preflight without an in-transaction
  table lock.
- Trade-offs: a controlled maintenance window is required; migration success
  does not restore service automatically.
- Evidence: migration SHA
  `4941903ab873fabbb4a7359a83b95a48daee1df9eddae9ba38fa3cfb78bd68a7`,
  production guard tests, and manual workflow contract.
- Confidence/freshness: high for the source guard; no production execution.
- Affected components: Supabase migration journal, `scheduled_job`, GitHub
  Production environment, and Apollo runtime rollout.
- Status: documented and code-ready; unauthorized for production execution.
- Supersedes/superseded-by: none.
- Rollback/correction: keep workers quiesced, do not drop objects automatically,
  and use a separately reviewed forward migration or restore plan after backup
  verification.

## `ADR-HRMNY-20260902-APOLLO-018` — isolate Postgres.js connection-close hardening

- Decision/finding: preserve PR #246 as the bounded provider-slot slice and
  address the confirmed Postgres.js `3.4.9` queued-write-after-close defect in
  an immediate, separate dependency-hardening branch. Do not claim
  connection-loss recovery or production acceptance until that slice passes a
  child-process chaos proof and the current branch is revalidated as needed.
- Reason: the driver defect affects system-wide availability and deserves its
  own dependency patch, lockfile checksum, failure reproducer, and rollback;
  mixing it into the Apollo fixture correction would obscure both reviews.
- Alternatives considered: apply upstream PR #1168 directly in this PR;
  ignore the crash because test cleanup can avoid it; replace the database
  driver now; wait for upstream without a bounded mitigation.
- Trade-offs: a stacked follow-up adds one dependency-ready phase before
  recovery acceptance. In return, the current PR remains reviewable and the
  patch must prove query settlement and pool recovery rather than only
  suppressing a `TypeError`.
- Evidence: hosted runs `33578743186` and `33578745871`,
  `FAIL-HRMNY-20260902-APOLLO-025`, local dependency source, upstream issue
  <https://github.com/porsager/postgres/issues/1066>, upstream PR
  <https://github.com/porsager/postgres/pull/1168>, and independent
  architecture review.
- Confidence/freshness: high for scope and defect on 2026-09-02; remediation
  confidence remains pending.
- Affected components: dependency governance, PostgreSQL transactions, API and
  worker availability, failover, CI chaos proof, and production acceptance.
- Status: accepted architecture decision; follow-up implementation open under
  `GAP-HRMNY-20260902-APOLLO-019`.
- Supersedes/superseded-by: none.
- Rollback/correction: keep the provider closed, do not silently vendor an
  untracked patch, and remove any future consumer patch only after an official
  release passes the same exact reproducer and frozen-install proof.
