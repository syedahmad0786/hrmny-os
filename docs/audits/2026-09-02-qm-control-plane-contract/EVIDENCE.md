# Evidence

## Immutable code receipt

- Commit: `42ed013a91ab5129e93195f9906b6635d45cda74`
- Message: `feat(qm): add fail-closed control-plane contract`
- Parent/base: `d949461bf0ab47f2f07978a6ebdd2d2e448000aa`
- Files: six files under `apps/web/src/server/qm/`

## Verification receipts

All commands were run in the isolated worktree with database, Supabase, Apollo, Fly, and live-proof environment inputs cleared.

| Check                      | Result                             |
| -------------------------- | ---------------------------------- |
| Focused QM tests           | 2 files passed, 15 tests passed    |
| Web type check             | Passed                             |
| Targeted QM ESLint         | Passed                             |
| Prettier                   | Passed                             |
| Full web tests             | 133 files passed, 745 tests passed |
| Next.js production build   | Passed; 86 static pages generated  |
| Diff whitespace validation | Passed                             |

The build emitted the repository's existing warning that the Next.js plugin is not detected in the ESLint configuration. Compilation, type validation, page generation, and build completion all succeeded.

## Behaviors exercised

- Trusted-principal ownership and organization binding
- Personal-scope validation and default-deny capability grants
- Strict rejection of caller identity, arbitrary payloads, credentials, and direct-effect commands
- Read-precheck semantics with repository scope resolution still required
- Digest-only effect proposals
- Generic non-enumerating denials
- Idempotent replay and request-payload conflict
- Replay invalidation after revocation and capability removal
- Session-policy change conflict
- Provider readback field requirement
- In-memory atomic-boundary concurrency contract
- Request-ID namespace by trusted organization and employee

## Explicitly absent evidence

No live database, QM process, Fly resource, private network, external provider, destination delivery, credential, deployment, failure injection, recovery drill, UAT session, merge, or production change was used to obtain these results.
