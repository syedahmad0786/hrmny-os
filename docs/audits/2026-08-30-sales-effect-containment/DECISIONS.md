# Decisions

Common scope/date/actor for every record: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; supervisor
`Codex /root`; tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-1-sales-effect-containment-20260830`; implementation
commit `10d997c7e28221f186ecec7aa3b101b2a6096dc3`.

## `ADR-HRMNY-20260830-SALES-001` — legacy Sales effects are synthetic-only

- Decision/finding: permit legacy bulk/demo Sales effects only when the exact
  memory+sandbox+mock-provider predicate is true; guard routes, agent tools, and
  the underlying services.
- Reason: entrypoint-only checks can be bypassed by a direct service import.
- Alternatives considered: remove the legacy code now; rely on missing keys;
  guard only the UI.
- Trade-offs: synthetic fixtures require an explicit environment and remain
  maintenance debt.
- Evidence: `EVID-HRMNY-20260830-SALES-001`, `-002`, and `-006`.
- Confidence/freshness: high; verified against the implementation commit.
- Affected components: CRM demo loop, bulk Apollo import, legacy verification,
  daily lead generation, agent tools, Hunt UI, CI.
- Status: implemented and locally tested; merge/deployment pending.
- Supersedes/superseded-by: partially implements and supersedes the pending
  containment portion of `ADR-HRMNY-20260829-009`; none.
- Rollback/correction: revert the implementation commit only after review; do
  not reactivate any legacy effect without a new ADR and effect receipts.

## `ADR-HRMNY-20260830-SALES-002` — scheduled research remains proposal-inert

- Decision/finding: the daily schedule may read the canonical autonomy policy
  and persist one local refusal receipt, but it cannot resolve providers or run
  legacy research while the proposal-only runtime is absent.
- Reason: the previous scheduler could reach Apollo, email verification, AI,
  and CRM writes before proving authorized autonomy.
- Alternatives considered: keep mock-first execution; activate Inngest now;
  disable the schedule without a receipt.
- Trade-offs: no automated research proposals are produced yet.
- Evidence: `EVID-HRMNY-20260830-SALES-002` and `-006`.
- Confidence/freshness: high; current code and tests.
- Affected components: cron, Inngest, autonomy policy, health receipts.
- Status: implemented containment; proposal runtime is an open gap.
- Supersedes/superseded-by: refines `ADR-HRMNY-20260829-010`; none.
- Rollback/correction: retain the schedule disabled; introduce a new reviewed
  proposal runtime with atomic ownership before any activation.

## `ADR-HRMNY-20260830-SALES-003` — refusal receipts are local-only

- Decision/finding: scheduler refusals use a database/memory health record that
  cannot invoke Google Chat or another external notification adapter.
- Reason: a denied external-effect path must not create a different external
  effect while recording its denial.
- Alternatives considered: reuse the existing alerting helper; suppress all
  receipts.
- Trade-offs: operators will not receive Chat alerts for these refusals until a
  separately reviewed outbox bridge exists.
- Evidence: `EVID-HRMNY-20260830-SALES-002`; failure record
  `FAIL-HRMNY-20260830-SALES-003`.
- Confidence/freshness: high; hostile webhook test proves zero fetch calls.
- Affected components: lead-gen cron, health signal persistence, Chat alerts.
- Status: implemented and tested.
- Supersedes/superseded-by: supersedes reuse of `emitHealthSignal` in this
  refusal path; none.
- Rollback/correction: keep the local receipt; add notifications only through a
  durable, scoped, separately tested bridge.

## `ADR-HRMNY-20260830-SALES-004` — tests declare the complete inert runtime

- Decision/finding: ordinary tests and CI browser jobs explicitly use memory
  storage, mock providers, blank connection keys, disabled paid flags, and
  `XERO_WRITE_ENABLED=false`.
- Reason: secret absence or an implicit adapter fallback is not a deterministic
  safety boundary.
- Alternatives considered: rely on developer machines; mock `fetch` only;
  retain `DATABASE_MODE=auto`.
- Trade-offs: tests that intentionally exercise production authentication or a
  disposable database must override the setting locally and explicitly.
- Evidence: `EVID-HRMNY-20260830-SALES-002` through `-005`.
- Confidence/freshness: high; full suite and build verified.
- Affected components: Vitest setup, CI E2E, live-proof workflow.
- Status: implemented and locally tested.
- Supersedes/superseded-by: extends `ADR-HRMNY-20260829-011`; none.
- Rollback/correction: preserve network denial; use a separate bounded live
  workflow rather than weakening ordinary tests.
