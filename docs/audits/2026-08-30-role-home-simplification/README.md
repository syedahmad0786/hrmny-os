# HRMNY role-home simplification slice

- Date: 2026-08-30
- Client/project: `client-uae-creative-01/hrmny-os`
- Branch: `ahmadbukhari097/codex/phase-3-role-home-20260830`
- Phase 2 dependency: `037ada23bf20f6d1f41c73176f6b03409530bf0b` / PR #239
- Implementation commit: `cde54907048f43d5bc7717e24e0d50b66f1768a7`
- Accessibility/test correction: `79552880ddaba28723c3ce3572bbd64bc5a07cfc`
- Review: PR #240

## Outcome

The staff home now starts from permission-scoped owned work rather than
organization-wide operating totals. It exposes the next assigned item,
personal decisions, unresolved dependency state, evidence, project context,
and the next handoff. A deterministic presentation policy prioritizes the
same enabled areas differently for partner, director, account-management,
finance, people, traffic, creative, developer, and fallback staff roles.
Every enabled legacy area remains reachable under a keyboard-operable **More**
control; no route or data was deleted.

The role policy is not an authorization policy. Server-owned permissions,
feature resolution, actor scope, and project/client scope remain authoritative.
Client preview, audit, and administrative destinations require server-derived
capability booleans. Dependency visibility is resolved for the selected
project/client and fails closed as unknown when unavailable. The staff-wide
approval queue is fixed under **More** and cannot become the primary action.

This is the first internal-experience vertical slice, not completion of role
journeys or production acceptance. No schema migration, provider action,
production promotion, external message, or live user was used.

The first hosted run passed 78 of 85 browser journeys. It exposed six new
assertions whose exact accessible-name lookup included the visual navigation
index, plus one inherited Sales Growth test whose unscoped **More** selector
became ambiguous after the staff **More** control was added. Both duplicated CI
runs failed on the same seven contracts. Correction commit `7955288...` gives
the navigation links exact accessible names and scopes the existing selector to
the CRM navigation. The negative receipt is preserved in
`EVID-HRMNY-20260830-ROLE-006`.

The corrected head then reached terminal preview acceptance. Push run
`33307347492` and pull-request run `33307349042` both passed verification,
database, and all 85 Linux browser journeys. Both Vercel preview deployments,
the approval reviewer, and the security reviewer passed. This closes the
reviewed code/preview state only; merge, production promotion, performance,
recovery, named-user UAT, and production acceptance remain unapproved.

## Acceptance state

| State                | Result                                           |
| -------------------- | ------------------------------------------------ |
| planned              | yes                                              |
| documented           | yes                                              |
| authorized           | local code/test and PR preview only              |
| configured           | deterministic role policy and synthetic fixtures |
| tested               | local gates + hosted Linux CI/E2E 85/85          |
| deployed             | PR preview only; no production promotion         |
| provider accepted    | no/not applicable to this slice                  |
| destination verified | no                                               |
| recovery verified    | no                                               |
| user accepted        | no                                               |
| production accepted  | no                                               |

## Package

- [Decisions](./DECISIONS.md)
- [Reasons](./REASONS.md)
- [Trade-offs](./TRADEOFFS.md)
- [Gaps](./GAPS.md)
- [Failures](./FAILURES.md)
- [Outcomes](./OUTCOMES.md)
- [Evidence](./EVIDENCE.md)
- [Runbooks](./RUNBOOKS.md)
