# Outcomes

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
`41145c85e799f6b906dfca23a37aea0894cc9582`.

## `OUT-HRMNY-20260831-RESEARCH-001` — durable pre-CRM research boundary

- Decision/finding: HRMNY has an idempotent, evidence-bearing proposal boundary
  and an explicit Gate 1 promotion transaction.
- Reason: complete the first safe segment of
  `Signal → Research → Person → Outreach → Pipeline → Learn`.
- Alternatives considered: rebuild Sales as a new CRM; continue with mock
  research.
- Trade-offs: downstream provider and outreach acceptance remain open.
- Evidence: implementation commit and `EVID-HRMNY-20260831-RESEARCH-002/003`.
- Confidence/freshness: high for locally tested code.
- Affected components: Sales research, CRM identity, audit/inbox lineage.
- Status: code complete for the bounded core; hosted/operational acceptance
  pending.
- Supersedes/superseded-by: supersedes the visible daily mock pathway; none.
- Rollback/correction: reviewed revert or fail-closed forward correction.

## `OUT-HRMNY-20260831-RESEARCH-002` — no external effect consumed

- Decision/finding: implementation and tests used mock/off provider modes; no
  Apollo credit, external message, accounting write, production mutation, or
  provider configuration was used.
- Reason: Phase zero/provider operations remain read-only until their exact
  checkpoints.
- Alternatives considered: validate with a live free or paid provider now.
- Trade-offs: provider acceptance remains open.
- Evidence: test environment guards, secret scan, and absence of live receipts.
- Confidence/freshness: high.
- Affected components: Apollo, outreach, Xero, deployment.
- Status: passed containment; live acceptance not attempted.
- Supersedes/superseded-by: none.
- Rollback/correction: keep provider flags fail-closed and require separate
  authorization for every live effect.

## `OUT-HRMNY-20260831-RESEARCH-003` — truthful operator surface

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; branch
  `ahmadbukhari097/codex/phase-4b-sales-research-ui-20260831`; commit
  `21774d858b66676dc4f9cfd48d039abf7b079472`.
- Decision/finding: Sales operators can submit and review sourced proposals;
  non-Sales staff receive a visible read-only state; mock Apollo is not shown
  as connected discovery.
- Reason: the UI must express the server boundary and never imply an effect or
  permission that does not exist.
- Alternatives considered: leave dead controls; hide errors; retain mock
  results on the normal surface.
- Trade-offs: disconnected providers show a blocker instead of demo results.
- Evidence: UI commit, focused tests, E2E contracts, and independent UI review.
- Confidence/freshness: high for source/contract; hosted execution pending.
- Affected components: Sales research, Hunt, inbound, settings.
- Status: implemented; hosted, user, and production acceptance open.
- Supersedes/superseded-by: replaces the obsolete visible mock-research action;
  none.
- Rollback/correction: preserve read-only and fail-closed states in any revert.

## `OUT-HRMNY-20260831-RESEARCH-004` — synthetic PostgreSQL runtime accepted

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; PR #243;
  head `a31cf23fbbfdcfe99903df38fe3d455c9ec4373e`.
- Decision/finding: two independent hosted jobs passed the complete disposable
  PostgreSQL proposal/Gate 1 concurrency proof.
- Reason: close the process-local-behavior uncertainty before implementing the
  next provider bridge.
- Alternatives considered: retain the gap after passing jobs; exercise a
  deployed database before review.
- Trade-offs: synthetic database acceptance is closed while deployed schema,
  browser, provider, recovery, user, and production states remain separate.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-010`.
- Confidence/freshness: high.
- Affected components: Sales persistence and Gate 1 transaction boundary.
- Status: accepted for the disposable PostgreSQL runtime.
- Supersedes/superseded-by: supersedes the runtime portion of
  `GAP-HRMNY-20260831-RESEARCH-004`; none.
- Rollback/correction: retain exact tests and fail the review gate on any
  regression.

## `OUT-HRMNY-20260831-RESEARCH-005` — Phase 4 synthetic review gates accepted

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; PRs
  #241/#243; heads `dd732f3...`/`90fc72f...`.
- Decision/finding: duplicate current-head unit/build, disposable PostgreSQL,
  88-journey Chromium, and Vercel review-preview gates passed; the separate
  approval and security reviewers passed both review heads.
- Reason: close the bounded synthetic implementation phase before advancing to
  durable provider bridge work.
- Alternatives considered: merge immediately; call provider/live/recovery/UAT
  states accepted; continue without preserving negative receipts.
- Trade-offs: PRs remain unmerged and operational acceptance states remain
  open by design.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-014`.
- Confidence/freshness: high.
- Affected components: Sales research, Gate 1, role/UI boundaries, synthetic
  continuity, portal denial assertion, PostgreSQL proof.
- Status: synthetic review accepted; no production or live-provider claim.
- Supersedes/superseded-by: supersedes the hosted-gate portion of
  `GAP-HRMNY-20260831-RESEARCH-001`; none.
- Rollback/correction: retain PR separation and receipts; no automatic merge.
