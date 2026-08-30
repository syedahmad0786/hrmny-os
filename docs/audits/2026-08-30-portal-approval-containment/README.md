# HRMNY portal approval-containment slice

- Date: 2026-08-30
- Client/project: `client-uae-creative-01/hrmny-os`
- Branch: `ahmadbukhari097/codex/phase-2-portal-approval-boundary-20260830`
- Phase 1 dependency: `06d5df9826434dbed83d214103fc7eb6e7950f13` / PR #238
- Implementation commit: `b2fea0bc9ae94e38595841783e177065a9a378d7`
- Browser-contract correction: `3d4213a293e6f088018086c08f9f6d2d6c1ff264`

## Outcome

Client approval decisions now require an authenticated portal actor, the
`portal:approve` permission, the same client scope, and an active canonical
portal-user record checked again inside the database transaction. Staff preview
is read-only. Magic-link grants resolve to exactly one active canonical portal
user and are re-resolved on every request, so local deactivation revokes the
session. The former AI/Chat approval capability and stale aliases are inert,
including wildcard allowlists. Generic client-scoped agents and client Chat are
structurally read-only; deliberate draft work uses typed, fixed-allowlist server
commands. Campaign decisions persist explicit client attribution, an audit ID,
and a durable projection intent in the same locked transaction. Exact retries
reconcile rather than duplicate effects, while conflicting decisions fail
closed.

The first stacked-PR browser run passed 73 of 77 journeys and correctly exposed
four inherited specifications that still expected the removed Chat/custom-agent
effect path. Commit `3d4213a293e6f088018086c08f9f6d2d6c1ff264`
aligns the visible language and those tests with the enforced read-only
boundary. Hosted rerun acceptance remains pending and is tracked separately.

This is a containment slice, not completion or operational acceptance of the
client portal. Canonical session binding and revocation are locally proven with
synthetic principals; the hosted Supabase/cookie path and PostgreSQL transaction
still require isolated integration proof. No provider, production database,
deployment, migration, external message, or live user was used.

## Acceptance state

| State                | Result                                                    |
| -------------------- | --------------------------------------------------------- |
| planned              | yes                                                       |
| documented           | yes                                                       |
| authorized           | local code/test work only                                 |
| configured           | synthetic memory environment only                         |
| tested               | unit/contract/security regression, lint, typecheck, build |
| deployed             | no                                                        |
| provider accepted    | not applicable/no                                         |
| destination verified | no                                                        |
| recovery verified    | no                                                        |
| user accepted        | no                                                        |
| production accepted  | no                                                        |

## Package

- [Decisions](./DECISIONS.md)
- [Reasons](./REASONS.md)
- [Trade-offs](./TRADEOFFS.md)
- [Gaps](./GAPS.md)
- [Failures](./FAILURES.md)
- [Outcomes](./OUTCOMES.md)
- [Evidence](./EVIDENCE.md)
- [Runbooks](./RUNBOOKS.md)
