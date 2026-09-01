# Decisions

Common metadata for every record: 2026-09-01;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4e-apollo-principal-state-20260901`; commit
`5a166dd935ba1d9ec5fadbf94de8e101a2fc1dc5`; base
`e3551726dd95e9085625b0d5a10f226453d14f24`.

## `ADR-HRMNY-20260901-APOLLO-012` — bind Hunt state to authoritative principals

- Decision/finding: use `auth.session.employeeId` as Hunt's canonical current
  principal; tag Sales authorization and employee-owned Apollo connection
  responses with their server-derived principal; accept those cached responses
  only when their principal matches the settled session. Persist one v2
  principal-bound pending envelope, reject/delete legacy, malformed, or
  mismatched state, and gate callbacks and pending indicators by principal plus
  request identity. All server procedures continue to authorize from context.
- Reason: a same-mounted-page account change must not expose, replay, or lock on
  the prior employee's browser/query state.
- Alternatives considered: display-name/email ownership; one key per employee;
  no reload recovery; clearing all application query caches; trusting TanStack
  invalidation without response ownership tags.
- Trade-offs: account switching discards A's resume pointer; the browser payload
  is plaintext UX recovery state; two different employee operations may overlap
  until Phase 4f adds provider-wide serialization.
- Evidence: `EVID-HRMNY-20260901-APOLLO-018`; implementation commit; independent
  read-only acceptance review.
- Confidence/freshness: high for local source and synthetic proof on 2026-09-01.
- Affected components: Hunt page, Research Console mount boundary, auth session
  contract, Sales access response, Apollo connection response, browser session
  helper, and Playwright acceptance.
- Status: implemented and locally verified; hosted exact-head review pending.
- Supersedes/superseded-by: intended to supersede the remedy portion of
  `GAP-HRMNY-20260831-APOLLO-009` after hosted exact-head proof; none.
- Rollback/correction: revert the implementation commit, disable Hunt provider
  controls, retain server receipts, and restore only after principal-switch
  denial tests pass. Never weaken server authorization to preserve browser UX.
