# Trade-offs

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; tool/model `Codex agent (exact model ID not
exposed)`; branch `ahmadbukhari097/codex/phase-1-sales-effect-containment-20260830`;
commit `10d997c7e28221f186ecec7aa3b101b2a6096dc3`.

## `TRADEOFF-HRMNY-20260830-SALES-001` — route stability versus deletion

- Decision/finding: retain stable legacy endpoints but return typed refusals.
- Reason: exact dependencies, migration, rollback, and deletion approval are
  not yet complete.
- Alternatives considered: delete routes now; allow silent no-ops.
- Trade-offs: compatibility code remains visible in the repository.
- Evidence: route tests and `docs/DEMO-FUNNEL.md`.
- Confidence/freshness: high.
- Affected components: callers, synthetic E2E, Hunt UI.
- Status: accepted temporary trade-off.
- Supersedes/superseded-by: none; removal requires a later inventory ADR.
- Rollback/correction: keep refusal semantics or restore only synthetic fixtures.

## `TRADEOFF-HRMNY-20260830-SALES-002` — local receipt versus external alert

- Decision/finding: record denied schedules durably without sending Chat.
- Reason: external alert delivery is itself an effect and lacked an outbox
  receipt in this path.
- Alternatives considered: emit the webhook immediately; omit observability.
- Trade-offs: no immediate Chat notification.
- Evidence: hostile-webhook test and independent review.
- Confidence/freshness: high.
- Affected components: operations monitoring and Google Chat alerts.
- Status: accepted until the alert bridge is hardened.
- Supersedes/superseded-by: none; expected to be superseded by an outbox bridge.
- Rollback/correction: add a queued notification projection; retain local source
  receipt as authority.

## `TRADEOFF-HRMNY-20260830-SALES-003` — compatibility proof versus broad demo

- Decision/finding: replace the disposable-Postgres monolithic mutation test
  with a containment proof.
- Reason: the old test encoded unapproved bulk/provider/finance behavior.
- Alternatives considered: keep the broad proof; delete all live-target checks.
- Trade-offs: portal, onboarding, delivery, and finance need replacement
  acceptance tests in their own bounded slices.
- Evidence: `demo-os-live-proof.test.ts` and gap
  `GAP-HRMNY-20260830-SALES-009`.
- Confidence/freshness: high.
- Affected components: manual acceptance workflow and downstream domains.
- Status: accepted; replacement coverage pending.
- Supersedes/superseded-by: supersedes the old broad live-proof claim; none.
- Rollback/correction: add domain-specific disposable-target tests, never restore
  a monolithic unapproved effect chain.
