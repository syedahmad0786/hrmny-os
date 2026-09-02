# Reasons

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commits `fc2d288074bc44624abbb9e701b5c5ffa7adb775` and
`900bc0e548061b5b6872c3552b18ff8d1c309a6b`, plus correction
`d1ab23c36ebbde5320967f0d806251193919b1c6` and no-helper correction
`8bce5127ef4c817789a3fe8ad3e10677bd9a9c82`.

## `REASON-HRMNY-20260902-APOLLO-012` — preserve least privilege at the Vault boundary

- Decision/finding: use the supported decrypted view's update revision rather
  than changing database grants to make a direct-table query pass.
- Reason: runtime compatibility must not be repaired by giving the application
  broader access to encrypted Vault storage.
- Alternatives considered: grant `SELECT` on `vault.secrets`; omit the
  in-place-rotation fence; add a new privileged helper immediately.
- Trade-offs: reading the view keeps the existing privilege boundary intact,
  but hosted CI later proved that row locking through it is not permitted.
- Evidence: identical hosted `permission denied for table secrets` failures,
  Supabase Vault source, and correction `d1ab23c`.
- Confidence/freshness: high on 2026-09-02.
- Affected components: credential resolution, dispatch authorization, and
  stale-auth reconciliation.
- Status: accepted only for least-privilege reads; its view-lock assumption was
  rejected by `FAIL-HRMNY-20260902-APOLLO-023`.
- Supersedes/superseded-by: explains
  `ADR-HRMNY-20260902-APOLLO-016`; superseded by
  `REASON-HRMNY-20260902-APOLLO-013` for mutation serialization.
- Rollback/correction: retain permitted reads, but never restore the rejected
  view lock or broaden Vault grants.

## `REASON-HRMNY-20260902-APOLLO-010` — one durable lane is the smallest honest boundary

- Decision/finding: free People Search needs a database-visible lane because
  cron and Inngest are independent entry points and multiple employees can
  enqueue work concurrently.
- Reason: only a shared operational authority can make ownership, attempts,
  leases, revocation, recovery, and reconciliation inspectable together.
- Alternatives considered: provider-rate-limit errors as coordination;
  per-worker memory; UI disabling; expanding the slice to paid Match.
- Trade-offs: more schema and recovery machinery, but fewer invisible races and
  no false claim that a queue setting is system-wide.
- Evidence: concurrent claimant tests, migration unique-index contract, and
  independent review.
- Confidence/freshness: high on 2026-09-02.
- Affected components: free Apollo People Search only.
- Status: accepted for the Phase 4f implementation.
- Supersedes/superseded-by: explains `ADR-HRMNY-20260902-APOLLO-013`; none.
- Rollback/correction: close the live lane and retain durable receipts while a
  corrected database-backed design is reviewed.

## `REASON-HRMNY-20260902-APOLLO-011` — ambiguity must survive later success

- Decision/finding: once an authorized provider call loses its database
  session without a definitive response, later success, retry, revocation, or
  terminal failure must preserve `providerOutcomeAmbiguous`.
- Reason: a successful replacement cannot prove that the first provider call
  had no effect or will not settle.
- Alternatives considered: overwrite with the latest result; assume transport
  failure means no provider execution; block recovery forever.
- Trade-offs: operators see a persistent caution even after a useful result,
  but receipts remain truthful and reconcilable.
- Evidence: forced backend termination and lost-authorized-attempt tests.
- Confidence/freshness: high for modeled loss behavior; live provider
  reconciliation remains open.
- Affected components: receipt projection, UI copy, retry/dead-letter paths.
- Status: implemented.
- Supersedes/superseded-by: none.
- Rollback/correction: never clear ambiguity without provider readback or a
  reviewed correction record.

## `REASON-HRMNY-20260902-APOLLO-013` — serialize the supported credential lifecycle at the operational boundary

- Decision/finding: coordinate provider dispatch, key save, and disconnect on
  one Apollo advisory lane; use operational row locks and durable receipt state
  while treating Vault as a function-backed secret store, not a relation the
  runtime may lock.
- Reason: HRMNY controls its connection rows, audits, jobs, and receipts, and
  Supabase Vault's supported runtime functions can participate in the same
  transaction. That is the narrowest boundary that works with actual grants.
- Alternatives considered: privilege expansion; a new privileged helper;
  best-effort independent mutations; application-only mutexes.
- Trade-offs: mutations can fail busy for five seconds, corrupt/null-lease
  state fails closed, disconnect leaves a random tombstone, and direct
  privileged Vault-only edits require quiescence.
- Evidence: `ADR-HRMNY-20260902-APOLLO-017`, source commit `8bce512`, official
  Vault SQL, atomic rollback/cardinality tests, legacy and canonical settlement
  fences, and final independent review.
- Confidence/freshness: high for current source on 2026-09-02; hosted execution
  pending.
- Affected components: connection lifecycle, Vault functions, Apollo jobs,
  receipts, audits, and incident response.
- Status: accepted for exact-current source; operational acceptance open.
- Supersedes/superseded-by: supersedes the mutation-lock reasoning in
  `REASON-HRMNY-20260902-APOLLO-012`; none.
- Rollback/correction: keep the provider closed and revert/correct forward
  without expanding Vault grants.
