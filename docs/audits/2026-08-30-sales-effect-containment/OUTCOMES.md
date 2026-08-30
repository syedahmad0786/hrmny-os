# Outcomes

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; tool/model `Codex agent (exact model ID not
exposed)`; branch `ahmadbukhari097/codex/phase-1-sales-effect-containment-20260830`;
commit `10d997c7e28221f186ecec7aa3b101b2a6096dc3`.

## `OUTCOME-HRMNY-20260830-SALES-001` — provider-safe Sales compatibility boundary

- Decision/finding: every discovered legacy Sales bulk/demo entrypoint refuses
  outside the exact inert synthetic runtime, including direct service imports.
- Reason: removes the immediate unapproved provider/spend/CRM mutation paths.
- Alternatives considered: deletion; key-absence convention; UI-only hiding.
- Trade-offs: legacy fixtures remain for deterministic compatibility tests.
- Evidence: `EVID-HRMNY-20260830-SALES-001/002/006`.
- Confidence/freshness: high; implementation commit and review current.
- Affected components: Sales cron, CRM, adapters, agent tools, UI, CI.
- Status: code complete and locally tested; PR/CI/deployment pending.
- Supersedes/superseded-by: partially closes Phase 0 Sales containment gap; none.
- Rollback/correction: revert commit after approval or supersede with an equally
  strict effect broker.

## `OUTCOME-HRMNY-20260830-SALES-002` — truthful operational documentation

- Decision/finding: automation and demo documentation now identify the legacy
  funnel as synthetic-only and the dated production note as historical.
- Reason: prior wording overstated current operational acceptance.
- Alternatives considered: delete historical receipts; leave claims unchanged.
- Trade-offs: documentation now explicitly lists more open gaps.
- Evidence: `docs/AUTOMATIONS.md`, `docs/DEMO-FUNNEL.md`, and
  `docs/OPERATIONAL-PHASE.md`.
- Confidence/freshness: high.
- Affected components: operator runbooks and release claims.
- Status: complete in implementation commit.
- Supersedes/superseded-by: supersedes the current-use interpretation of the
  dated demo proof; none.
- Rollback/correction: preserve dated history and add a superseding receipt.
