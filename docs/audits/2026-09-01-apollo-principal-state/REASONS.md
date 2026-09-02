# Reasons

Common metadata for every record: 2026-09-01;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4e-apollo-principal-state-20260901`; commit
`5a166dd935ba1d9ec5fadbf94de8e101a2fc1dc5`.

## `REASON-HRMNY-20260901-APOLLO-008` — identity coherence precedes convenience

- Decision/finding: recovery state, authorization state, connection state,
  mutation state, and rendered drafts must agree on one verified employee
  before a control becomes actionable.
- Reason: independent client caches settle out of order. A server authorization
  boundary prevents unauthorized effects, but stale enabled controls or visible
  criteria still create privacy, attribution, and trust failures.
- Alternatives considered: rely only on server denial; reload after every
  account change; keep stale controls visible while fetching.
- Trade-offs: controls temporarily show a checking state and fail closed during
  identity changes.
- Evidence: delayed readiness, terminal status, and mutation browser fixtures in
  `EVID-HRMNY-20260901-APOLLO-018`.
- Confidence/freshness: high.
- Affected components: Sales Hunt client state and tRPC query readiness.
- Status: accepted locally; hosted receipt pending.
- Supersedes/superseded-by: none.
- Rollback/correction: hide/disable the provider surface if authoritative query
  ownership cannot be proven; do not infer identity from unverified text.
