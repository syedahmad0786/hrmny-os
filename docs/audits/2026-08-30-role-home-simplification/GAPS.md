# Gaps

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; exact model ID not exposed; branch
`ahmadbukhari097/codex/phase-3-role-home-20260830`; commit
`cde54907048f43d5bc7717e24e0d50b66f1768a7`.

## `GAP-HRMNY-20260830-ROLE-001` — hosted role journeys

- Decision/finding: local Playwright specifications compile, but the Windows
  browser body stalled before DOM assertions. The first hosted Linux run found
  seven corrected accessibility/selector contract failures; both complete
  corrected-head runs then passed all 85 journeys.
- Reason: preview runtime proof must be recorded separately from source/tests.
- Alternatives considered: claim from compilation; weaken or omit UI proof.
- Trade-offs: hosted proof closes the preview browser gate but does not repair
  the local Windows loopback or establish production/user acceptance.
- Evidence: `FAIL-HRMNY-20260830-ROLE-001`, `-003` and
  `EVID-HRMNY-20260830-ROLE-007`.
- Confidence/freshness: high as of correction commit `7955288...`.
- Affected components: role home and responsive staff navigation.
- Status: closed for reviewed preview execution; local environment failure is
  retained separately.
- Supersedes/superseded-by: superseded by `EVID-HRMNY-20260830-ROLE-007`.
- Rollback/correction: block merge/promotion and fix any hosted failure.

## `GAP-HRMNY-20260830-ROLE-002` — named-user role contract and UAT

- Decision/finding: synthetic roles cover partner, director, account manager,
  finance, HR, traffic, creative director, developer, and fallback staff, but
  real employee job maps and UAT are absent.
- Reason: named-user acceptance requires separately approved employee access.
- Alternatives considered: treat personas as accepted users; ask broad
  planning questions before a reversible slice.
- Trade-offs: lane ordering and copy remain provisional.
- Evidence: role test matrix and no named-user receipt.
- Confidence/freshness: high.
- Affected components: role aliases, home copy, lane ordering.
- Status: open; human checkpoint only at named-user UAT.
- Supersedes/superseded-by: none.
- Rollback/correction: collect bounded UAT and revise pure role profiles.

## `GAP-HRMNY-20260830-ROLE-003` — navigation taxonomy remains duplicated

- Decision/finding: `/tasks` versus `/work/my-tasks`, two inbox concepts,
  `/approvals` under `support.tickets`, and some advanced routes lack a final
  consolidated ownership contract.
- Reason: deletion/remapping requires exact usage and dependency evidence.
- Alternatives considered: delete or redirect during this slice.
- Trade-offs: **More** contains some legacy complexity.
- Evidence: 86-route build inventory and feature catalog inspection.
- Confidence/freshness: high.
- Affected components: routes, feature catalog, navigation, bookmarks.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: prepare inventory, redirects, data migration, rollback,
  and approval before consolidation.

## `GAP-HRMNY-20260830-ROLE-004` — performance, recovery, and production

- Decision/finding: this slice has no p95 load measurement, recovery drill,
  production promotion, or production acceptance receipt.
- Reason: local/build/preview proof does not establish operational targets.
- Alternatives considered: infer performance from compilation or unit tests.
- Trade-offs: the slice cannot be called production accepted.
- Evidence: acceptance table and absence of performance/recovery receipts.
- Confidence/freshness: high.
- Affected components: deployment and operating runbooks.
- Status: open.
- Supersedes/superseded-by: none.
- Rollback/correction: close only with bounded load, recovery, then separately
  approved production and user acceptance.
