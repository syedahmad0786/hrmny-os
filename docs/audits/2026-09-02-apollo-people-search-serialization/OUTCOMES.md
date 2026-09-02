# Outcomes

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commits `fc2d288074bc44624abbb9e701b5c5ffa7adb775` and
`900bc0e548061b5b6872c3552b18ff8d1c309a6b`, plus correction
`d1ab23c36ebbde5320967f0d806251193919b1c6` and no-helper correction
`8bce5127ef4c817789a3fe8ad3e10677bd9a9c82`, plus fixture correction
`0f3ac24ddd2645b4b03247ec720fe078406a0d15`.

## `OUTCOME-HRMNY-20260902-APOLLO-009` — dependency-ready free-search lane

- Decision/finding: the implementation now coordinates free Apollo People
  Search across durable scheduler entry points, reauthorizes the exact actor and
  credential at dispatch, serializes supported key save/disconnect, preserves
  honest ambiguity and database-clock lease ownership, fails closed on missing
  Vault projections or unknown null leases, and provides a guarded additive
  migration and cutover workflow.
- Reason: Phase 4e fixed browser principal state but deliberately left
  provider-wide execution as the next dependency.
- Alternatives considered: leave live activation blocked indefinitely; expand
  into paid Match or production rollout in the same slice.
- Trade-offs: hosted database and all operational acceptance states remain open.
- Evidence: implementation commits,
  `EVID-HRMNY-20260902-APOLLO-022/023/024`, and migration SHA
  `4941903ab873fabbb4a7359a83b95a48daee1df9eddae9ba38fa3cfb78bd68a7`.
- Confidence/freshness: high for source and local deterministic proof.
- Affected components: free Sales Growth person discovery through Apollo.
- Status: implemented, locally tested, unmerged, undeployed, provider-unaccepted.
- Supersedes/superseded-by: intended to supersede only the free-search portion
  of prior concurrency gaps after hosted proof; none.
- Rollback/correction: keep production unchanged and Apollo closed until exact
  hosted and human checkpoints pass.

## `OUTCOME-HRMNY-20260902-APOLLO-010` — no external effect

- Decision/finding: this phase made no live provider request, consumed no
  Apollo credit, sent no message, changed no production database, deployed no
  runtime, merged no branch, and performed no accounting write.
- Reason: Phase 4f authorization covers source and synthetic verification only.
- Alternatives considered: use a live canary as a test shortcut.
- Trade-offs: provider acceptance remains open but evidence boundaries remain
  reliable.
- Evidence: environment-safe test configuration, manual-only migration
  workflow, and change/secret review.
- Confidence/freshness: high on 2026-09-02.
- Affected components: Apollo, Supabase, deployment, Gmail, Xero.
- Status: verified no-effect local phase; `XERO_WRITE_ENABLED=false` preserved.
- Supersedes/superseded-by: none.
- Rollback/correction: none required; any future external effect needs its own
  approval and receipt.

## `OUTCOME-HRMNY-20260902-APOLLO-011` — hosted disagreement corrected without weakening production

- Decision/finding: the two exact-head hosted matrices exposed five bounded
  PostgreSQL fixture defects. Source correction `0f3ac24` now follows the
  database clock, preserves append-only audit history, settles killed-client
  continuations, and uses a fresh recovery client. The complete local gate is
  green, while fresh hosted proof remains pending.
- Reason: acceptance evidence must correct the fixture when the runtime and
  database contract are right, and must preserve a separately discovered
  dependency failure instead of hiding it.
- Alternatives considered: change production semantics to satisfy stale
  expectations; erase audit evidence; accept successful CI sub-jobs; mix the
  Postgres.js mitigation into the current PR.
- Trade-offs: PR #246 needs another hosted matrix, and connection-loss recovery
  remains blocked by the isolated `GAP-019` dependency slice.
- Evidence: `EVID-HRMNY-20260902-APOLLO-025/026`,
  `FAIL-HRMNY-20260902-APOLLO-024/025`, source commit `0f3ac24`, and clean
  independent review.
- Confidence/freshness: high for local corrected source on 2026-09-02; hosted
  correction and runtime recovery are unaccepted.
- Affected components: Apollo PostgreSQL proof, evidence state, dependency
  roadmap, and recovery acceptance.
- Status: locally accepted, unmerged, undeployed, provider-unaccepted; hosted
  proof pending.
- Supersedes/superseded-by: supersedes only the stale local-source status in
  `OUTCOME-HRMNY-20260902-APOLLO-009`; none.
- Rollback/correction: keep production and Apollo unchanged, preserve all
  failed receipts, and require exact-head hosted proof before the next stacked
  dependency slice.

## `OUTCOME-HRMNY-20260902-APOLLO-012` — Phase 4f synthetic proof accepted

- Decision/finding: exact head
  `ca6408b2e50cc0ece42b5859770785d93bed8147` passed both push and
  pull-request CI matrices, including all 40 Apollo PostgreSQL cases, migration
  and Sales database proof, repository verification/build, and browser
  acceptance.
- Reason: Phase 4f required two terminal, independent hosted event receipts
  after the fixture correction before the slice could become dependency-ready.
- Alternatives considered: accept one event path; accept database only; merge
  automatically; broaden the phase into driver hardening or a live canary.
- Trade-offs: the slice is now ready for human review, but remains unmerged and
  production/provider acceptance stays closed. The separate Postgres.js P1 is
  the immediate dependency-ready engineering slice.
- Evidence: `EVID-HRMNY-20260902-APOLLO-027`, push run `33582006041`,
  pull-request run `33582008378`, and PR #246.
- Confidence/freshness: high for exact-head source and synthetic behavior on
  2026-09-02.
- Affected components: free Apollo People Search, migration `0076`, hosted CI,
  browser acceptance, evidence state, and the next dependency.
- Status: source and synthetic acceptance complete; unmerged, production
  undeployed, provider-unaccepted, recovery-unverified, and user-unaccepted.
- Supersedes/superseded-by: supersedes the hosted-pending state in
  `OUTCOME-HRMNY-20260902-APOLLO-011`; none.
- Rollback/correction: preserve exact run receipts, keep Apollo and production
  unchanged, and invalidate this acceptance if implementation or acceptance
  fixture source changes.
