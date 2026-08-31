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

## `TRD-HRMNY-20260831-RESEARCH-003` — retain synthetic continuity behind disclosure

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; product
  commit `762ffec1ca78137ed0d86778965abae7bb699010`.
- Decision/finding: mature downstream synthetic continuity remains testable in
  a collapsed section rather than being removed with the obsolete visible
  provider mock.
- Reason: Sales-to-delivery, portal, finance, outreach, and sandbox regression
  proof remains valuable when its synthetic status and runtime boundary are
  explicit.
- Alternatives considered: remove every legacy continuity test; expose mocks
  alongside normal work; use a live provider in CI.
- Trade-offs: a bounded legacy fixture service remains in the codebase, guarded
  by the full inert-runtime tuple and kept out of normal operator actions.
- Evidence: duplicate 88-test hosted browser receipt
  `EVID-HRMNY-20260831-RESEARCH-012/014`.
- Confidence/freshness: high.
- Affected components: Hunt test tools and synthetic end-to-end fixtures.
- Status: accepted for CI/acceptance only; never provider acceptance.
- Supersedes/superseded-by: none.
- Rollback/correction: remove the fixture only after equivalent deterministic
  vertical-slice coverage exists.
