# Reasons

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
`41145c85e799f6b906dfca23a37aea0894cc9582`.

## `RSN-HRMNY-20260831-RESEARCH-001` — remove synthetic research from the visible contract

- Decision/finding: the hard-coded daily research generator is removed rather
  than relabeled as a real research job.
- Reason: mock output on an operating surface is misleading and can contaminate
  CRM state.
- Alternatives considered: hide it behind advanced settings; keep it with a
  synthetic badge; connect a provider in the same slice.
- Trade-offs: scheduled provider research remains an explicit open dependency.
- Evidence: implementation diff and `GAP-HRMNY-20260831-RESEARCH-005`.
- Confidence/freshness: high.
- Affected components: Sales research service and router contract.
- Status: implemented.
- Supersedes/superseded-by: supersedes daily mock research; none.
- Rollback/correction: restore only through a durable scheduled-job design with
  provider receipts and reconciliation.

## `RSN-HRMNY-20260831-RESEARCH-002` — receipts are required before promotion

- Decision/finding: a proposal row alone is insufficient evidence for Gate 1.
- Reason: the completed internal receipt proves the capture transaction reached
  its durable terminal state and binds the request/result IDs.
- Alternatives considered: infer completion from proposal status; write audit
  after the transaction; allow repair during approval.
- Trade-offs: orphaned or legacy proposals require explicit reconciliation.
- Evidence: failed-without-receipt and rollback fixtures in the focused suite.
- Confidence/freshness: high.
- Affected components: proposal receipt lookup and Gate 1 transaction.
- Status: implemented; legacy reconciliation is not invoked automatically.
- Supersedes/superseded-by: none.
- Rollback/correction: add a reviewed repair tool rather than bypassing receipt
  validation.
