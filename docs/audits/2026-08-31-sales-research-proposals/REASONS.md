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

## `RSN-HRMNY-20260831-RESEARCH-003` — inspect portal payload structure, not random values

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; branch
  `ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
  `dd732f3ad76a71f208ba9e7c6e8de6899bcb2887`.
- Decision/finding: the portal-finance denial assertion calls the production
  recursive key guard instead of searching serialized values for short words.
- Reason: randomly generated IDs and legitimate copy can contain `fee` without
  representing a finance field; privacy is a schema/key property.
- Alternatives considered: lengthen the regex; remove the denial assertion;
  seed fixed UUIDs.
- Trade-offs: the test is coupled to the production guard, while separate
  failure-injection coverage proves that the guard rejects forbidden keys.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-013/014`.
- Confidence/freshness: high.
- Affected components: portal isolation test and hosted verify stability.
- Status: implemented; ten repeated local file runs and duplicate hosted
  verify runs passed.
- Supersedes/superseded-by: supersedes serialized-value regex matching; none.
- Rollback/correction: keep recursive forbidden-key failure injection and add
  explicit schema assertions if the portal payload evolves.
