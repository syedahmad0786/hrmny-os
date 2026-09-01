# Decisions

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commits `fc2d288074bc44624abbb9e701b5c5ffa7adb775` and
`900bc0e548061b5b6872c3552b18ff8d1c309a6b`, plus correction
`d1ab23c36ebbde5320967f0d806251193919b1c6`; base
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
- Evidence: `EVID-HRMNY-20260902-APOLLO-021/022/023`,
  `FAIL-HRMNY-20260902-APOLLO-022`, and the forced rotation, revocation, and
  stale-401 cases.
- Confidence/freshness: high for code and deterministic tests; production
  credential-rotation operations are not accepted.
- Affected components: employee authorization, connection accounts, Vault
  lookup, receipt state, and provider error reconciliation.
- Status: implemented and locally verified; operational acceptance open.
- Supersedes/superseded-by: extends Phase 4d principal binding; none.
- Rollback/correction: disable the provider lane and restore only after exact
  actor/connection denial and rotation tests pass; never weaken action-time
  checks to recover availability.

## `ADR-HRMNY-20260902-APOLLO-016` — use the permitted Vault view as the rotation fence

- Decision/finding: read and lock the exact row through
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
- Trade-offs: timestamp equality is a technical revision marker, not a durable
  business version. Hosted PostgreSQL must still prove that `FOR SHARE` through
  the simple view locks the underlying row as intended.
- Evidence: push run `33552684634`, database job `100005748422`; pull-request
  run `33552691805`, database job `100005773724`; official Supabase Vault
  repository/extension SQL; correction `d1ab23c`.
- Confidence/freshness: high for the permission failure and official update
  behavior; pending exact-head hosted lock execution.
- Affected components: owned key resolution, final Apollo dispatch, stale-auth
  reconciliation, Vault permissions, and PostgreSQL acceptance.
- Status: implemented and locally verified; hosted exact-head proof pending.
- Supersedes/superseded-by: corrects the direct-table implementation detail in
  `ADR-HRMNY-20260902-APOLLO-014`; none.
- Rollback/correction: leave the lane closed if the view cannot carry the lock;
  then add a narrowly reviewed security-definer helper rather than granting
  broad Vault-table access.

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
