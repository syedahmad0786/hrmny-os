# Runbooks

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
lineage `6b82f165b3c552a2daa95c88d4010156aafbbcc1`, `d66be9d`,
`a343a51`, `a6ed4e3`, `8a94ef6`, and `bb75712`; stacked base
`ff80e3ac8befbd2075b537ce23018072b3790203`.

## `PROC-HRMNY-20260831-APOLLO-001` — safe synthetic verification

- Decision/finding: run lint, typecheck, full tests, build, migration hash, and
  focused desktop/mobile browser journeys with memory database, mock Apollo,
  disabled paid providers, no AI/network keys, and `XERO_WRITE_ENABLED=false`.
- Reason: tests must be deterministic and incapable of live provider effects.
- Alternatives considered: use developer credentials; skip browser execution.
- Trade-offs: provider compatibility is deferred to a separately authorized
  canary.
- Evidence: `EVID-HRMNY-20260831-APOLLO-002/005`.
- Confidence/freshness: high.
- Affected components: entire slice and local acceptance runtime.
- Status: last successful execution 2026-08-31.
- Supersedes/superseded-by: none.
- Rollback/correction: stop at the first unsafe environment value; never place
  provider keys in test logs or source.
- Prerequisites/permissions: isolated worktree; installed dependencies; no live
  credential or external authorization.
- Tests: root lint/typecheck/test/build, database tests, diff check, five browser
  journeys.

## `PROC-HRMNY-20260831-APOLLO-002` — employee free-search operation

- Decision/finding: an eligible employee opens Sales Growth Person discovery,
  verifies their own connected Apollo state, enters bounded UAE job criteria,
  submits once, and follows the durable pending request through completion or a
  terminal safe status. Reload resumes the same request.
- Reason: connect operator intent to one traceable zero-credit provider effect.
- Alternatives considered: direct call; use global readiness; borrow a shared
  connection.
- Trade-offs: disconnected or revoked users fail closed.
- Evidence: `ADR-HRMNY-20260831-APOLLO-001/002` and browser tests.
- Confidence/freshness: high locally; named-user/provider acceptance pending.
- Affected components: Hunt UI, principal, receipt, job, worker.
- Status: implemented; do not use live until canary approval.
- Supersedes/superseded-by: replaces direct Research Console discovery.
- Rollback/correction: cancel only a pending request; preserve terminal receipts
  and create a new idempotency identity for materially changed criteria.
- Prerequisites/permissions: eligible role; exact employee membership; approved
  personal Apollo connection; deployed accepted revision.
- Tests: disconnected denial, owner isolation, reload, cancellation, result
  projection, mobile containment.

## `PROC-HRMNY-20260831-APOLLO-003` — retry, revoke, and reconcile

- Decision/finding: retry only typed transient provider failures under the same
  receipt identity and fresh attempt token; on 401/403 mark only the exact
  owner's connection error; on uncertainty stop and compare provider usage,
  receipt, and destination before any new request.
- Reason: preserve idempotency and prevent cross-user or repeated effects.
- Alternatives considered: retry all errors; delete a receipt; tenant-wide
  revoke.
- Trade-offs: uncertain requests may require manual reconciliation.
- Evidence: worker and revoke-race tests.
- Confidence/freshness: high locally.
- Affected components: worker, connected apps, receipt, provider usage.
- Status: implemented; live drill pending.
- Supersedes/superseded-by: none.
- Rollback/correction: pause the worker, inspect secret-safe IDs/state, correct
  forward, and never reuse or erase the old attempt token.
- Prerequisites/permissions: read-only operational access; administrator action
  only for explicit connection revocation.
- Tests: typed retry, dead letter, lease recovery, 401/403, cross-user isolation.

## `PROC-HRMNY-20260831-APOLLO-004` — hosted disposable PostgreSQL proof

- Decision/finding: hosted CI starts the pinned Supabase PostgreSQL service,
  verifies fresh and 0074-to-0075 migration paths, retains only the disposable
  fresh database, runs the Phase 4c Sales proposal persistence proof, and then
  runs the distinct Apollo queue/concurrency/privacy proof against localhost
  `hrmny_migration_fresh` with network fetch disabled.
- Reason: prove database races, indexes, RLS, grants, and migration compatibility
  without touching production.
- Alternatives considered: local memory proof; production smoke.
- Trade-offs: proof depends on hosted runner availability.
- Evidence: CI database job; distinct `test:ci:postgres` and
  `test:ci:apollo-postgres` commands; both setup modules' fail-closed guards.
- Confidence/freshness: high for design; execution pending.
- Affected components: CI, PostgreSQL, migration 0075, bridge concurrency.
- Status: pending exact-SHA hosted receipt.
- Supersedes/superseded-by: intended to close
  `GAP-HRMNY-20260831-RESEARCH-004` after success.
- Rollback/correction: allow teardown of the disposable CI service only; never
  permit non-local host or another database name.
- Prerequisites/permissions: review branch stacked on Phase 4c; GitHub-hosted
  ephemeral service; `CI=true`; explicit CI write/proof gates; loopback host;
  exact disposable database; no production secret. Plaintext TLS is permitted
  only for this fully gated loopback tuple; every other target defaults to TLS.
- Tests: migration verifier, Sales proposal PostgreSQL proof, and
  `apollo-search-postgres.test.ts` through separate configurations.

## `PROC-HRMNY-20260831-APOLLO-005` — production migration 0075 checkpoint

- Decision/finding: after reviewed code reaches `main`, a human supplies the
  exact reviewed SHA, canonical project ref, verified backup/PITR receipt, and
  exact confirmation to the protected Production workflow. The workflow must
  pass read-only 0074 preflight, append only 0075, then pass complete readback.
- Reason: authorize and verify the irreversible boundary at the moment required.
- Alternatives considered: feature-branch execution; automatic merge migration;
  broad database URL.
- Trade-offs: this procedure pauses at a human checkpoint.
- Evidence: `ADR-HRMNY-20260831-APOLLO-006` and source contract.
- Confidence/freshness: high for procedure; never executed.
- Affected components: production Supabase schema and release order.
- Status: blocked by design until exact approval and recovery evidence.
- Supersedes/superseded-by: replaces the retired 0068–0074 workflow.
- Rollback/correction: on any preflight mismatch stop with no write; after apply
  use the approved recovery/forward-correction plan and retain journal evidence.
- Prerequisites/permissions: merged reviewed SHA, environment approval,
  organization/project ownership, secure secret already bound, backup receipt,
  and explicit production authorization.
- Tests: exact URL/TLS/project/schema/hash contract; preflight and postflight
  readback.

## `PROC-HRMNY-20260831-APOLLO-006` — bounded live zero-credit canary

- Decision/finding: after deployment and 0075, one named employee may submit one
  non-sensitive zero-credit People Search only after separate approval; capture
  exact release, employee/connection IDs, request ID, provider usage before and
  after, thread-safe result receipt, destination readback, replay, revoke, and
  cleanup evidence.
- Reason: prove the real bridge without paid enrichment or external messaging.
- Alternatives considered: broad rollout; inherit the old direct-path receipt.
- Trade-offs: canary scope is deliberately small.
- Evidence: this runbook and open `GAP-HRMNY-20260831-APOLLO-004`.
- Confidence/freshness: procedure reviewed; not authorized or executed.
- Affected components: deployed app, Vault, Apollo, worker, receipt, UI.
- Status: future human checkpoint.
- Supersedes/superseded-by: none.
- Rollback/correction: revoke the exact connection or roll back the release,
  stop intake, reconcile provider usage, and preserve the receipt.
- Prerequisites/permissions: provider ownership/scopes, zero-credit confirmation,
  cost ceiling, deployed exact SHA, named employee, observability, rollback.
- Tests: one success, exact replay without second call, revoke/denial, provider
  and destination reconciliation. Paid People Match remains disabled.
