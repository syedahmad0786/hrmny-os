# Trade-offs

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
`41145c85e799f6b906dfca23a37aea0894cc9582`.

## `TRD-HRMNY-20260831-RESEARCH-001` — bounded capture before provider automation

- Decision/finding: this slice accepts operator-supplied public evidence and
  does not perform provider research or fetch the evidence URL.
- Reason: establish the durable approval boundary before adding network and
  provider effects.
- Alternatives considered: bundle provider search, scheduling, scoring, and
  promotion; retain mocks.
- Trade-offs: capture is reliable and reviewable but not yet an automated
  research pipeline.
- Evidence: provider call guards and focused tests.
- Confidence/freshness: high.
- Affected components: research capture, provider adapters, execution layer.
- Status: accepted for this slice; automation gap open.
- Supersedes/superseded-by: none.
- Rollback/correction: add provider operations only through the standard
  preview/approval/readback/receipt bridge.

## `TRD-HRMNY-20260831-RESEARCH-002` — conservative identity resolution

- Decision/finding: conflicting non-empty domains or domain/name disagreement
  stops Gate 1 rather than choosing a likely company.
- Reason: false merges are harder to recover and can cross client/deal lineage.
- Alternatives considered: fuzzy name match; newest record wins; domain wins.
- Trade-offs: operators will see more manual-review blockers.
- Evidence: conflict fixtures and `COMPANY_IDENTITY_CONFLICT_REQUIRES_REVIEW`.
- Confidence/freshness: high.
- Affected components: CRM company resolution and signal linking.
- Status: implemented.
- Supersedes/superseded-by: none.
- Rollback/correction: improve candidate presentation without changing the
  fail-closed server rule.
