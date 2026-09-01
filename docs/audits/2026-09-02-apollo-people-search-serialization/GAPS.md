# Gaps

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commits `fc2d288074bc44624abbb9e701b5c5ffa7adb775` and
`900bc0e548061b5b6872c3552b18ff8d1c309a6b`.

## `GAP-HRMNY-20260902-APOLLO-014` — hosted PostgreSQL proof pending

- Decision/finding: corrected local lint, types, tests, and builds pass, but the
  29-case PostgreSQL runtime suite and disposable migration verifier require
  hosted CI. The initial `afc708a` matrices failed and cannot be reused.
- Reason: no safe local PostgreSQL service or authorized database URL was
  available; the default web suite intentionally excludes this file.
- Alternatives considered: point tests at production; claim unit proof as
  database execution; install an unapproved local service.
- Trade-offs: the branch cannot close the prior provider-wide free-search gap
  until both hosted event matrices pass the exact head.
- Evidence: `EVID-HRMNY-20260902-APOLLO-021/022/023`.
- Confidence/freshness: high.
- Affected components: migration `0076`, advisory lock, concurrent workers,
  forced session loss, and recovery.
- Status: open P1 until hosted disposable PostgreSQL proof.
- Supersedes/superseded-by: will be superseded by
  `EVID-HRMNY-20260902-APOLLO-023` if accepted.
- Rollback/correction: leave the PR unmerged and live Apollo closed on any CI
  failure; correct forward and rerun both matrices.

## `GAP-HRMNY-20260902-APOLLO-015` — operational acceptance remains open

- Decision/finding: production migration, new-runtime deployment, bounded live
  provider canary, destination reconciliation, recovery drill, named-user UAT,
  and production acceptance have not occurred.
- Reason: each is a separate human checkpoint with account, data, provider, or
  production consequences.
- Alternatives considered: equate code/CI/preview health with production
  acceptance; auto-run the manual migration workflow.
- Trade-offs: release is slower but rollback, ownership, and provider evidence
  remain trustworthy.
- Evidence: acceptance table and workflow summary that keeps Apollo quiesced.
- Confidence/freshness: high on 2026-09-02.
- Affected components: Supabase, runtime deployment, Apollo, monitoring, users.
- Status: open P1; no production authorization.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve current production state and request only the
  exact checkpoint when the reviewed prerequisite is ready.

## `GAP-HRMNY-20260902-APOLLO-016` — paid People Match remains separate

- Decision/finding: paid People Match bypasses the free-search lane and still
  needs provider-wide serialization, exact visible candidate confirmation,
  spend receipt, readback, and reconciliation. The existing one-shot canary can
  be explicitly approved even while `APOLLO_ALLOW_PAID_OPERATIONS=false`, so
  that variable alone is not a hard technical barrier.
- Reason: free search proof cannot authorize credit consumption.
- Alternatives considered: inherit this lane's acceptance; rely on a generic
  approval; disable only the UI.
- Trade-offs: paid enrichment remains blocked pending a small dedicated slice.
- Evidence: paid Match runtime path and independent acceptance review.
- Confidence/freshness: high.
- Affected components: Apollo People Match and approval/effect broker.
- Status: open P1 before any credit-bearing canary.
- Supersedes/superseded-by: carries forward the paid portion of earlier Apollo
  activation gaps; none.
- Rollback/correction: keep phone, personal email, waterfalls, and other paid
  operations disabled and require fresh action-time confirmation.

## `GAP-HRMNY-20260902-APOLLO-017` — session-loss and credential operations need live proof

- Decision/finding: transaction/session loss is modeled as a durable ambiguous
  outcome, and both connection-row and Vault-row revisions fence delayed work.
  The production pooler/runtime path, alerting, reconciliation, governed
  credential-rotation procedure, and recovery cadence are not accepted.
- Reason: source tests cannot prove production network, pooler, operational
  procedure, or observer behavior.
- Alternatives considered: claim exactly-once; treat a graph edge or code path
  as operational proof; silently trust direct Vault edits because the source
  fence exists.
- Trade-offs: the system fails closed and may require operator reconciliation.
- Evidence: forced backend termination tests and `TRADE-010`.
- Confidence/freshness: high for the identified boundary; acceptance absent.
- Affected components: Supavisor/direct PostgreSQL, Vault, connection admin,
  audit/status reconciliation, monitoring, and runbooks.
- Status: open P1 for live rollout/recovery; no code blocker for synthetic CI.
- Supersedes/superseded-by: none.
- Rollback/correction: close the provider lane after an ambiguous-loss alert,
  reconcile receipts, rotate through the governed connection workflow, and
  reopen only after a reviewed receipt.
