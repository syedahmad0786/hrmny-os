# Trade-offs

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; exact model ID not exposed; branch
`ahmadbukhari097/codex/phase-3-role-home-20260830`; commit
`cde54907048f43d5bc7717e24e0d50b66f1768a7`.

## `TRD-HRMNY-20260830-ROLE-001` — reversible role inference

- Decision/finding: role priorities use current canonical role keys and a
  deterministic fallback while exhaustive accepted daily-job maps are absent.
- Reason: this permits a safe first slice without inventing permissions.
- Alternatives considered: block all UI work; invent additional personas;
  create separate applications per role.
- Trade-offs: labels and lane ordering are provisional until named employees
  complete UAT; the policy is pure and cheaply reversible.
- Evidence: `staff-workspace.ts` and its role/precedence tests.
- Confidence/freshness: medium-high.
- Affected components: home copy and navigation ordering only.
- Status: accepted for preview testing, not user accepted.
- Supersedes/superseded-by: none.
- Rollback/correction: update aliases/profiles and rerun every role journey.

## `TRD-HRMNY-20260830-ROLE-002` — duplication retained for safety

- Decision/finding: `/tasks` and `/work/my-tasks`, plus the existing inbox and
  approvals surfaces, remain intact.
- Reason: the current slice has no approved dependency inventory or migration
  path for route consolidation.
- Alternatives considered: redirect/delete duplicates; silently remap feature
  ownership.
- Trade-offs: navigation taxonomy is not yet final and requires a later
  controlled consolidation slice.
- Evidence: route build receipt and `GAP-HRMNY-20260830-ROLE-003`.
- Confidence/freshness: high.
- Affected components: staff routes and feature mappings.
- Status: intentionally deferred.
- Supersedes/superseded-by: none.
- Rollback/correction: consolidate only after route analytics, dependency
  inventory, redirects, rollback, and approval.
