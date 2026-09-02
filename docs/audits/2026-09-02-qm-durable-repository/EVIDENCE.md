# Evidence

## Code boundary

- `packages/db/migrations/0077_qm_control_repository.sql` creates only `qm_session_binding` and `qm_command_decision`.
- `apps/web/src/server/qm/postgres-repository.ts` requires an injected PostgreSQL database, rechecks policy under a `FOR SHARE` lock, and atomically inserts or reads the existing decision.
- `apps/web/src/server/qm/server-adapter.ts` rejects portal/client sessions and requires an explicitly verified server authority object. It is not wired to a route.
- `apps/web/src/server/qm/postgres-repository.postgres-proof.ts` is limited by the existing CI database and network-denial gates.

## Local verification

| Check                      | Result                      |
| -------------------------- | --------------------------- |
| Focused QM tests           | 2 files, 19 tests passed    |
| Full web tests             | 134 files, 751 tests passed |
| Full database tests        | 7 files, 41 tests passed    |
| Web type check             | Passed                      |
| Database type check        | Passed                      |
| Targeted web/database lint | Passed                      |
| Production build           | Passed; 86 static pages     |
| Diff whitespace check      | Passed                      |

The final read-only security review found no P0/P1 issue and one P2 nullable-`CHECK` risk. Commit `ba4557b` closes it by making every JSON work-record branch explicitly `IS TRUE`, requiring a JSON object, and adding a raw malformed-insert rejection proof. The reviewer confirmed the finding resolved.

The local migration verifier was not run because it intentionally recreates and force-drops databases. The hosted database workflow uses a disposable Supabase PostgreSQL service with its explicit write/drop gates and will provide the runtime receipt after the branch is pushed.

## Safety receipt

- No provider account, credential, billing setting, deployment target, or live data was read or changed.
- No external effect, approval transition, or publication action exists in this slice.
- No merge was performed.
- The separate `hrmny-os-postgresjs-hardening-20260902` worktree and its user-owned changes were not touched.
