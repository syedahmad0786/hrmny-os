# HRMNY Apollo People Search serialization

- Date: 2026-09-02 (work initiated 2026-09-01)
- Client/project: `client-uae-creative-01/hrmny-os`
- Actor signature: host `Bukhari-Laptop`; actor `Codex /root`; tool/model
  `Codex agent (exact model ID not exposed)`
- Branch: `ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`
- Stacked base: `8b672fd4e1ee2671d6919011e29b91886d706278`
- Implementation commits: `fc2d288074bc44624abbb9e701b5c5ffa7adb775`,
  `900bc0e548061b5b6872c3552b18ff8d1c309a6b`,
  `d1ab23c36ebbde5320967f0d806251193919b1c6`, and no-helper correction
  `8bce5127ef4c817789a3fe8ad3e10677bd9a9c82`, plus fixture correction
  `0f3ac24ddd2645b4b03247ec720fe078406a0d15`
- Pull request: <https://github.com/syedahmad0786/hrmny-os/pull/246>
- Scope: free Apollo People Search scheduling, final dispatch authorization,
  credential fencing, receipts, migration `0076`, and operator status copy

## Outcome

Free Apollo People Search now has one database-owned provider lane across cron,
Inngest, employees, and jobs. A short claim transaction prevents multiple
running slot holders, while a separate transaction-scoped PostgreSQL advisory
lock covers final authorization and the bounded provider request. The provider
call does not retain ordinary application row locks.

Immediately before dispatch, HRMNY revalidates the exact active employee,
Sales role, receipt owner, connected staff-scoped Apollo account, Vault secret
identity, connection-row version, and Vault update revision in one database
snapshot. It locks only the operational `connection_account` row and reads the
permitted Vault projection without requesting row-lock privileges on any Vault
relation. Supported key rotation and disconnect use the same Apollo provider
lane, atomically update or tombstone the Vault secret with the connection and
audit receipt, and refuse to cross an authorized, ambiguous, legacy
may-settle, or unleased-processing dispatch. Direct privileged Vault-only edits
remain unsupported and require quiescence. Revocation and terminalization
share a receipt-before-job lock order. A worker that loses its database session
after dispatch authorization records an ambiguous durable outcome; later
success, role loss, or attempt-limit terminalization does not erase that
warning.

Migration `0076` assigns only `apollo_people_search` the reserved
`provider:apollo` key, clears that key when a job changes to another kind,
enforces the rule in both directions, and permits only one running holder. The
manual production workflow requires the exact reviewed `main` SHA, backup and
quiescence receipts, a direct or session-pooler port-5432 target with verified
TLS, and exact confirmation phrases. It deliberately leaves Apollo quiesced
after migration so the old runtime cannot be reopened accidentally.

This is bounded mutual exclusion, not an exactly-once provider guarantee.
Paid People Match is outside this lane and remains a separate P1 activation
gap. No live Apollo call, credit, production migration or deployment, message,
accounting write, or UAT occurred in this phase. Automated non-production PR
previews remained outside operational acceptance.

## Acceptance state

| State                | Result                                            |
| -------------------- | ------------------------------------------------- |
| planned              | yes                                               |
| documented           | yes                                               |
| authorized           | source plus synthetic local/hosted testing only   |
| configured           | code and migration prepared; production unchanged |
| tested               | local and both exact-head hosted CI matrices pass |
| deployed             | preview automation only; production unchanged     |
| provider accepted    | no                                                |
| destination verified | no                                                |
| recovery verified    | no                                                |
| user accepted        | no                                                |
| production accepted  | no                                                |

The exact-current local proof passed repository-wide lint, type checking, 964
deterministic tests, and both production builds; the web build exposes 86
routes. The PostgreSQL concurrency/runtime file now has 40 cases and requires
the hosted CI database.
The first hosted matrices at `afc708a` failed one stale busy-window assertion
whose early exit retained the test lock, plus one stale browser-copy assertion.
The next matrices at `d1a137d` proved the browser correction but exposed that
the runtime role cannot query `vault.secrets` directly. The third matrices at
`65748a1` then proved the runtime also cannot request `FOR SHARE` through
`vault.decrypted_secrets`. Commit `8bce512` removes Vault row locking, moves
supported credential mutations under the same Apollo lane, preserves atomic
Vault/connection/audit behavior, uses database-authoritative lease clocks, and
fails closed on missing Vault projections and unknown unleased processing.
The next exact-head matrices at `cd146c3` passed both browser and repository
verification jobs and reached 35/40 Apollo PostgreSQL cases after migration and
Sales database proof. They then exposed a stale host-clock assertion, fixture
cleanup that contradicted the append-only audit ledger, and a late
Postgres.js write-after-close error. Test-only correction `0f3ac24` now brackets
retry timing with database timestamps, preserves historical audit rows, and
deterministically disposes killed clients before using a fresh recovery client.
Its complete local gate passes. Exact evidence head `ca6408b` then passed both
hosted event matrices: push run `33582006041` and pull-request run
`33582008378`. Each passed migrations, Sales PostgreSQL proof, all 40 Apollo
cases, repository verification/build, and browser acceptance.

The Postgres.js `3.4.9` queued-write-after-close race remains an explicit P1
dependency gap. It will be handled in an isolated, checksummed consumer-patch
slice with a child-process chaos proof; test cleanup is not treated as a
runtime fix. Passing CI or a preview will still not grant provider, migration,
deployment, recovery, user, or production acceptance.

## Reviewed primary sources

- PostgreSQL explicit and advisory locking:
  <https://www.postgresql.org/docs/current/explicit-locking.html>
- PostgreSQL session timeout behavior:
  <https://www.postgresql.org/docs/current/runtime-config-client.html>
- PostgreSQL transaction advisory-lock functions:
  <https://www.postgresql.org/docs/current/functions-admin.html>
- Supabase Vault official repository and API behavior:
  <https://github.com/supabase/vault>
- Supabase Vault extension SQL (`decrypted_secrets` and `update_secret`):
  <https://github.com/supabase/vault/blob/main/sql/supabase_vault--0.3.0.sql>
- Postgres.js queued-write-after-close issue:
  <https://github.com/porsager/postgres/issues/1066>
- Postgres.js proposed null-socket guard (open and unmerged):
  <https://github.com/porsager/postgres/pull/1168>

## Package

- [Decisions](./DECISIONS.md)
- [Reasons](./REASONS.md)
- [Trade-offs](./TRADEOFFS.md)
- [Gaps](./GAPS.md)
- [Failures](./FAILURES.md)
- [Outcomes](./OUTCOMES.md)
- [Evidence](./EVIDENCE.md)
- [Runbooks](./RUNBOOKS.md)
