# Failures

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
`41145c85e799f6b906dfca23a37aea0894cc9582`.

## `FAIL-HRMNY-20260831-RESEARCH-001` — review exposed incomplete boundaries

- Decision/finding: independent review found ambiguous company merges, Gate 1
  without a terminal receipt, incomplete signal reconciliation, synthetic
  Apollo leakage, unsupported roles, hidden mutation errors, and reserved-IP
  evidence acceptance.
- Reason: preserve corrected failures and their lessons.
- Alternatives considered: omit the findings after correction.
- Trade-offs: the implementation gained explicit blockers and tests.
- Evidence: three bounded reviewer reports and 34 focused passing tests after
  remediation.
- Confidence/freshness: high.
- Affected components: evidence validation, Gate 1, Apollo, roles, UI contract.
- Status: corrected before immutable core commit; later provider gaps remain.
- Supersedes/superseded-by: superseded by ADRs `-001` through `-004`.
- Rollback/correction: retain every regression fixture and re-run independent
  review after boundary changes.

## `FAIL-HRMNY-20260831-RESEARCH-002` — Windows development server returned no body

- Decision/finding: the local Next development server accepted connections for
  `/`, `/login`, and Sales routes but did not complete response bodies.
- Reason: preserve the first local browser-runtime failure rather than calling
  specification compilation a pass.
- Alternatives considered: wait indefinitely; weaken tests; omit the failure.
- Trade-offs: an optimized server and hosted Linux CI are required for proof.
- Evidence: timed local requests and terminated development session.
- Confidence/freshness: high for this Windows environment.
- Affected components: local Node 24 / Next development harness.
- Status: unresolved local environment issue; not yet a product defect.
- Supersedes/superseded-by: none.
- Rollback/correction: diagnose independently; do not change product contracts
  solely to accommodate the local server.

## `FAIL-HRMNY-20260831-RESEARCH-003` — optimized local Chromium asset stall

- Decision/finding: the optimized server returned Sales HTML and direct static
  asset requests with HTTP 200, but Chromium left three static assets pending,
  kept `document.readyState=loading`, and timed out three unrelated cases in
  `page.goto` before assertions.
- Reason: classify the common harness failure precisely and keep browser
  acceptance open.
- Alternatives considered: run the remaining cases for repeated 90-second
  failures; claim the server HTTP result as UI acceptance.
- Trade-offs: hosted Linux E2E becomes the exact-SHA browser gate.
- Evidence: Playwright error contexts, pending-request probe, and direct 200
  reads of the same assets.
- Confidence/freshness: high for the observed session; cause unproven.
- Affected components: local Windows Chromium/Next serving path.
- Status: open local harness issue; hosted proof pending.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve artifacts, use bounded diagnostics, and never
  weaken assertions or extend unbounded waits.
