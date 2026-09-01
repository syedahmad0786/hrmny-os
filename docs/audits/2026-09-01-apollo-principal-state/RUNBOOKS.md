# Runbooks

Common metadata for every record: 2026-09-01;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4e-apollo-principal-state-20260901`; commit
`5a166dd935ba1d9ec5fadbf94de8e101a2fc1dc5`.

## `PROC-HRMNY-20260901-APOLLO-007` — reload and account-switch recovery

- Decision/finding: on load, wait for a settled authenticated staff session;
  discard v1, malformed, inaccessible, or different-principal storage; accept a
  v2 pointer only for the same principal; then query the exact owner-authorized
  receipt. On account change, hide/inert identity-bound drafts while queries
  refresh, clear Hunt-local state, remount Research under the new principal,
  and delete a mismatched pointer. Ignore stale callbacks whose principal or
  request ID no longer matches.
- Reason: make recovery deterministic without turning browser storage into an
  authority.
- Alternatives considered: automatic resubmission; retaining multiple employee
  pointers; trusting cached access/connection values.
- Trade-offs: A loses browser resume after B uses the same tab; immutable server
  receipts remain available through authorized operational tooling.
- Evidence: `EVID-HRMNY-20260901-APOLLO-018`.
- Confidence/freshness: high.
- Affected components: Hunt operator flow and support/recovery procedure.
- Status: last successful local execution 2026-09-01.
- Supersedes/superseded-by: extends
  `PROC-HRMNY-20260831-APOLLO-002/003`; none.
- Rollback/correction: if storage fails, do not submit; if identity is unsettled,
  keep controls disabled; if outcome is uncertain, inspect the exact
  owner-authorized server receipt before retrying. Never create a new provider
  action merely to recover UI state.
- Prerequisites/permissions: authenticated staff actor, eligible Sales role,
  employee-owned connection, safe environment for synthetic proof. Live use
  still requires the separately approved canary and Phase 4f concurrency proof.
- Tests: helper exceptions and identity mismatch; canonical session tags; access
  and connection tags; reload; no-reload switch; delayed status/mutation;
  readiness gate; Research draft; mobile layout.

