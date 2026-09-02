# Gaps

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
`41145c85e799f6b906dfca23a37aea0894cc9582`.

## `GAP-HRMNY-20260831-RESEARCH-001` — external review completion

- Decision/finding: duplicate hosted database, verification, 88-journey
  browser, and Vercel review-preview gates passed at product head `dd732f3...`
  and proof head `90fc72f...`. The separate Cursor security and approval
  reviewers also passed both review heads.
- Reason: terminal hosted execution and an external reviewer are distinct
  acceptance states.
- Alternatives considered: keep automated execution marked open; treat green
  CI as external security approval; merge automatically.
- Trade-offs: both review branches remain unmerged by release policy even
  though this bounded synthetic review state is terminal.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-007/011/012/013/014`.
- Confidence/freshness: high.
- Affected components: entire slice.
- Status: closed for synthetic implementation review; merge and every
  operational acceptance state remain separate.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve all negative and passing runs; correct forward
  on regression and never infer merge or operational acceptance.

## `GAP-HRMNY-20260831-RESEARCH-002` — durable free-Apollo receipt

- Decision/finding: free People Search is role/credential gated but lacks a
  durable request inbox, idempotency key, retry/dead-letter state, provider
  readback, reconciliation, and immutable receipt.
- Reason: a `live` response in browser memory is not provider acceptance.
- Alternatives considered: call the endpoint directly; mark connection state
  as authorization.
- Trade-offs: live free-provider acceptance remains closed.
- Evidence: independent contract review.
- Confidence/freshness: high.
- Affected components: Apollo free-search adapter and bridge records.
- Status: open; next safe implementation dependency.
- Supersedes/superseded-by: none.
- Rollback/correction: add a provider-neutral request/receipt bridge before a
  live canary.

## `GAP-HRMNY-20260831-RESEARCH-003` — exact paid-candidate approval binding

- Decision/finding: paid People Match still accepts caller candidate data plus
  a boolean confirmation; no server-owned reviewed candidate/approval artifact
  is bound at action time.
- Reason: a generic approval must never spend an Apollo credit.
- Alternatives considered: trust browser state; disable confirmation; consume
  a credit during search.
- Trade-offs: paid enrichment and live canary remain disabled.
- Evidence: independent contract review and paid-operation guards.
- Confidence/freshness: high.
- Affected components: People Match, approval/effect broker, receipts.
- Status: open; human checkpoint required only for the eventual exact candidate
  canary.
- Supersedes/superseded-by: none.
- Rollback/correction: bind candidate hash, approver, expiry, request ID, and
  provider readback server-side before enabling.

## `GAP-HRMNY-20260831-RESEARCH-004` — deployed schema readback

- Decision/finding: disposable PostgreSQL migrations and three concurrency
  cases passed twice. Deployed-environment indexes, RLS, grants, migration
  journal, and schema readback are not yet accepted for this slice.
- Reason: isolated CI proves database behavior but not the identity or state of
  a deployed destination.
- Alternatives considered: infer from unit tests; exercise production.
- Trade-offs: deployed readback requires destination identity and a later
  separately authorized production checkpoint.
- Evidence: guarded proof commit
  `8e4b8ba118e9bf5f33dc6f28c49edec38d7cc4f7`, first TLS failure
  `EVID-HRMNY-20260831-RESEARCH-008`, guarded TLS correction `53122fc...`,
  runtime/cleanup receipt `EVID-HRMNY-20260831-RESEARCH-009`, non-destructive
  correction `289721d...`, and duplicate passing runtime receipt
  `EVID-HRMNY-20260831-RESEARCH-010`.
- Confidence/freshness: high.
- Affected components: Sales store, migrations, CI database runtime.
- Status: disposable runtime closed; deployed-schema readback remains open and
  production migration remains a separate human checkpoint.
- Supersedes/superseded-by: none.
- Rollback/correction: use disposable CI Postgres first; production migration
  remains a separate human checkpoint.

## `GAP-HRMNY-20260831-RESEARCH-005` — scheduled provider research

- Decision/finding: durable scheduled signal/research jobs and provider-backed
  company/market research are not implemented by this core slice.
- Reason: the obsolete mock was removed, not mistaken for a real execution
  layer.
- Alternatives considered: keep the mock; add an unreceipted cron call.
- Trade-offs: initial capture is operator-driven.
- Evidence: removed daily mutation and current router inventory.
- Confidence/freshness: high.
- Affected components: Inngest/n8n scheduling, research providers, inbox/outbox.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: implement through durable jobs with scoped credentials,
  retries, dead letters, readback, and receipts.

## `GAP-HRMNY-20260831-RESEARCH-006` — evidence relevance and freshness

- Decision/finding: URL policy proves plausible public HTTPS syntax, not source
  availability, relevance, publication date, citation quality, or freshness.
- Reason: live network validation is a distinct provider operation.
- Alternatives considered: claim validity from parsing; fetch arbitrary URLs
  synchronously during capture.
- Trade-offs: an operator must judge the source until the governed research
  bridge exists.
- Evidence: validator contract and no provider receipt.
- Confidence/freshness: high.
- Affected components: source evidence and research review.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: add bounded availability/citation checks with SSRF
  defenses and immutable receipts.

## `GAP-HRMNY-20260831-RESEARCH-007` — live, recovery, user, and production acceptance

- Decision/finding: no live provider canary, deployment promotion, runtime
  `XERO_WRITE_ENABLED=false` readback, performance/accessibility result,
  recovery drill, named-user UAT, or production acceptance exists here.
- Reason: those are separately authorized states.
- Alternatives considered: infer acceptance from code, preview, or a healthy
  endpoint.
- Trade-offs: the slice cannot be described as production accepted.
- Evidence: acceptance table and absence of corresponding receipts.
- Confidence/freshness: high.
- Affected components: deployment, provider, recovery, and users.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: close each state independently in dependency order.
