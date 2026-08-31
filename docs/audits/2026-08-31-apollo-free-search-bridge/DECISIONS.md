# Decisions

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`.

## `ADR-HRMNY-20260831-APOLLO-001` — free search is a durable queued effect

- Decision/finding: create an inbox receipt and opaque job atomically before
  any Apollo request; acknowledge quickly and process through a shared worker.
- Reason: provider latency or ambiguity must not turn browser retries into
  duplicate calls or untraceable results.
- Alternatives considered: synchronous browser-to-provider calls; a transient
  server promise; storing provider inputs in the queue payload.
- Trade-offs: results are asynchronous and require polling, while replay,
  cancellation, retry, and evidence become deterministic.
- Evidence: `EVID-HRMNY-20260831-APOLLO-001/002/004`.
- Confidence/freshness: high for code and local synthetic behavior on the
  implementation commit; provider acceptance is absent.
- Affected components: Sales UI/router/service, integration inbox, job queue,
  cron and Inngest workers, migration 0075.
- Status: implemented and locally tested; hosted and live states open.
- Supersedes/superseded-by: supersedes the direct free-search execution path;
  none.
- Rollback/correction: revert the implementation commit while keeping all live
  calls disabled; preserve existing receipts for audit.

## `ADR-HRMNY-20260831-APOLLO-002` — authorization is owner-bound and rechecked

- Decision/finding: resolve only the authenticated employee's approved Vault
  connection and recheck role, ownership, connection state, and attempt token
  immediately before the provider call.
- Reason: a shared key, display name, cached browser decision, or once-active
  connection is not action-time authorization.
- Alternatives considered: environment-key fallback; another employee's
  connection; tenant-wide credential; enqueue-time authorization only.
- Trade-offs: disconnected employees cannot borrow a company credential and
  must establish their own governed connection.
- Evidence: owner, revoke-race, connection-isolation, and role-change tests in
  `EVID-HRMNY-20260831-APOLLO-002/004`.
- Confidence/freshness: high for tested policy; production identity mapping is
  not user accepted.
- Affected components: key resolver, principal policy, worker, admin revoke.
- Status: implemented and locally tested.
- Supersedes/superseded-by: refines the approved-only connected-app policy;
  none.
- Rollback/correction: fail closed and correct the identity or connection
  record; never add an environment fallback.

## `ADR-HRMNY-20260831-APOLLO-003` — retain only an allowlisted result projection

- Decision/finding: map documented professional identity fields into a bounded
  result and reject raw response, email, phone, full last name, and profile URL
  persistence for free search.
- Reason: the operational receipt needs evidence and lineage, not unrestricted
  provider or personal data.
- Alternatives considered: persist the full body; log it; reuse the paid-match
  mapper.
- Trade-offs: later provider fields require an explicit contract change and
  migration rather than appearing automatically.
- Evidence: mapper contracts and PostgreSQL privacy assertions in
  `EVID-HRMNY-20260831-APOLLO-002/004`.
- Confidence/freshness: high for local/test mapping; live provider drift remains
  a canary concern.
- Affected components: Apollo adapter, receipt result, UI projection, logs.
- Status: implemented; live schema compatibility unaccepted.
- Supersedes/superseded-by: none.
- Rollback/correction: fail on unknown shape and update the reviewed allowlist
  with fixtures and privacy tests.

## `ADR-HRMNY-20260831-APOLLO-004` — paid People Match is unavailable

- Decision/finding: a paid match requires a server-owned exact candidate hash,
  approver, expiry, operation, and one-time consumption artifact; this slice
  supplies no production issuer or caller, so the operation is locked.
- Reason: a boolean or generic approval cannot authorize a provider credit.
- Alternatives considered: keep the historic one-shot boolean; trust browser
  candidate data; enable a global paid flag.
- Trade-offs: paid enrichment cannot be demonstrated until the approval/effect
  broker slice is implemented and separately reviewed.
- Evidence: paid-match fail-closed contracts in
  `EVID-HRMNY-20260831-APOLLO-002`; gap `GAP-HRMNY-20260831-APOLLO-005`.
- Confidence/freshness: high.
- Affected components: People Match adapter, Sales router/UI, approval policy.
- Status: locked by design.
- Supersedes/superseded-by: supersedes the operational implication in the
  2026-08-27 outcome that each candidate exposed a ready paid action; the old
  production free-search receipt remains historical evidence only; none.
- Rollback/correction: do not restore the boolean path; build the exact approval
  artifact and provider reconciliation first.

## `ADR-HRMNY-20260831-APOLLO-005` — one database fence governs both schedulers

- Decision/finding: cron fallback and Inngest invoke the same worker; a shared
  receipt/job attempt token, compare-and-set transitions, lease, and global
  Inngest concurrency limit prevent competing effects.
- Reason: scheduler choice must not change idempotency or authorization.
- Alternatives considered: separate handlers; one Fly Machine per request;
  provider call deduplication by memory lock.
- Trade-offs: global concurrency one is conservative and may reduce throughput,
  but it creates a safe initial provider ceiling.
- Evidence: worker, replay, lease, retry, and handler tests in
  `EVID-HRMNY-20260831-APOLLO-002/004`.
- Confidence/freshness: high locally; managed Inngest execution unproven.
- Affected components: Inngest function, cron route, integration inbox/jobs.
- Status: implemented; cloud configuration pending.
- Supersedes/superseded-by: none.
- Rollback/correction: disable the failing scheduler while preserving the shared
  database state machine; never introduce a second provider caller.

## `ADR-HRMNY-20260831-APOLLO-006` — production migration is an explicit release

- Decision/finding: migration 0075 is append-only and can run only from exact
  reviewed `main`, with a named backup/PITR receipt, canonical project identity,
  direct/session-pooler port 5432, `verify-full` TLS, exact 0074 preflight, and
  complete 0075 readback. The obsolete 0068–0074 workflow is a secret-free
  fail-fast stub.
- Reason: source code and a healthy preview do not authorize a production
  database mutation.
- Alternatives considered: automatic PR migrations; reusable broad migration
  runner; relaxed TLS; manual console SQL.
- Trade-offs: promotion requires a precise human checkpoint and production
  environment controls.
- Evidence: migration contract/hash and workflow tests in
  `EVID-HRMNY-20260831-APOLLO-003/004`.
- Confidence/freshness: high for source contract; production controls and
  execution remain unverified.
- Affected components: migration 0075, CI verifier, production workflows.
- Status: implemented but unexecuted.
- Supersedes/superseded-by: retires the 0068–0074 workflow; none.
- Rollback/correction: stop before apply on any mismatch; after apply use an
  approved forward correction or verified restore plan, never rewrite journal
  history.
