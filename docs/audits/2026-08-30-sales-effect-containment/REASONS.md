# Reasons

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; tool/model `Codex agent (exact model ID not
exposed)`; branch `ahmadbukhari097/codex/phase-1-sales-effect-containment-20260830`;
commit `10d997c7e28221f186ecec7aa3b101b2a6096dc3`.

## `REASON-HRMNY-20260830-SALES-001` — containment precedes automation

- Decision/finding: first make unsafe shortcuts inert, then build the reviewed
  proposal and effect-broker path in later slices.
- Reason: authorization, exact-person spend consent, and provider receipts
  cannot be retrofitted reliably after a side effect occurs.
- Alternatives considered: finish automation in one large change; trust UI
  confirmations.
- Trade-offs: temporarily less automation for a smaller blast radius.
- Evidence: Sales audit, `ADR-HRMNY-20260830-SALES-001/002`.
- Confidence/freshness: high; current audit and code.
- Affected components: Sales providers, CRM, jobs, outreach.
- Status: accepted sequencing reason.
- Supersedes/superseded-by: none; may be refined by later bridge ADRs.
- Rollback/correction: retain fail-closed behavior until replacement acceptance
  is evidenced.

## `REASON-HRMNY-20260830-SALES-002` — one canonical policy reader

- Decision/finding: all scheduled readers use one canonical autonomy rule key
  and treat zero, invalid, or multiple active policies as manual mode.
- Reason: ambiguity must never grant autonomy.
- Alternatives considered: accept the first active row; duplicate parsing in
  each scheduler.
- Trade-offs: conflicting policy rows stop work and require repair.
- Evidence: autonomy policy unit tests in `EVID-HRMNY-20260830-SALES-002`.
- Confidence/freshness: high.
- Affected components: AI policy router and scheduled Sales gate.
- Status: implemented.
- Supersedes/superseded-by: supersedes first-row-wins policy reading; none.
- Rollback/correction: correct the stored policy transactionally; never select
  an arbitrary active row.
