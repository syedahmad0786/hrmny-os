# HRMNY durable Apollo free-search bridge

- Date: 2026-08-31
- Client/project: `client-uae-creative-01/hrmny-os`
- Branch: `ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`
- Dependency: `dd732f3ad76a71f208ba9e7c6e8de6899bcb2887`
- Implementation: `6b82f165b3c552a2daa95c88d4010156aafbbcc1`
- Review: pending stacked pull request; do not merge automatically

## Outcome

Apollo People Search is now a queue-first, owner-bound, zero-credit bridge.
An authorized Sales operator creates one durable request receipt and an opaque
job atomically. The worker revalidates the operator role and exact personal
connection at action time, claims the receipt and job with one shared attempt
token, calls only the reviewed free-search adapter, stores a redacted result,
and records retry, dead-letter, reconciliation, cancellation, or revocation
state without exposing the provider key or raw response.

The browser preserves the pending request identity across reloads, polls the
durable status, locks conflicting form changes, and presents only allowlisted
professional fields. The legacy Research Console direct-call path is retired.
A historic provider receipt cannot mark the new durable bridge accepted.

Paid People Match is deliberately locked. The server now requires an injected,
exact-candidate, fresh, consumed approval artifact. No production issuer or
caller exists in this slice, so there is no route from a generic approval to a
credit-bearing operation. Phone, personal email, waterfall operations,
outreach sends, production writes, and Xero writes remain disabled.

Migration 0075 adds owner, connection, state, attempt-token, and lease fencing.
Its production workflow is manual, exact-main-SHA gated, backup-receipt gated,
TLS identity validating, and readback enforcing. It has not been executed.

## Acceptance state

| State | Result |
| --- | --- |
| planned | yes |
| documented | yes |
| authorized | code, local synthetic execution, and review only |
| configured | local synthetic runtime only; no live provider or managed Inngest acceptance |
| tested | local unit, schema-contract, integration, static, build, and five browser journeys passed; hosted exact-SHA checks pending |
| deployed | no |
| provider accepted | no for this durable bridge; an older direct-path receipt is historical only |
| destination verified | no |
| recovery verified | no |
| user accepted | no |
| production accepted | no |

## Human checkpoints retained

- Approve the exact production backup/PITR receipt and reviewed main SHA before
  migration 0075 can run.
- Approve one bounded live zero-credit provider canary only after deployment,
  provider ownership, scopes, and destination reconciliation are visible.
- Build and review the exact-candidate paid approval service before requesting
  a separate one-credit People Match confirmation.
- Run named-user UAT and a recovery drill separately.

## Package

- [Decisions](./DECISIONS.md)
- [Reasons](./REASONS.md)
- [Trade-offs](./TRADEOFFS.md)
- [Gaps](./GAPS.md)
- [Failures](./FAILURES.md)
- [Outcomes](./OUTCOMES.md)
- [Evidence and acceptance](./EVIDENCE.md)
- [Runbooks](./RUNBOOKS.md)
- [Source register](./SOURCE-REGISTER.md)
