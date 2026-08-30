# Runbooks

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; tool/model `Codex agent (exact model ID not
exposed)`; branch `ahmadbukhari097/codex/phase-1-sales-effect-containment-20260830`;
commit `10d997c7e28221f186ecec7aa3b101b2a6096dc3`.

## `RUNBOOK-HRMNY-20260830-SALES-001` — verify containment

- Decision/finding: run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and
  `pnpm build`; require the independent containment review before release.
- Reason: combine behavior, static, compile, and adversarial gates.
- Alternatives considered: one focused test only.
- Trade-offs: more execution time.
- Evidence: `EVID-HRMNY-20260830-SALES-002` through `-006`.
- Confidence/freshness: high.
- Affected components: entire slice.
- Status: executed locally; Linux CI browser job pending.
- Supersedes/superseded-by: none.
- Rollback/correction: stop release on any failure and record the exact receipt.

## `RUNBOOK-HRMNY-20260830-SALES-002` — respond to a refused schedule

- Decision/finding: treat `policy_denied` and
  `proposal_runtime_unavailable` as intentional no-effect outcomes.
- Reason: neither state authorizes retrying through a legacy pipeline.
- Alternatives considered: force a manual run; add provider keys.
- Trade-offs: operator must inspect the policy/proposal-runtime gap.
- Evidence: daily-cron tests and local health receipt.
- Confidence/freshness: high.
- Affected components: scheduler operations.
- Status: active.
- Supersedes/superseded-by: none.
- Rollback/correction: correct policy state or deploy an approved proposal
  runtime; do not bypass the guard.

## `RUNBOOK-HRMNY-20260830-SALES-003` — rollback

- Decision/finding: the recoverable code rollback is a reviewed revert of
  `10d997c7e28221f186ecec7aa3b101b2a6096dc3`; no data rollback is expected
  because this slice has no migration and made no live mutation.
- Reason: retain an exact correction path.
- Alternatives considered: edit production directly; delete legacy data.
- Trade-offs: reverting restores unsafe legacy reachability and therefore must
  not be merged/deployed without a replacement containment control.
- Evidence: Git history and no-migration diff.
- Confidence/freshness: high.
- Affected components: source release only.
- Status: documented; not executed.
- Supersedes/superseded-by: none.
- Rollback/correction: prefer a forward fix; require explicit approval before
  merge, deployment, or destructive action.

## `RUNBOOK-HRMNY-20260830-SALES-004` — advance acceptance states

- Decision/finding: after a green stacked PR, proceed separately through
  deployment, bounded provider canary, readback/reconciliation, recovery proof,
  named-user UAT, and production acceptance.
- Reason: code and CI do not imply external operational acceptance.
- Alternatives considered: collapse all states into “done.”
- Trade-offs: more explicit checkpoints.
- Evidence: governing mission and Phase 0 release discipline.
- Confidence/freshness: high.
- Affected components: release and provider operations.
- Status: pending; no live authority granted by this runbook.
- Supersedes/superseded-by: none.
- Rollback/correction: stop at the first failed state and preserve receipts.
