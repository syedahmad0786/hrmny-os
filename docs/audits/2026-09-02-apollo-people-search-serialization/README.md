# HRMNY Apollo People Search serialization

- Date: 2026-09-02 (work initiated 2026-09-01)
- Client/project: `client-uae-creative-01/hrmny-os`
- Actor signature: host `Bukhari-Laptop`; actor `Codex /root`; tool/model
  `Codex agent (exact model ID not exposed)`
- Branch: `ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`
- Stacked base: `8b672fd4e1ee2671d6919011e29b91886d706278`
- Implementation commits: `fc2d288074bc44624abbb9e701b5c5ffa7adb775`,
  `900bc0e548061b5b6872c3552b18ff8d1c309a6b`, and
  `d1ab23c36ebbde5320967f0d806251193919b1c6`
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
identity, connection-row version, and Vault update revision. An in-place Vault-only
rotation changes the permitted `vault.decrypted_secrets.updated_at` revision
and therefore invalidates both final dispatch and stale-auth-error
reconciliation without requiring the secret ID to change. Revocation and
terminalization share a receipt-before-job lock order. A worker that loses its
database session after dispatch authorization records an ambiguous durable
outcome; later success, role loss, or attempt-limit terminalization does not
erase that warning.

Migration `0076` assigns only `apollo_people_search` the reserved
`provider:apollo` key, clears that key when a job changes to another kind,
enforces the rule in both directions, and permits only one running holder. The
manual production workflow requires the exact reviewed `main` SHA, backup and
quiescence receipts, a direct or session-pooler port-5432 target with verified
TLS, and exact confirmation phrases. It deliberately leaves Apollo quiesced
after migration so the old runtime cannot be reopened accidentally.

This is bounded mutual exclusion, not an exactly-once provider guarantee.
Paid People Match is outside this lane and remains a separate P1 activation
gap. No live Apollo call, credit, production migration, deployment, message,
accounting write, or UAT occurred in this phase.

## Acceptance state

| State                | Result                                                          |
| -------------------- | --------------------------------------------------------------- |
| planned              | yes                                                             |
| documented           | yes                                                             |
| authorized           | source and synthetic local testing only                         |
| configured           | code and migration prepared; production unchanged               |
| tested               | local deterministic suites pass; corrected hosted proof pending |
| deployed             | initial previews only; corrected preview pending; production no |
| provider accepted    | no                                                              |
| destination verified | no                                                              |
| recovery verified    | no                                                              |
| user accepted        | no                                                              |
| production accepted  | no                                                              |

The corrected local proof passed repository-wide lint, type checking, 962
deterministic tests, and both production builds. The PostgreSQL
concurrency/runtime file now has 29 cases and requires the hosted CI database.
The first hosted matrices at `afc708a` failed one stale busy-window assertion
whose early exit retained the test lock, plus one stale browser-copy assertion.
The next matrices at `d1a137d` proved the browser correction but exposed that
the runtime role cannot query `vault.secrets` directly. Commit `d1ab23c` now
uses the already-permitted decrypted view and its official `updated_at`
revision without expanding Vault privileges. Every failure is permanently
recorded; fresh exact-head hosted PostgreSQL proof remains pending. Passing CI
or a preview will still not grant
provider, migration, deployment, recovery, user, or production acceptance.

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

## Package

- [Decisions](./DECISIONS.md)
- [Reasons](./REASONS.md)
- [Trade-offs](./TRADEOFFS.md)
- [Gaps](./GAPS.md)
- [Failures](./FAILURES.md)
- [Outcomes](./OUTCOMES.md)
- [Evidence](./EVIDENCE.md)
- [Runbooks](./RUNBOOKS.md)
