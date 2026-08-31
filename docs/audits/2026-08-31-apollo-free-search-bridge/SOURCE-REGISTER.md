# Source register

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`.

## `SOURCE-HRMNY-20260831-APOLLO-001` — Apollo operation contract

- Decision/finding: official Apollo People API Search, authentication, rate
  limit, and usage-stat documentation govern this adapter; the resolved harness
  catalog contains no exact callable operation contract.
- Reason: provider fields, authentication, quotas, and usage readback are
  temporally variable and must come from official sources.
- Alternatives considered: infer from old code; use a neighboring catalog
  capability; use third-party tutorials.
- Trade-offs: the catalog edge remains an explicit gap.
- Evidence: [People API Search](https://docs.apollo.io/reference/people-api-search),
  [Authentication](https://docs.apollo.io/reference/authentication),
  [Rate limits](https://docs.apollo.io/reference/rate-limits), and
  [Usage stats](https://docs.apollo.io/reference/view-api-usage-stats).
- Confidence/freshness: high; revalidated 2026-08-31.
- Affected components: Apollo adapter, rate/reconcile evidence, Graphify source
  edge.
- Status: official source bound; catalog source gap open.
- Supersedes/superseded-by: refreshes the 2026-08-27 provider reference for this
  revision; none.
- Rollback/correction: fail closed on provider drift and update mapping/tests
  from official documentation only.

## `SOURCE-HRMNY-20260831-APOLLO-002` — Inngest execution contract

- Decision/finding: official event send, event, function, idempotency, and
  concurrency documentation govern the scheduler adapter.
- Reason: local handler semantics do not prove managed delivery behavior.
- Alternatives considered: infer cloud behavior from the SDK; make cron the
  permanent undocumented runtime.
- Trade-offs: managed configuration remains an acceptance gap.
- Evidence: [send](https://www.inngest.com/docs/reference/typescript/events/send),
  [events](https://www.inngest.com/docs/events),
  [functions](https://www.inngest.com/docs/reference/typescript/v4/functions/create),
  [idempotency](https://www.inngest.com/docs/guides/handling-idempotency), and
  [concurrency](https://www.inngest.com/docs/guides/concurrency).
- Confidence/freshness: high; revalidated 2026-08-31.
- Affected components: event schema, deterministic ID, concurrency, worker.
- Status: documented and locally tested; provider accepted `no`.
- Supersedes/superseded-by: none.
- Rollback/correction: keep database fencing authoritative if SDK/cloud behavior
  changes.

## `SOURCE-HRMNY-20260831-APOLLO-003` — Supabase connection and TLS contract

- Decision/finding: production migration accepts only canonical direct or
  session-pooler port-5432 connections with `sslmode=verify-full`, exact project
  identity, and database name.
- Reason: encryption without hostname verification does not prove destination
  identity.
- Alternatives considered: transaction pooler; port 6543; `sslmode=require`;
  arbitrary PostgreSQL host.
- Trade-offs: incorrectly formed but reachable URLs fail before database access.
- Evidence: [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres),
  [SSL enforcement](https://supabase.com/features/ssl-enforcement), and
  [platform security](https://supabase.com/docs/guides/security/platform-security).
- Confidence/freshness: high; revalidated 2026-08-31.
- Affected components: production migration guard and secret binding contract.
- Status: source/contract verified; production execution absent.
- Supersedes/superseded-by: none.
- Rollback/correction: stop on identity/TLS mismatch and correct the secure
  secret binding outside logs or source.

## `SOURCE-HRMNY-20260831-APOLLO-004` — immutable GitHub Action identities

- Decision/finding: production pins reviewed official action commits:
  checkout v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, setup-node
  v7.0.0 `820762786026740c76f36085b0efc47a31fe5020`, and pnpm action
  v6.0.10 `0977fd99725f1db4007ccb2928dbb4e90d06cc86`.
- Reason: a production workflow must not float third-party execution after
  review.
- Alternatives considered: major tags; unpinned marketplace references.
- Trade-offs: upgrades require a reviewed source change.
- Evidence: official repositories
  [actions/checkout](https://github.com/actions/checkout),
  [actions/setup-node](https://github.com/actions/setup-node), and
  [pnpm/action-setup](https://github.com/pnpm/action-setup).
- Confidence/freshness: high; tag targets verified 2026-08-31.
- Affected components: production migration workflow supply chain.
- Status: pinned in source; workflow unexecuted.
- Supersedes/superseded-by: none.
- Rollback/correction: review a new immutable commit and update evidence before
  promotion.

## `SOURCE-HRMNY-20260831-APOLLO-005` — prior evidence and correction boundary

- Decision/finding: the 2026-08-27 completion audit is valid historical proof
  that an older authenticated production direct search returned eight
  zero-credit candidates. Its statements that each candidate exposed a ready
  credit action do not authorize or accept the current paid flow.
- Reason: evidence must remain immutable while its operational interpretation
  can be superseded.
- Alternatives considered: delete the old audit; inherit all old acceptance;
  ignore the conflict.
- Trade-offs: readers must distinguish historical direct-path evidence from
  current durable-bridge acceptance.
- Evidence: `docs/audits/2026-08-27-os-completion/OUTCOMES.md`,
  `OFFICIAL-VERIFY.md`, and `RUNBOOKS.md`; current
  `ADR-HRMNY-20260831-APOLLO-004`.
- Confidence/freshness: high; reconciled 2026-08-31.
- Affected components: acceptance ledger, People Search, paid People Match.
- Status: historical source retained; paid-ready implication superseded.
- Supersedes/superseded-by: superseded operationally by this audit package;
  none.
- Rollback/correction: append a new correction record; never rewrite or remove
  the historical receipt.
