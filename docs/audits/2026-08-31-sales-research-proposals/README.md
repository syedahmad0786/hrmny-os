# HRMNY Sales research proposal boundary

- Date: 2026-08-31
- Client/project: `client-uae-creative-01/hrmny-os`
- Branch: `ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`
- Phase 3 dependency: `9b0a2133103de5e29ff3571693147ebd4a1f6a44` / PR #240
- Core implementation: `41145c85e799f6b906dfca23a37aea0894cc9582`
- Core review: PR #241
- UI branch: `ahmadbukhari097/codex/phase-4b-sales-research-ui-20260831`
- UI implementation: `21774d858b66676dc4f9cfd48d039abf7b079472`
- UI review: pending

## Outcome

Sales Growth now captures a sourced research proposal before creating a CRM
company. Capture persists the proposal, source signal, audit record, and an
internal completed inbox receipt atomically. Exact retries return the same
proposal; reuse of the same researched company adds distinct signal lineage;
payload changes under one idempotency key fail closed.

Gate 1 is the only path in this slice that promotes a proposal to a canonical
company. It requires a completed capture receipt and an unlinked signal,
reconciles every eligible signal in the same transaction, and refuses
ambiguous name/domain identity. Public source evidence is restricted to HTTPS
and rejects placeholders, loopback, local/internal/test names, private,
documentation, carrier-grade NAT, link-local, multicast, and reserved IP
space.

The obsolete hard-coded daily research path is removed from the contract.
Free Apollo search fails closed without a scoped live credential; explicitly
synthetic adapters remain test-only. Paid People Match, external messages,
production writes, and Xero writes remain closed.

The dependent UI slice presents source evidence, receipt-backed Gate 1
decisions, pending/error states, and a truthful read-only view for non-Sales
staff. Hunt and inbound surfaces use the same server-derived operator policy.
Desktop and 390-pixel browser contracts cover proposal creation, approval,
view-only denial, fail-closed Apollo discovery, and overflow.

This package covers the core boundary. UI and disposable-PostgreSQL proofs are
kept as dependent review slices so this does not become one unreviewable
"complete HRMNY" change.

## Acceptance state

| State                | Result |
| -------------------- | ------ |
| planned              | yes |
| documented           | yes |
| authorized           | local code/test and review preview only |
| configured           | synthetic memory runtime only |
| tested               | local unit/static/build gates; browser contracts added; hosted exact-SHA pending |
| deployed             | no; review preview pending |
| provider accepted    | no |
| destination verified | no |
| recovery verified    | no |
| user accepted        | no |
| production accepted  | no |

## Package

- [Decisions](./DECISIONS.md)
- [Reasons](./REASONS.md)
- [Trade-offs](./TRADEOFFS.md)
- [Gaps](./GAPS.md)
- [Failures](./FAILURES.md)
- [Outcomes](./OUTCOMES.md)
- [Evidence](./EVIDENCE.md)
- [Runbooks](./RUNBOOKS.md)
