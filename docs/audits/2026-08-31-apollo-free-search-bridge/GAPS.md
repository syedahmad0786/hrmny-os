# Gaps

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`.

## `GAP-HRMNY-20260831-APOLLO-001` — hosted exact-SHA verification

- Decision/finding: exact head `6828a1a` passed both hosted verify jobs and both
  90-test browser jobs, but both disposable PostgreSQL jobs stopped on a
  production-only legacy-identity assertion before the Sales/Apollo database
  proofs. Repair commit `2b62db1` is not yet hosted-verified.
- Reason: local worktree proof is not a hosted receipt.
- Alternatives considered: infer acceptance from local output.
- Trade-offs: review remains pending until terminal checks arrive.
- Evidence: `EVID-HRMNY-20260831-APOLLO-001/002/004/010/011/012`.
- Confidence/freshness: high.
- Affected components: entire slice.
- Status: open; exact repair-head database/verify/browser receipts are the next
  immediate dependency.
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

## `GAP-HRMNY-20260831-APOLLO-009` — pending browser state is not principal-scoped

- Decision/finding: the Hunt page session-storage key is shared by the browser
  tab rather than namespaced to the authenticated principal.
- Reason: switching accounts in one tab can reveal the prior operator's search
  terms or temporarily lock the new operator's form, although server-side
  receipt reads remain owner-authorized.
- Alternatives considered: ignore browser account switching; store no pending
  state; add an unreviewed client identity source during ship repair.
- Trade-offs: reload recovery remains available, but this privacy/UX edge must be
  fixed before named-user rollout.
- Evidence: `apps/web/src/app/(staff)/crm/hunt/page.tsx` and independent review.
- Confidence/freshness: high for client state; no server authorization bypass
  demonstrated.
- Affected components: Sales Hunt browser session and account switching.
- Status: open P2; blocks named-user/production acceptance, not hosted synthetic
  database proof.
- Supersedes/superseded-by: none.
- Rollback/correction: namespace or clear the pending state using a verified
  server-provided principal identifier and add an account-switch browser test.

## `GAP-HRMNY-20260831-APOLLO-010` — no cross-scheduler provider-wide limiter

- Decision/finding: Inngest concurrency one does not coordinate globally with
  the cron fallback, so the two entry points can claim two different Apollo jobs
  concurrently. The shared database fence still prevents duplicate execution of
  the same receipt.
- Reason: the lease and attempt token are request-scoped, not provider-scoped.
- Alternatives considered: overstate the existing fence; disable a scheduler
  during this source-only phase; add an unreviewed global mutex.
- Trade-offs: managed/live rollout remains blocked until scheduler ownership or
  a durable provider-wide limiter is proven; synthetic hosted proof can proceed.
- Evidence: Inngest function, cron route, shared worker, and independent review.
- Confidence/freshness: high for code; no live overlap receipt.
- Affected components: scheduling, Apollo rate limits, backlog operations.
- Status: open P2; required before live provider canary.
- Supersedes/superseded-by: corrects the throughput claim in
  `ADR-HRMNY-20260831-APOLLO-005`; none.
- Rollback/correction: select one live dispatch owner or add a durable
  provider-wide claim/limit, then failure-inject both entry points.

## `GAP-HRMNY-20260831-APOLLO-011` — residual synthetic coverage backlog

- Decision/finding: the 80% path-group target is met, while six groups remain
  uncovered: tRPC caller contracts; legacy enrichment/admin redaction routes;
  cron maximum-backlog counters; PostgreSQL missing/not-due/terminal readback;
  connected browser lifecycle states; and cross-principal/two-tab browser edges.
- Reason: the bounded ship repair prioritized the three highest-yield offline
  groups without introducing production changes or hiding remaining risk.
- Alternatives considered: claim full coverage; expand this vertical slice into
  every browser and router edge before hosted proof.
- Trade-offs: hosted synthetic review can proceed at 24/30 groups, but later
  rollout phases must close the security- and user-bound browser items.
- Evidence: independent coverage map and
  `EVID-HRMNY-20260831-APOLLO-008`.
- Confidence/freshness: medium-high; static path grouping is review evidence,
  not a runtime coverage percentage.
- Affected components: router, cron operations, PostgreSQL worker readback, Hunt
  browser lifecycle, test strategy.
- Status: open P2 backlog; cross-principal coverage remains tied to gap 009 and
  named-user acceptance.
- Supersedes/superseded-by: three of the initial nine coverage findings were
  closed by `EVID-HRMNY-20260831-APOLLO-008`; none.
- Rollback/correction: add deterministic tests by layer, bind each to the exact
  contract, and never use live provider credentials for coverage.
