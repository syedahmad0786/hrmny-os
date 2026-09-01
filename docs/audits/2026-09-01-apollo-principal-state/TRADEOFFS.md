# Trade-offs

Common metadata for every record: 2026-09-01;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4e-apollo-principal-state-20260901`; commit
`5a166dd935ba1d9ec5fadbf94de8e101a2fc1dc5`.

## `TRADE-HRMNY-20260901-APOLLO-008` — one bounded recovery pointer, cleared on switch

- Decision/finding: keep one shared v2 session-storage key whose envelope names
  the employee principal; reject and remove it when another employee opens the
  tab. Do not describe it as per-principal key namespacing or confidential
  storage.
- Reason: the UI needs reload continuity for one active request without keeping
  multiple employees' criteria in the same tab or adding a server draft model.
- Alternatives considered: per-employee browser keys; localStorage; cookies;
  server-only recovery; no persistence.
- Trade-offs: switching accounts sacrifices employee A's browser resume pointer,
  although A's immutable server receipt remains. Browser storage may be blocked,
  so persistence must succeed before the request is submitted.
- Evidence: storage exception/unit cases and account-switch Playwright cases.
- Confidence/freshness: high.
- Affected components: `hrmny.apollo-search.pending.v2`, Hunt recovery UX.
- Status: accepted for this bounded slice.
- Supersedes/superseded-by: supersedes unsafe v1 restore behavior; none.
- Rollback/correction: delete the v2 pointer and disable new submission rather
  than run a provider action without durable recovery identity.
