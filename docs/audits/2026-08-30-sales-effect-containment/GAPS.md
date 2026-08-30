# Gaps

Common scope/date/actor for every gap: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-1-sales-effect-containment-20260830`; commit
`10d997c7e28221f186ecec7aa3b101b2a6096dc3`. All gaps are current with high
confidence unless noted. Closing evidence must name a rollback path and may not
infer provider/user/production acceptance from code or CI.

## `GAP-HRMNY-20260830-SALES-001` — one atomic scheduler owner

- Decision/finding: GitHub, Vercel, and Inngest ownership and atomic claim are
  not yet reconciled.
- Reason: the current check-then-record sequence can duplicate local receipts.
- Alternatives considered: tolerate overlap; choose an owner without live
  inventory.
- Trade-offs: scheduled proposal activation remains blocked.
- Evidence: scheduler audit and daily-cron implementation.
- Affected components: cron, Inngest, Vercel, recovery.
- Status: open; next dependency before scheduling real proposals.
- Supersedes/superseded-by: carries Phase 0 scheduler gap; none.
- Rollback/correction: keep all effectful schedules disabled.

## `GAP-HRMNY-20260830-SALES-002` — proposal-only research runtime

- Decision/finding: no approved runtime yet produces evidence-bearing research
  proposals without persisting canonical CRM contacts/deals.
- Reason: legacy daily lead generation was effectful and is now contained.
- Alternatives considered: re-enable mock-first pipeline; manual-only forever.
- Trade-offs: daily research automation is unavailable.
- Evidence: `proposal_runtime_unavailable` test receipt.
- Affected components: Signal, Research, scoring, jobs.
- Status: open; next Sales implementation slice.
- Supersedes/superseded-by: none.
- Rollback/correction: keep scheduler inert.

## `GAP-HRMNY-20260830-SALES-003` — outreach effect broker

- Decision/finding: Gmail send still lacks a complete durable outbox,
  idempotency key, provider readback, reconciliation, and immutable receipt.
- Reason: approval and send are not equivalent states.
- Alternatives considered: direct Composio call; auto-send.
- Trade-offs: live outreach remains unaccepted.
- Evidence: Sales audit and Phase 0 source register.
- Affected components: Outreach, Gmail/Composio, approvals.
- Status: open; sends remain human-gated.
- Supersedes/superseded-by: carries Phase 0 Sales bridge gap; none.
- Rollback/correction: preserve drafts and never retry an uncertain send.

## `GAP-HRMNY-20260830-SALES-004` — effect-specific authorization

- Decision/finding: generic staff access is still broader than the target
  Sales effect permissions.
- Reason: read, approve, spend, and send require different authority.
- Alternatives considered: role-only staff gate; provider key possession.
- Trade-offs: additional server policy work is required.
- Evidence: Sales route audit.
- Affected components: Apollo enrichment, verification, outreach, CRM writes.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: deny the effect until an explicit permission exists.

## `GAP-HRMNY-20260830-SALES-005` — reply and delivery reconciliation

- Decision/finding: reply/delivery classification is not yet backed by complete
  provider receipts and reconciliation.
- Reason: heuristics cannot prove delivery or recipient response.
- Alternatives considered: infer from local state; manual spreadsheet.
- Trade-offs: learning and pipeline automation remain provisional.
- Evidence: Sales audit.
- Affected components: Gmail events, Pipeline, Learn.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve raw provider receipt references and allow manual
  correction.

## `GAP-HRMNY-20260830-SALES-006` — approval and send UI separation

- Decision/finding: the general Approvals surface still combines conceptual
  approve/send actions in ways that need a dedicated effect state model.
- Reason: approval must not itself dispatch an external message.
- Alternatives considered: retain combined action; hide the screen.
- Trade-offs: an additional UI/service slice is required.
- Evidence: UI and Sales audits.
- Affected components: approvals and outreach.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: disable send while retaining review data.

## `GAP-HRMNY-20260830-SALES-007` — n8n outbound authority

- Decision/finding: outbound n8n triggering still accepts caller-controlled
  behavior without the complete bridge receipt contract.
- Reason: configured connectivity does not authorize an effect.
- Alternatives considered: treat active workflow as approval; remove n8n.
- Trade-offs: production triggering remains disabled.
- Evidence: Sales/provider audit.
- Affected components: n8n, callbacks, outbox, reconciliation.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: keep `N8N_ALLOW_PRODUCTION_TRIGGER=false`.

## `GAP-HRMNY-20260830-SALES-008` — realistic deterministic research fixtures

- Decision/finding: some deterministic research code still uses example-domain
  material that is not suitable as production evidence.
- Reason: synthetic fixtures must be unmistakable and hidden by default.
- Alternatives considered: treat examples as real research; call live search in
  tests.
- Trade-offs: stronger fixtures and lineage contracts are needed.
- Evidence: Sales audit.
- Affected components: Research, scoring, UI filtering.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: label and exclude synthetic records.

## `GAP-HRMNY-20260830-SALES-009` — replacement downstream acceptance coverage

- Decision/finding: retiring the broad monolithic live proof leaves portal,
  onboarding, delivery, and finance without a replacement disposable-target
  end-to-end receipt in this slice.
- Reason: those domains need separate authority and acceptance boundaries.
- Alternatives considered: keep the unsafe broad proof; claim unit tests as
  destination acceptance.
- Trade-offs: more bounded workflows and PRs.
- Evidence: `TRADEOFF-HRMNY-20260830-SALES-003`.
- Affected components: portal, onboarding, delivery, finance.
- Status: open; explicitly not accepted.
- Supersedes/superseded-by: supersedes the old combined claim; none.
- Rollback/correction: retain historical evidence as dated only.

## `GAP-HRMNY-20260830-SALES-010` — browser, live, recovery, and UAT acceptance

- Decision/finding: Linux CI browser acceptance, deployment, provider canaries,
  destination reconciliation, restore proof, and named-user UAT are pending.
- Reason: local Windows Chromium could not consume Next API response bodies,
  and no live action was authorized in this slice.
- Alternatives considered: claim build success as acceptance; use production
  credentials locally.
- Trade-offs: the PR cannot advance beyond locally tested until CI completes,
  and later live stages require precise human checkpoints.
- Evidence: `FAIL-HRMNY-20260830-SALES-006` and `EVID-HRMNY-20260830-SALES-008`.
- Affected components: release, browser journeys, providers, recovery, users.
- Status: open; Linux CI is the next automatic proof.
- Supersedes/superseded-by: none.
- Rollback/correction: do not merge or deploy on a failed browser gate.
