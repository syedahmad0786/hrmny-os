# Trade-offs

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; commit
`fc2d288074bc44624abbb9e701b5c5ffa7adb775`.

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
