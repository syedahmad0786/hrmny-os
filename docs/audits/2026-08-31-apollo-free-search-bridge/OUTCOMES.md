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

## `OUTCOME-HRMNY-20260831-APOLLO-005` — review stack and credential boundary repaired

- Decision/finding: the branch now stacks on the proven Phase 4c PostgreSQL
  boundary, preserves both distinct database proofs, and rejects every
  credentialed Apollo redirect. Independent re-review found no remaining P0/P1.
- Reason: source review must close security and hosted-execution blockers before
  publication.
- Alternatives considered: publish with expected CI failure; defer the redirect
  leak; overwrite the prior proof path.
- Trade-offs: two P2 gaps remain explicit and block later live/UAT acceptance.
- Evidence: `FAIL-HRMNY-20260831-APOLLO-005/006`,
  `EVID-HRMNY-20260831-APOLLO-007`, and commits `d66be9d/a343a51/a6ed4e3`.
- Confidence/freshness: high locally.
- Affected components: Apollo adapter, CI, PostgreSQL proof, acceptance ledger.
- Status: source/local gates complete; hosted and operational states open.
- Supersedes/superseded-by: supersedes the earlier sibling-base readiness claim;
  none.
- Rollback/correction: preserve the stacked dependency and fail-closed redirect
  contract; update the ledger with the exact final hosted SHA.

## `OUTCOME-HRMNY-20260901-APOLLO-006` — hosted synthetic bridge proof accepted

- Date/scope/actor: 2026-09-01; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
  `ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; tested head
  `528803e9b5ac988dff00b3e8e13a92b0d9cb7f71`.
- Decision/finding: the durable zero-credit bridge is source-complete and
  hosted-synthetic accepted. Both GitHub event matrices passed all application,
  browser, migration, Sales PostgreSQL, and 14 Apollo PostgreSQL scenarios.
- Reason: the phase can advance only after the real PostgreSQL state machine,
  not just its memory double, proves ownership, replay, lease, revocation,
  retry, dead-letter, retention, and stale-worker fences.
- Alternatives considered: carry the hosted gap into the next phase; accept
  only one event matrix; combine this receipt with deployment or provider
  acceptance.
- Trade-offs: the implementation slice is reviewable and dependency-ready, but
  no operational authority is implied and the two documented P2 rollout gaps
  remain.
- Evidence: `EVID-HRMNY-20260901-APOLLO-017`; runs `33523035823` and
  `33523069634`; PR `244` stacked on the green/open Phase 4c dependency PR.
- Confidence/freshness: high as of 2026-09-01.
- Affected components: Sales Growth Person discovery, durable integration
  runtime, migration 0075, CI, and release evidence.
- Status: hosted synthetic phase accepted; review pending; do not merge
  automatically.
- Supersedes/superseded-by: supersedes the hosted-open portion of
  `OUTCOME-HRMNY-20260831-APOLLO-003/005`; none.
- Rollback/correction: revert or correct forward through review, preserve all
  receipts, and rerun the exact matrix before any later release checkpoint.
