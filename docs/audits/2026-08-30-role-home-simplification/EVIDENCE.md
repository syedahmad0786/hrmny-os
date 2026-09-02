# Evidence

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; tool/model `Codex agent (exact model ID not
exposed)`; branch `ahmadbukhari097/codex/phase-3-role-home-20260830`; commit
`cde54907048f43d5bc7717e24e0d50b66f1768a7`. Evidence is synthetic/local
unless stated otherwise; none is provider, recovery, user, or production
acceptance.

## `EVID-HRMNY-20260830-ROLE-001` — immutable implementation

- Decision/finding: commit `cde54907048f43d5bc7717e24e0d50b66f1768a7`
  contains the bounded role-home implementation and tests.
- Reason: bind claims to reviewed source rather than an uncommitted worktree.
- Alternatives considered: describe local edits only.
- Trade-offs: documentation and hosted receipts require a later evidence
  commit.
- Evidence: exact Git commit and PR #240; `.system-harness/` excluded.
- Confidence/freshness: high.
- Affected components: all implementation files in the slice.
- Status: passed.
- Supersedes/superseded-by: none.
- Rollback/correction: reviewed revert or forward fix subject to the authority
  invariants.

## `EVID-HRMNY-20260830-ROLE-002` — deterministic regression tests

- Decision/finding: full repository tests passed; web completed 125 files and
  663 tests with no failures. The final focused role/dependency suite passed,
  including client override, approval placement, capability, and role policy.
- Reason: challenge scoped-query and presentation-policy behavior directly and
  detect repository regressions.
- Alternatives considered: focused tests only; manual source inspection.
- Trade-offs: synthetic memory/database contracts do not prove production data.
- Evidence: local test receipts from the implementation commit.
- Confidence/freshness: high.
- Affected components: repository packages and web app.
- Status: passed.
- Supersedes/superseded-by: none.
- Rollback/correction: block review on any regression.

## `EVID-HRMNY-20260830-ROLE-003` — static and production compile gates

- Decision/finding: web lint and typecheck passed; both Next applications
  built successfully, with 86 main routes and six desk static pages.
- Reason: verify source quality, types, and deployable compilation after the
  final P1 corrections.
- Alternatives considered: rely on an earlier build or tests alone.
- Trade-offs: a successful build is not deployment or performance acceptance.
- Evidence: local lint, typecheck, and `pnpm build` receipts.
- Confidence/freshness: high.
- Affected components: web source and build graph.
- Status: passed.
- Supersedes/superseded-by: none.
- Rollback/correction: rerun after every implementation change.

## `EVID-HRMNY-20260830-ROLE-004` — independent bounded review

- Decision/finding: the first review found two P1 issues; after correction the
  same reviewer verified per-client nullable dependency visibility, fixed
  approvals placement, and inbox matcher behavior, then returned GO with no
  remaining P0/P1 in scope.
- Reason: challenge data exposure and action hierarchy independently.
- Alternatives considered: self-review only.
- Trade-offs: the bounded review does not prove every route or named-user job.
- Evidence: reviewer report and 46 targeted passing tests.
- Confidence/freshness: high.
- Affected components: My Tasks, role policy, staff shell.
- Status: passed after remediation.
- Supersedes/superseded-by: supersedes the first failing review state.
- Rollback/correction: replay the exact cases after relevant changes.

## `EVID-HRMNY-20260830-ROLE-005` — browser contract state

- Decision/finding: eight Playwright tests enumerate six role landings,
  capability-controlled controls, keyboard **More**, hidden active-route state,
  and a 390-pixel viewport without horizontal overflow. Local runtime timed out
  before DOM assertions; both corrected-head Linux runs later passed them.
- Reason: keep specification coverage separate from browser acceptance.
- Alternatives considered: describe compilation as a pass; omit responsive UI
  proof.
- Trade-offs: hosted synthetic runtime does not prove named-user or production
  behavior.
- Evidence: Playwright list receipt, `FAIL-HRMNY-20260830-ROLE-001`, and
  `EVID-HRMNY-20260830-ROLE-007`.
- Confidence/freshness: high for the tested preview runtime.
- Affected components: role home and staff navigation.
- Status: passed in hosted Linux CI; production/user acceptance remains open.
- Supersedes/superseded-by: finalized by
  `EVID-HRMNY-20260830-ROLE-007`.
- Rollback/correction: preserve the tests and block on hosted failure.

## `EVID-HRMNY-20260830-ROLE-006` — first hosted run and correction

- Decision/finding: push run `33307013914` and pull-request run `33307016697`
  each passed verify and database jobs, then passed 78 of 85 browser journeys.
  Both failed the same six exact role-link accessible-name assertions and one
  inherited ambiguous **More** selector. Keyboard **More**, active hidden route,
  the new 390-pixel role-home journey, and all other inherited journeys passed.
- Reason: preserve negative evidence and distinguish browser-contract defects
  from code compilation, provider acceptance, or production acceptance.
- Alternatives considered: omit the failed runs; accept a partial suite;
  remove progressive disclosure.
- Trade-offs: correction commit `7955288...` required a complete rerun.
- Evidence: jobs `99245233913` and `99245241486`; 78 passed / 7 failed in each;
  local correction lint, typecheck, formatting, and 11-spec compilation passed.
- Confidence/freshness: high.
- Affected components: PR #240 staff navigation and Sales Growth mobile test.
- Status: terminal negative receipt preserved; corrected-head gates passed.
- Supersedes/superseded-by: superseded by
  `EVID-HRMNY-20260830-ROLE-007`.
- Rollback/correction: exact accessible labels and landmark-scoped selector in
  commit `79552880ddaba28723c3ce3572bbd64bc5a07cfc`.

## `EVID-HRMNY-20260830-ROLE-007` — terminal corrected preview gates

- Decision/finding: on code head
  `79552880ddaba28723c3ce3572bbd64bc5a07cfc`, push run `33307347492` and
  pull-request run `33307349042` both passed verify, database, and Linux E2E.
  Each browser job passed all 85 journeys. Both Vercel preview deployments, the
  approval reviewer, and the security reviewer reached successful terminal
  states.
- Reason: close the reviewed code/preview state with immutable hosted receipts
  while keeping all live operational acceptance separate.
- Alternatives considered: rely on one duplicated run; call preview deployment
  production accepted; omit the earlier negative runs.
- Trade-offs: duplicated push/PR execution costs CI time; the result still does
  not prove performance, recovery, named-user UAT, or production.
- Evidence: verify jobs `99246112495` and `99246116550`; database jobs
  `99246112362` and `99246116419`; E2E jobs `99246112460` and `99246116499`;
  Vercel checks `hrmny-os` and `hrmny-os-web`; approval reviewer
  `bc-2b2a6b93-f521-441c-a9b3-14e95681f3d4`; security reviewer
  `bc-19f71a9d-24ab-4bd6-9b2e-200c7f580ae3`.
- Confidence/freshness: high; terminal checks read on 2026-08-30.
- Affected components: PR #240 reviewed preview slice.
- Status: code, database CI, preview deployment, and synthetic hosted browser
  acceptance passed; merge and all live operational acceptance remain
  unapproved.
- Supersedes/superseded-by: supersedes pending states in `-005`, `-006`, and
  `GAP-HRMNY-20260830-ROLE-001`; none.
- Rollback/correction: do not merge or promote automatically; rerun every gate
  after implementation changes and preserve the separate live/UAT gates.
