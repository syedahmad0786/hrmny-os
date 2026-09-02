# Failures

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; exact model ID not exposed; branch
`ahmadbukhari097/codex/phase-3-role-home-20260830`; commit
`cde54907048f43d5bc7717e24e0d50b66f1768a7`.

## `FAIL-HRMNY-20260830-ROLE-001` — local browser body timeout

- Decision/finding: the bounded local Playwright run timed out in `page.goto`
  after 90 seconds before the DOM and before any role assertion; it was
  terminated rather than left running.
- Reason: preserve negative evidence and avoid calling specification
  compilation a browser pass.
- Alternatives considered: extend an unbounded local wait; omit the failure.
- Trade-offs: hosted Linux E2E must supply preview runtime proof.
- Evidence: local command receipt; eight tests still compile/list correctly.
- Confidence/freshness: high.
- Affected components: local Windows preview harness, not a proven product
  assertion.
- Status: local environment issue retained; hosted preview proof passed.
- Supersedes/superseded-by: none.
- Rollback/correction: diagnose the local loopback separately; do not weaken
  browser contracts.

## `FAIL-HRMNY-20260830-ROLE-002` — first review found two P1 defects

- Decision/finding: independent review found that project/client-specific
  dependency denial could be displayed as zero and partial feature filtering
  could promote the global approvals queue to the primary action.
- Reason: record corrected failures rather than erasing the design history.
- Alternatives considered: accept organization-only feature state; treat the
  approval queue as personal work.
- Trade-offs: dependency counts are nullable and global approvals are fixed
  under **More**.
- Evidence: independent first-pass report, 46 targeted tests, and final GO.
- Confidence/freshness: high.
- Affected components: My Tasks dependency count and home action selection.
- Status: corrected before commit; no remaining reviewed P0/P1.
- Supersedes/superseded-by: superseded by `ADR-HRMNY-20260830-ROLE-003/004`.
- Rollback/correction: retain the regression tests and fail-closed semantics.

## `FAIL-HRMNY-20260830-ROLE-003` — first hosted browser contract failed

- Decision/finding: duplicated push/PR Linux runs each passed 78/85 journeys
  and failed the same seven: six exact role-navigation accessible-name lookups
  and one inherited unscoped **More** selector.
- Reason: preserve the terminal negative receipt and correct the contract before
  accepting the preview.
- Alternatives considered: restore a flat navigation; weaken assertions; call
  a 78/85 run accepted.
- Trade-offs: a complete corrected-head rerun is required even though the
  failures were bounded to accessible names and test targeting.
- Evidence: runs `33307013914` and `33307016697`; jobs `99245233913` and
  `99245241486`; correction commit `7955288...`.
- Confidence/freshness: high; both runs reproduced the same failures.
- Affected components: staff link accessible names and the Sales Growth mobile
  test selector.
- Status: corrected; both complete hosted reruns passed.
- Supersedes/superseded-by: superseded by
  `EVID-HRMNY-20260830-ROLE-007`.
- Rollback/correction: retain exact link names, target the CRM **More** control
  by its navigation landmark, and rerun all 85 journeys.
