# Outcomes

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`.

## `OUTCOME-HRMNY-20260831-APOLLO-001` — durable zero-credit bridge implemented

- Decision/finding: the reviewed slice now covers request capture, atomic
  receipt/job persistence, idempotency, owner-scoped credential resolution,
  action-time authorization, provider mapping, retries, dead letters,
  cancellation, revocation, reconciliation, retention, and safe UI readback.
- Reason: close the next safe Sales Growth dependency without spending or
  deploying.
- Alternatives considered: direct provider call; broad CRM rewrite; paid
  enrichment first.
- Trade-offs: operational acceptance remains separate from code completion.
- Evidence: `EVID-HRMNY-20260831-APOLLO-001/002/004/005`.
- Confidence/freshness: high for local source and synthetic execution.
- Affected components: Sales Growth Person stage and integration runtime.
- Status: code complete locally; hosted review pending.
- Supersedes/superseded-by: implements the bounded remedy for
  `GAP-HRMNY-20260831-RESEARCH-002`; closure awaits hosted proof.
- Rollback/correction: revert the slice and keep provider mode closed.

## `OUTCOME-HRMNY-20260831-APOLLO-002` — paid and legacy bypasses contained

- Decision/finding: legacy direct enrichment is synthetic-only, old UI routes
  fail closed or direct operators to the governed path, and paid People Match
  cannot execute without an exact consumed approval artifact.
- Reason: removal of bypasses is required before provider acceptance.
- Alternatives considered: preserve hidden routes; rely on a global flag.
- Trade-offs: one historic workflow is unavailable until rebuilt through the
  effect broker.
- Evidence: focused negative tests and independent reviews.
- Confidence/freshness: high.
- Affected components: Research Console, Apollo match, Sales router/UI.
- Status: contained locally.
- Supersedes/superseded-by: supersedes the prior “paid gate ready” operating
  implication, not the historical zero-credit receipt itself.
- Rollback/correction: preserve fail-closed behavior during any later rebuild.

## `OUTCOME-HRMNY-20260831-APOLLO-003` — verification is explicitly bounded

- Decision/finding: all local static/test/build gates and five safe browser
  journeys passed, while hosted database, deployment, provider, destination,
  recovery, user, and production states remain open.
- Reason: acceptance states must reflect receipts, not implementation optimism.
- Alternatives considered: report the bridge production-ready; inherit older
  provider acceptance.
- Trade-offs: the visible status is less impressive but operationally accurate.
- Evidence: `EVID-HRMNY-20260831-APOLLO-002/005/006` and acceptance table.
- Confidence/freshness: high as of the implementation commit.
- Affected components: release evidence and phase dependency graph.
- Status: local tested; all later acceptance states `no`.
- Supersedes/superseded-by: corrects any broader prior completion reading; none.
- Rollback/correction: update each state only with an exact revision-bound
  receipt; preserve negative evidence.

## `OUTCOME-HRMNY-20260831-APOLLO-004` — financial and external effects unchanged

- Decision/finding: no live Apollo/Hunter/NeverBounce/AI call, provider credit,
  external message, production migration, deployment, UAT action, or accounting
  write occurred; `XERO_WRITE_ENABLED=false` remains the contract.
- Reason: this phase authorized safe code and synthetic proof only.
- Alternatives considered: bundle a canary or production migration into the
  implementation turn.
- Trade-offs: live acceptance requires later precise checkpoints.
- Evidence: environment/test configuration, source review, and absence of
  provider/deployment receipts.
- Confidence/freshness: high.
- Affected components: providers, production, finance, external recipients.
- Status: unchanged and protected.
- Supersedes/superseded-by: none.
- Rollback/correction: stop on any unexpected external receipt and investigate
  before further work.
