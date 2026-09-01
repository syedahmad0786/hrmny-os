# Gaps

Common metadata for every record: 2026-09-01;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4e-apollo-principal-state-20260901`; commit
`5a166dd935ba1d9ec5fadbf94de8e101a2fc1dc5`.

## `GAP-HRMNY-20260901-APOLLO-012` — cross-tab and app-wide cache audit remains

- Decision/finding: Phase 4e proves the Sales Hunt same-tab switch and reload
  boundary. It does not prove two simultaneous tabs or every principal-scoped
  page/query in HRMNY.
- Reason: this vertical slice repairs the exact accepted `GAP-009` surface
  without making an untested app-wide cache-isolation claim.
- Alternatives considered: overstate Hunt proof as application-wide; refactor
  the global query client in the same PR.
- Trade-offs: Hunt becomes dependency-ready while a bounded security backlog
  remains before broad named-user acceptance.
- Evidence: independent final review and Phase 4d
  `GAP-HRMNY-20260831-APOLLO-011`.
- Confidence/freshness: high for scope; medium for uninspected routes.
- Affected components: multi-tab behavior and other identity-bound pages.
- Status: open P2; does not reopen the repaired same-tab Hunt path.
- Supersedes/superseded-by: carries forward the two-tab portion of
  `GAP-HRMNY-20260831-APOLLO-011`; none.
- Rollback/correction: add two-tab and route-by-route fixtures in a separate
  reviewable slice; keep server authorization fail closed meanwhile.

## `GAP-HRMNY-20260901-APOLLO-013` — provider-wide concurrency remains Phase 4f

- Decision/finding: employee B may start a new allowed search while employee
  A's already-dispatched call settles. The UI no longer inherits A's lock, but
  this does not serialize Apollo across cron, Inngest, employees, or jobs.
- Reason: provider concurrency is a durable scheduler/database concern, not a
  browser-state concern.
- Alternatives considered: keep B falsely locked; claim per-request tokens are
  provider-wide; add an unreviewed client mutex.
- Trade-offs: live-provider activation remains blocked while synthetic browser
  operation stays usable.
- Evidence: `GAP-HRMNY-20260831-APOLLO-010` and Phase 4f read-only audit.
- Confidence/freshness: high.
- Affected components: scheduled jobs, cron, Inngest, Apollo rate strategy.
- Status: open P1 for live canary; next dependency-ready slice.
- Supersedes/superseded-by: restates, does not supersede,
  `GAP-HRMNY-20260831-APOLLO-010`.
- Rollback/correction: keep live Apollo closed until a database-backed global
  claimant and recovery tests are accepted.
