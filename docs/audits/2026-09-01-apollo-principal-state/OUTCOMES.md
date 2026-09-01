# Outcomes

Common metadata for every record: 2026-09-01;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4e-apollo-principal-state-20260901`; commit
`5a166dd935ba1d9ec5fadbf94de8e101a2fc1dc5`.

## `OUTCOME-HRMNY-20260901-APOLLO-007` — Hunt same-tab principal isolation proven locally

- Decision/finding: Sales Hunt no longer restores, renders, clears, cancels, or
  inherits pending UI from another verified employee in the same tab. A current
  principal still restores and reconciles the exact request.
- Reason: close the named-user blocking privacy/UX defect without changing the
  server effect model or expanding into provider concurrency.
- Alternatives considered: documentation-only closure; forced reload; removal
  of recovery; broad application rewrite.
- Trade-offs: switching identities deletes A's browser pointer and two-tab proof
  remains open.
- Evidence: `EVID-HRMNY-20260901-APOLLO-018`; implementation commit.
- Confidence/freshness: high locally on 2026-09-01.
- Affected components: Sales Hunt, Research draft boundary, browser storage,
  query readiness, mutation callbacks.
- Status: local synthetic accepted; hosted CI/review pending; no operational
  acceptance implied.
- Supersedes/superseded-by: intended to close
  `GAP-HRMNY-20260831-APOLLO-009` after hosted exact-head proof.
- Rollback/correction: revert the commit and disable the provider control; keep
  immutable server receipts and the v1 rejection behavior.

