# Trade-offs

Common scope/date/actor for every record: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; supervisor
`Codex /root`; tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-2-portal-approval-boundary-20260830`; implementation
commit `b2fea0bc9ae94e38595841783e177065a9a378d7`.

## `TRADEOFF-HRMNY-20260830-PORTAL-001` — fail closed without one canonical user

- Decision/finding: issue and resolve portal grants only when email plus client
  maps to exactly one active canonical portal user, and re-resolve on each
  request.
- Reason: inventing or caching a trusted identity would weaken attribution and
  revocation.
- Alternatives considered: map the grant to a guessed user; block the complete
  portal; add an unreviewed schema migration.
- Trade-offs: missing or duplicate canonical identities receive the same
  non-enumerating response and cannot start a usable session; hosted provider
  behavior is not yet accepted.
- Evidence: `GAP-HRMNY-20260830-PORTAL-001` and magic/session isolation tests.
- Confidence/freshness: high.
- Affected components: magic-link session and approvals.
- Status: implemented locally; hosted acceptance pending.
- Supersedes/superseded-by: supersedes the earlier pseudo-session limitation;
  none.
- Rollback/correction: preserve canonical re-resolution and correct provider
  session plumbing forward.

## `TRADEOFF-HRMNY-20260830-PORTAL-002` — retain inert compatibility surfaces

- Decision/finding: keep old route/executor names as typed refusals while
  removing visible controls and effective tool access.
- Reason: no deletion is permitted without a full dependency inventory and
  approved migration/rollback plan.
- Alternatives considered: delete immediately; retain hidden live behavior.
- Trade-offs: dead compatibility code remains discoverable and must be clearly
  documented as denied.
- Evidence: API inventory and direct refusal tests.
- Confidence/freshness: high.
- Affected components: staff tRPC route and portal AI compatibility executor.
- Status: accepted.
- Supersedes/superseded-by: none.
- Rollback/correction: remove only through a separately reviewed cleanup slice.

## `TRADEOFF-HRMNY-20260830-PORTAL-003` — transaction proof remains synthetic

- Decision/finding: implement action-time canonical identity locking in code
  without executing a production migration or live database transaction.
- Reason: this phase is provider/database read-only and no disposable database
  acceptance environment has yet been established.
- Alternatives considered: run against production; omit the database guard.
- Trade-offs: SQL behavior still needs a disposable PostgreSQL integration
  receipt before deployment acceptance.
- Evidence: source review, type/build gates, `GAP-HRMNY-20260830-PORTAL-002`.
- Confidence/freshness: medium-high until database integration proof.
- Affected components: database approval transaction.
- Status: accepted local limitation.
- Supersedes/superseded-by: none.
- Rollback/correction: block deployment if disposable-database verification
  fails and correct forward.

## `TRADEOFF-HRMNY-20260830-PORTAL-004` — client Chat is deliberately read-only

- Decision/finding: remove automatic custom-agent execution and the generic
  action tool from Chat; expose reads only for client-bound conversations.
- Reason: a model-selected wildcard capability is too broad for client-scoped
  writes and previously enabled an approval-adjacent paraphrase bypass.
- Alternatives considered: grow the intent regex; preserve wildcard execution;
  disable Chat entirely.
- Trade-offs: users can research and inspect from Chat, while draft/effect work
  must use a typed server-owned command until a scoped broker exists.
- Evidence: AI and Chat adversarial tests plus independent review.
- Confidence/freshness: high.
- Affected components: Chat runtime, custom agents, client tool execution.
- Status: accepted containment trade-off.
- Supersedes/superseded-by: none; expected to be narrowed by reviewed typed
  effect commands.
- Rollback/correction: add one exact capability at a time with policy,
  idempotency, receipt, and denial tests.

## `TRADEOFF-HRMNY-20260830-PORTAL-005` — replay is the current recovery trigger

- Decision/finding: persist a pending campaign projection intent and let an
  exact same-decision replay re-drive it when post-commit projection fails.
- Reason: preserve the decision and immutable receipt without adding an
  unreviewed scheduler/schema migration in this slice.
- Alternatives considered: roll back the client decision after commit;
  best-effort notification without a durable intent; add a new queue now.
- Trade-offs: the existing outbox lacks attempt counters, timed backoff, and a
  dead-letter lifecycle, so unattended recovery is incomplete.
- Evidence: projector failure/replay test and
  `GAP-HRMNY-20260830-PORTAL-007`.
- Confidence/freshness: high for replay recovery, high for the stated gap.
- Affected components: campaign decision projector and operations.
- Status: accepted temporary limitation.
- Supersedes/superseded-by: none.
- Rollback/correction: add scheduled retry/dead-letter/reconciliation as a
  separate connection-hardening slice.
