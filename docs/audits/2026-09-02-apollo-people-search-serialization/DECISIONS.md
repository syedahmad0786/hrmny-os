# Decisions

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commit `fc2d288074bc44624abbb9e701b5c5ffa7adb775`; base
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
- Evidence: `EVID-HRMNY-20260902-APOLLO-021/022/023`.
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
  expiry, and `connection_account.xmin`. A stale 401/403 may disable only the
  exact connection version that dispatched it.
- Reason: enqueue-time approval and an ACTIVE connection do not authorize a
  delayed external operation after role removal, revocation, or key rotation.
- Alternatives considered: trust the queued actor ID; compare display email;
  validate only connection status; disable any connection after a stale 401.
- Trade-offs: `xmin` is a short-lived fail-closed version fence rather than a
  business identifier; direct Vault administration must also touch the
  connection row; a tiny database-to-provider TOCTOU remains unavoidable.
- Evidence: `EVID-HRMNY-20260902-APOLLO-021/022` and the forced rotation,
  revocation, and stale-401 cases.
- Confidence/freshness: high for code and deterministic tests; production
  credential-rotation operations are not accepted.
- Affected components: employee authorization, connection accounts, Vault
  lookup, receipt state, and provider error reconciliation.
- Status: implemented and locally verified; operational acceptance open.
- Supersedes/superseded-by: extends Phase 4d principal binding; none.
- Rollback/correction: disable the provider lane and restore only after exact
  actor/connection denial and rotation tests pass; never weaken action-time
  checks to recover availability.

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
