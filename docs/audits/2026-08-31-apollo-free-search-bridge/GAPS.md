# Gaps

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`.

## `GAP-HRMNY-20260831-APOLLO-001` — hosted exact-SHA verification

- Decision/finding: local gates passed, but the immutable review SHA has not
  completed hosted lint, type, test, build, browser, security, preview, and
  disposable PostgreSQL jobs.
- Reason: local worktree proof is not a hosted receipt.
- Alternatives considered: infer acceptance from local output.
- Trade-offs: review remains pending until terminal checks arrive.
- Evidence: `EVID-HRMNY-20260831-APOLLO-001/002/004`.
- Confidence/freshness: high.
- Affected components: entire slice.
- Status: open; next immediate dependency.
- Supersedes/superseded-by: supersedes
  `GAP-HRMNY-20260831-RESEARCH-002/004` only after hosted proof passes; none.
- Rollback/correction: preserve failed jobs, correct forward, and rerun on the
  new exact SHA.

## `GAP-HRMNY-20260831-APOLLO-002` — production migration 0075

- Decision/finding: workflow and schema contracts exist, but production 0075,
  its backup/PITR receipt, target preflight, schema readback, and rollback proof
  have not run.
- Reason: production mutation is a separate human checkpoint.
- Alternatives considered: apply from this feature branch; mark source as
  configured.
- Trade-offs: deployed application compatibility must wait for release order.
- Evidence: unexecuted workflow and `EVID-HRMNY-20260831-APOLLO-003`.
- Confidence/freshness: high.
- Affected components: Supabase production and application release.
- Status: open; human authorization required at execution time.
- Supersedes/superseded-by: none.
- Rollback/correction: do not execute without exact target, backup, reviewed
  main SHA, and recovery path.

## `GAP-HRMNY-20260831-APOLLO-003` — managed Inngest acceptance

- Decision/finding: the Inngest event/function contract and cron fallback are
  tested, but cloud app identity, signing/event keys, function registration,
  event readback, retry delivery, revocation, and dead-letter operations are
  not configured or accepted.
- Reason: local handler execution cannot prove managed delivery.
- Alternatives considered: call the handler code a deployment; rely only on
  cron indefinitely.
- Trade-offs: durable cloud scheduling is not yet an operational capability.
- Evidence: source contracts and local handler tests.
- Confidence/freshness: high.
- Affected components: Inngest, scheduler ownership, observability.
- Status: open.
- Supersedes/superseded-by: partially narrows
  `GAP-HRMNY-20260831-RESEARCH-005`; none.
- Rollback/correction: keep the fallback worker scoped and disabled from live
  provider use until managed credentials and receipts are approved.

## `GAP-HRMNY-20260831-APOLLO-004` — durable bridge live provider canary

- Decision/finding: no live request has traversed this revision's durable
  enqueue, worker, Apollo readback, receipt, reconciliation, and destination
  flow.
- Reason: the historical 2026-08-27 zero-credit response used an older direct
  pathway and cannot accept the new bridge.
- Alternatives considered: inherit acceptance from the operation/provider;
  call Apollo before deployment.
- Trade-offs: provider and destination states remain `no` despite strong local
  proof.
- Evidence: acceptance table and prior audit comparison.
- Confidence/freshness: high.
- Affected components: Apollo, Vault connection, deployed worker, receipt and UI.
- Status: open; separately approved bounded zero-credit canary required.
- Supersedes/superseded-by: none.
- Rollback/correction: deploy only after review, use one named employee, capture
  usage/readback, and revoke or roll back on mismatch.

## `GAP-HRMNY-20260831-APOLLO-005` — exact paid-candidate approval service

- Decision/finding: the consumer contract exists, but no production service
  creates, presents, authorizes, expires, consumes, reconciles, or audits the
  exact candidate-bound paid approval.
- Reason: generic approval must never spend an Apollo credit.
- Alternatives considered: restore boolean confirmation; use an old allowance.
- Trade-offs: People Match remains unavailable.
- Evidence: `ADR-HRMNY-20260831-APOLLO-004` and fail-closed tests.
- Confidence/freshness: high.
- Affected components: approval/effect broker, People Match, provider usage.
- Status: open; no credit authorization requested.
- Supersedes/superseded-by: supersedes the former “paid gate ready” operational
  status while preserving the historical source record; none.
- Rollback/correction: implement a server-owned approval artifact and fresh
  action-time user confirmation before any live call.

## `GAP-HRMNY-20260831-APOLLO-006` — recovery and production retention proof

- Decision/finding: lease recovery, replay, cancellation, retry, and bounded
  retention are synthetic-tested; no production backup restore, queue recovery,
  schedule, volume, or backlog drill exists.
- Reason: failure injection in memory is not recovery acceptance.
- Alternatives considered: infer RTO/RPO from code.
- Trade-offs: recovery and production states remain open.
- Evidence: local tests and absence of a restore receipt.
- Confidence/freshness: high.
- Affected components: database, queue, cron, backup/PITR, observability.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: run an approved disposable/managed restore drill and
  reconcile receipts before production acceptance.

## `GAP-HRMNY-20260831-APOLLO-007` — named-user UAT

- Decision/finding: synthetic roles and browser journeys passed, but no named
  Sales employee has accepted the pending/reload/cancel/result workflow.
- Reason: automated behavior is not user acceptance.
- Alternatives considered: treat a green preview as UAT.
- Trade-offs: production acceptance remains open.
- Evidence: local browser receipt and acceptance table.
- Confidence/freshness: high.
- Affected components: staff Sales Growth journey.
- Status: open; named-user checkpoint after provider canary.
- Supersedes/superseded-by: none.
- Rollback/correction: record named user, exact revision, scenarios, failures,
  and corrections without exposing personal tokens.

## `GAP-HRMNY-20260831-APOLLO-008` — catalog action source gap

- Decision/finding: the resolved system-harness catalog has no exact callable
  Apollo People Search action contract for this operation.
- Reason: provider guidance cannot be invented from a neighboring capability.
- Alternatives considered: infer a catalog action; install/use an unrelated
  Apollo plugin; treat repository code as provider documentation.
- Trade-offs: official Apollo documentation remains the operation contract and
  the catalog gap stays visible.
- Evidence: resolved catalog search and `SOURCE-HRMNY-20260831-APOLLO-001`.
- Confidence/freshness: high for the 2026-08-31 catalog snapshot.
- Affected components: harness bridge plan and Graphify source edges.
- Status: open source gap; bounded fallback applied.
- Supersedes/superseded-by: none.
- Rollback/correction: bind a reviewed exact action only when the catalog gains
  one; do not fabricate an edge.
