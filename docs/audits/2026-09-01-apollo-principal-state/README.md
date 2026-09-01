# HRMNY Apollo principal-bound browser state

- Date: 2026-09-01
- Client/project: `client-uae-creative-01/hrmny-os`
- Actor signature: host `Bukhari-Laptop`; actor `Codex /root`; tool/model
  `Codex agent (exact model ID not exposed)`
- Branch: `ahmadbukhari097/codex/phase-4e-apollo-principal-state-20260901`
- Stacked base: `e3551726dd95e9085625b0d5a10f226453d14f24`
- Implementation commit: `5a166dd935ba1d9ec5fadbf94de8e101a2fc1dc5`
- Scope: browser and query-state isolation only; no schema, provider, deployment,
  production, billing, message, or Xero effect

## Outcome

Sales Hunt now binds reload recovery to the canonical authenticated staff
principal. Authorization and Apollo connection responses carry the same
server-derived employee ID, and the UI refuses cached values whose principal
does not match the current verified session. The browser uses one v2
principal-bound session-storage envelope and deletes it on mismatch; it does
not create one storage key per employee and is not a confidentiality store.

Same-tab account changes clear Apollo criteria, receipt pointers, results,
notes, synthetic fields, and principal-owned pending labels. An unsent Research
draft remains mounted during an ordinary same-principal refetch, but is remounted
under a new key when the principal changes. Delayed status and mutation
responses from the old employee cannot render, clear, cancel, or lock the new
employee's state. Server-side authorization remains authoritative for every
receipt read and effect.

Switching from employee A to B deliberately discards A's browser resume pointer.
A may still have an already-dispatched server/provider operation settling in the
background. Cross-scheduler/provider serialization remains open in
`GAP-HRMNY-20260831-APOLLO-010` and is the next Phase 4f dependency; this slice
does not hide or claim to close it.

## Acceptance state

| State                | Result                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| planned              | yes                                                                                          |
| documented           | yes                                                                                          |
| authorized           | source and synthetic local testing only                                                      |
| configured           | local memory/mock runtime only                                                               |
| tested               | local: 946 deterministic tests, 8/8 focused browser journeys, lint, typecheck, and web build |
| deployed             | no                                                                                           |
| provider accepted    | no                                                                                           |
| destination verified | no                                                                                           |
| recovery verified    | no                                                                                           |
| user accepted        | no                                                                                           |
| production accepted  | no                                                                                           |

Hosted exact-head CI and external review remain separate receipts. Nothing in
this package authorizes a live Apollo call, credit use, production migration,
deployment, merge, external message, or named-user UAT.

## Package

- [Decisions](./DECISIONS.md)
- [Reasons](./REASONS.md)
- [Trade-offs](./TRADEOFFS.md)
- [Gaps](./GAPS.md)
- [Failures](./FAILURES.md)
- [Outcomes](./OUTCOMES.md)
- [Evidence](./EVIDENCE.md)
- [Runbooks](./RUNBOOKS.md)
