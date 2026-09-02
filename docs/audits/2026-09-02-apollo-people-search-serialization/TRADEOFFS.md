# Trade-offs

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commits `fc2d288074bc44624abbb9e701b5c5ffa7adb775` and
`900bc0e548061b5b6872c3552b18ff8d1c309a6b`, plus correction
`d1ab23c36ebbde5320967f0d806251193919b1c6` and no-helper correction
`8bce5127ef4c817789a3fe8ad3e10677bd9a9c82`.

## `TRADE-HRMNY-20260902-APOLLO-010` — bounded mutual exclusion over false exactly-once

- Decision/finding: accept a maximum 20-second provider request inside a
  lock-only transaction with a 45-second idle-in-transaction timeout and a
  10-minute durable lease. Record session/host loss as ambiguous and allow a
  later fenced replacement.
- Reason: PostgreSQL can coordinate healthy concurrent workers, but no local
  transaction can atomically commit with an external HTTP provider.
- Alternatives considered: claim exactly-once; retain application row locks
  across HTTP; never recover; omit the provider lock.
- Trade-offs: lock/session loss can permit a later duplicate zero-credit read;
  healthy runtime overlap is prevented and the uncertainty is visible.
- Evidence: PostgreSQL primary documentation and forced backend-loss tests.
- Confidence/freshness: high for normal-runtime mutual exclusion; medium until
  the actual production pooler/runtime path is canary-tested.
- Affected components: database connections, provider dispatch, recovery, and
  operator copy.
- Status: accepted with `GAP-HRMNY-20260902-APOLLO-017` open.
- Supersedes/superseded-by: none.
- Rollback/correction: close the lane on repeated ambiguity, reconcile provider
  receipts, and revisit the lock service before reopening.

## `TRADE-HRMNY-20260902-APOLLO-011` — free search only

- Decision/finding: the reserved lane applies only to zero-credit People
  Search. Paid People Match, phone, personal email, waterfalls, and auth probes
  do not inherit its acceptance.
- Reason: paid enrichment has different approval, spend, exact-candidate, and
  reconciliation requirements.
- Alternatives considered: serialize every Apollo operation now; treat a
  generic approval as paid authorization.
- Trade-offs: one bounded lane becomes safe sooner while paid activation stays
  blocked and separately reviewable.
- Evidence: migration trigger/CHECK and runtime constants/tests.
- Confidence/freshness: high.
- Affected components: Apollo job kinds and provider policy.
- Status: accepted; paid gap remains P1.
- Supersedes/superseded-by: none.
- Rollback/correction: retain `APOLLO_ALLOW_PAID_OPERATIONS=false` and disable
  the one-shot paid route until its own contract is accepted.

## `TRADE-HRMNY-20260902-APOLLO-012` — rejected view-lock proposal over broader grants

- Decision/finding: the historical proposal used
  `vault.decrypted_secrets.updated_at` as the rotation revision and retained
  `FOR SHARE` through the permitted view.
- Reason: the application already needs scoped decrypted-secret access, while
  direct `vault.secrets` access would widen its database privilege surface.
- Alternatives considered: grant direct table reads; create a privileged
  helper immediately; remove in-place-rotation protection.
- Trade-offs: the timestamp remains a technical fence, but hosted CI proved the
  runtime role cannot use view row-lock behavior. This proposal is retained as
  rejected evidence.
- Evidence: `FAIL-HRMNY-20260902-APOLLO-022/023`, official Vault extension SQL,
  and rejected correction `d1ab23c`.
- Confidence/freshness: high for least privilege and the hosted rejection; only
  exact-`8bce512` no-helper execution remains pending.
- Affected components: Vault grants, credential rotation, Apollo dispatch, and
  auth-error reconciliation.
- Status: rejected after `FAIL-HRMNY-20260902-APOLLO-023`.
- Supersedes/superseded-by: superseded by
  `TRADE-HRMNY-20260902-APOLLO-013`.
- Rollback/correction: never restore the view lock or use broad table grants.

## `TRADE-HRMNY-20260902-APOLLO-013` — supported operational serialization over a new privileged helper

- Decision/finding: lock only HRMNY operational rows, serialize governed Apollo
  mutations with provider dispatch, and use existing Vault functions inside
  the transaction. Do not add a helper or new Vault grants in this slice.
- Reason: it satisfies the real hosted privilege contract while preserving
  atomic connection/audit behavior and action-time revision checks.
- Alternatives considered: a narrow security-definer helper; direct Vault
  table/view locks; separate non-atomic writes; no revision fence.
- Trade-offs: supported operations are coherent, but an exceptional direct
  Vault-only edit must be quiesced. Tombstones consume a Vault row, missing
  projections surface an error, and an unknown null-lease state blocks
  rotation/disconnect until reconciled.
- Evidence: source commit `8bce512`, `ADR-HRMNY-20260902-APOLLO-017`, official
  Vault SQL, 40-case PostgreSQL specification, and three final reviews.
- Confidence/freshness: high for source on 2026-09-02; hosted and live recovery
  proof pending.
- Affected components: runtime grants, credential lifecycle, Apollo execution,
  Vault retention, recovery, and operator UX.
- Status: accepted for current source with `GAP-HRMNY-20260902-APOLLO-018` open.
- Supersedes/superseded-by: supersedes
  `TRADE-HRMNY-20260902-APOLLO-012`; none.
- Rollback/correction: close Apollo, preserve tombstones and receipts, and use a
  separately reviewed helper only if future requirements prove the operational
  lane insufficient.
