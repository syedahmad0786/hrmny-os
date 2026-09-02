# Gaps

Common scope/date/actor for every record: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; supervisor
`Codex /root`; tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-2-portal-approval-boundary-20260830`; implementation
commit `b2fea0bc9ae94e38595841783e177065a9a378d7`.

## `GAP-HRMNY-20260830-PORTAL-001` — hosted canonical session acceptance

- Decision/finding: canonical email/client resolution, local grant revalidation,
  and deactivation are implemented and synthetically proven; the hosted
  Supabase callback/cookie lifecycle is not provider or browser accepted.
- Reason: local memory tests do not prove hosted cookie attributes, callback
  routing, provider revocation, logout, or offboarding propagation.
- Alternatives considered: infer hosted acceptance from local tests; weaken the
  action-time check.
- Trade-offs: deployment acceptance remains blocked even though the former
  pseudo-identity code path has been removed.
- Evidence: magic-link and session-isolation tests, plus the explicit no-live
  declaration.
- Confidence/freshness: high for the gap and local implementation.
- Affected components: login verification, cookies/session, logout,
  revocation/offboarding, portal approvals.
- Status: open integration/acceptance gap; local code portion complete.
- Supersedes/superseded-by: narrows the portal identity portion of
  `GAP-HRMNY-20260829-PORTAL-001`; none.
- Rollback/correction: prove the canonical binding, secure cookie, revocation,
  cross-client denial, replay, logout, and offboarding in an isolated hosted
  environment before deployment promotion.

## `GAP-HRMNY-20260830-PORTAL-002` — disposable PostgreSQL action-time proof

- Decision/finding: the canonical row recheck and transaction lock compile but
  have not run against a disposable PostgreSQL instance.
- Reason: no production database or migration authority was used.
- Alternatives considered: treat unit tests as database acceptance; test live.
- Trade-offs: deployment acceptance remains blocked.
- Evidence: local test/type/build receipts and no-database declaration.
- Confidence/freshness: high for the gap.
- Affected components: database approval transaction and audit write.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: add an isolated integration test and failure injection
  before deployment promotion.

## `GAP-HRMNY-20260830-PORTAL-003` — exact publication projection

- Decision/finding: approval is still not bound to a reviewed immutable
  delivery version through a complete publication projection.
- Reason: this slice contains authority, not the full creative delivery model.
- Alternatives considered: expand into a schema redesign now.
- Trade-offs: portal completion remains pending.
- Evidence: repository audit and phase boundary.
- Confidence/freshness: high.
- Affected components: assets, versions, approval item, delivery/reporting.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: implement as a separate reviewed vertical slice.

## `GAP-HRMNY-20260830-PORTAL-004` — Work client invariant

- Decision/finding: the complete downstream Work transition still needs an
  independently proven same-client invariant.
- Reason: approval authorization alone does not prove every related task/asset
  belongs to the same client.
- Alternatives considered: assume foreign-key lineage; broaden this slice.
- Trade-offs: broader end-to-end acceptance remains blocked.
- Evidence: audit finding and scoped local tests.
- Confidence/freshness: medium-high.
- Affected components: portal approval, Work task, asset, downstream event.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: add database constraints/transaction checks only through
  a migration-approved slice.

## `GAP-HRMNY-20260830-PORTAL-005` — remaining portal product journeys

- Decision/finding: onboarding, complete delivery evidence, comments/actions,
  reports, view auditing, and all forbidden-payload checks remain incomplete.
- Reason: the current phase intentionally contains one P0 authority boundary.
- Alternatives considered: label the portal complete from one safe route.
- Trade-offs: additional small vertical slices are required.
- Evidence: phase audit and governing portal requirements.
- Confidence/freshness: high.
- Affected components: external client portal.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: implement and accept each journey separately.

## `GAP-HRMNY-20260830-PORTAL-006` — performance, recovery, and UAT

- Decision/finding: synthetic Linux browser acceptance passed 77/77 on both
  final-head runs; mobile accessibility/performance targets, live deployment,
  recovery, named-user, and client acceptance are not yet proven.
- Reason: hosted preview browser proof closes the code-path gate but is not
  operational acceptance.
- Alternatives considered: infer acceptance from compilation.
- Trade-offs: release remains staged.
- Evidence: acceptance-state table, `EVID-HRMNY-20260830-PORTAL-008`, and
  `EVID-HRMNY-20260830-PORTAL-012`.
- Confidence/freshness: high.
- Affected components: release and external client experience.
- Status: narrowed; synthetic Linux browser gate is closed, while performance,
  recovery, live-provider, named-user, and production states remain open.
- Supersedes/superseded-by: none.
- Rollback/correction: stop at the first failed acceptance state and preserve
  the receipt.

## `GAP-HRMNY-20260830-PORTAL-007` — unattended campaign projection recovery

- Decision/finding: campaign decision projection has a durable pending intent
  and exact-replay recovery, but no attempts, timed backoff, dead-letter state,
  scheduled worker receipt, or reconciliation dashboard.
- Reason: this containment slice reused the existing seam outbox without a
  migration or runtime provisioning.
- Alternatives considered: claim replay as complete operations; add an
  unreviewed queue schema and scheduler.
- Trade-offs: a committed decision can require an exact replay to complete
  feedback/notification projection.
- Evidence: projector failure/replay test and repository audit.
- Confidence/freshness: high.
- Affected components: seam outbox, campaign projector, operations and alerts.
- Status: open connection-hardening gap.
- Supersedes/superseded-by: none.
- Rollback/correction: add bounded retry, backoff, dead-letter, reconciliation,
  observability, and failure-injection receipts before operational acceptance.

## `GAP-HRMNY-20260830-PORTAL-008` — typed client Chat effect broker

- Decision/finding: client-bound Chat and generic client agents are read-only;
  reviewed typed wrappers exist for deliberate internal draft workflows but no
  conversational approval/effect broker is exposed.
- Reason: the former generic/wildcard execution surface could not enforce
  precise client effect authority.
- Alternatives considered: retain model-selected `agent_act`; authorize by
  prompt regex.
- Trade-offs: Chat cannot yet perform client-scoped writes, even low-risk drafts.
- Evidence: structural tool filtering and adversarial Chat tests.
- Confidence/freshness: high.
- Affected components: Chat, custom agents, effect gateway.
- Status: open product capability, not a containment failure.
- Supersedes/superseded-by: none.
- Rollback/correction: introduce only exact server-owned commands using
  preview, policy approval, idempotency, readback, and immutable receipts.
