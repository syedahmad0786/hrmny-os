# Evidence

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; tool/model `Codex agent (exact model ID not
exposed)`; branch `ahmadbukhari097/codex/phase-2-portal-approval-boundary-20260830`;
commit `b2fea0bc9ae94e38595841783e177065a9a378d7`. Evidence is local/synthetic unless
explicitly stated; none of it is provider, destination, recovery, user, or
production acceptance.

## `EVID-HRMNY-20260830-PORTAL-001` — immutable implementation

- Decision/finding: commit `b2fea0bc9ae94e38595841783e177065a9a378d7`
  contains the portal
  authority source, tests, read-only UI, and API inventory update.
- Reason: bind claims to exact reviewed code.
- Alternatives considered: describe an uncommitted worktree.
- Trade-offs: later corrections require a superseding commit.
- Evidence: Git commit and staged-name review excluding `.system-harness/`.
- Confidence/freshness: high; immutable implementation commit recorded.
- Affected components: entire slice.
- Status: passed.
- Supersedes/superseded-by: none.
- Rollback/correction: reviewed Git revert subject to the containment rule.

## `EVID-HRMNY-20260830-PORTAL-002` — focused authority tests

- Decision/finding: eight focused test files passed 72/72 tests after final
  hardening.
- Reason: directly challenge staff, client, cross-client, permission, replay,
  canonical magic-link/revocation, Chat, AI alias, wildcard, audit/projector
  failure, and same-/cross-item concurrency paths.
- Alternatives considered: rely on the full suite without a focused receipt.
- Trade-offs: memory tests do not prove PostgreSQL behavior.
- Evidence: local Vitest receipt from 2026-08-30.
- Confidence/freshness: high.
- Affected components: portal boundary and former bypasses.
- Status: passed.
- Supersedes/superseded-by: supersedes earlier intermediate focused runs.
- Rollback/correction: rerun after every authority change.

## `EVID-HRMNY-20260830-PORTAL-003` — repository regression tests

- Decision/finding: `pnpm test` passed all seven tested workspace tasks; the
  web result was 123 files / 645 tests, all passing.
- Reason: detect regressions beyond the focused boundary.
- Alternatives considered: focused tests only.
- Trade-offs: synthetic tests do not prove a live provider or database.
- Evidence: local command receipt from 2026-08-30.
- Confidence/freshness: high.
- Affected components: repository packages and web app.
- Status: passed after the final implementation change.
- Supersedes/superseded-by: none.
- Rollback/correction: stop release on a regression.

## `EVID-HRMNY-20260830-PORTAL-004` — static and production compile gates

- Decision/finding: full repository lint and typecheck passed across all seven
  applicable tasks after final hardening; both Next applications built
  successfully, with 86 main static/dynamic routes and six desk static pages.
- Reason: verify source quality, route/service types, and production
  compilation.
- Alternatives considered: web-only checks; infer build from tests.
- Trade-offs: static/build success is not deployment acceptance.
- Evidence: local `pnpm lint`, `pnpm typecheck`, and `pnpm build` receipts.
- Confidence/freshness: high.
- Affected components: repository source and build artifacts.
- Status: passed after the final implementation change.
- Supersedes/superseded-by: none.
- Rollback/correction: rerun after implementation changes.

## `EVID-HRMNY-20260830-PORTAL-005` — deterministic network containment

- Decision/finding: tests use the repository's hostile-fetch setup and the
  portal slice made no provider or live database call.
- Reason: portal authority tests must not accidentally exercise external
  effects.
- Alternatives considered: rely on absent credentials.
- Trade-offs: real provider and destination behavior is not accepted here.
- Evidence: test setup contract, synthetic fixtures, and command output.
- Confidence/freshness: high.
- Affected components: test environment and portal pathways.
- Status: passed locally.
- Supersedes/superseded-by: none.
- Rollback/correction: use a separately approved bounded canary; never weaken
  ordinary tests.

## `EVID-HRMNY-20260830-PORTAL-006` — independent security review

- Decision/finding: three bounded adversarial passes first reproduced a
  prompt/wildcard client-write bypass, then campaign replay/audit/concurrency
  failures, then a cross-item rollback race. After remediation, the reviewer
  replayed the exact attacks and reported no evidence-backed P0/P1 remaining.
- Reason: challenge the supervisor's authority and bypass inventory.
- Alternatives considered: self-review only.
- Trade-offs: scoped review does not prove full portal completeness.
- Evidence: bounded read-only reviewer receipt.
- Confidence/freshness: high for the reviewed containment pathways.
- Affected components: approval service, routes, UI, AI/Chat, tests.
- Status: passed after remediation; broader portal completeness is not claimed.
- Supersedes/superseded-by: none.
- Rollback/correction: rerun the exact adversarial suite after any authority,
  agent, Chat, campaign, audit, or outbox change.

## `EVID-HRMNY-20260830-PORTAL-007` — diff and credential hygiene

- Decision/finding: `git diff --check` passed; no migration or Supabase file is
  changed; a bounded added-line credential-pattern scan found no secret value.
- Reason: prevent whitespace defects, accidental schema expansion, and obvious
  credential leakage.
- Alternatives considered: omit the scan because a dedicated scanner is not
  installed.
- Trade-offs: bounded pattern matching is not a complete secret scanner.
- Evidence: local Git/path and bounded-pattern receipts; `.system-harness/`
  remains untracked and excluded.
- Confidence/freshness: medium-high.
- Affected components: committed diff.
- Status: passed for implementation commit
  `b2fea0bc9ae94e38595841783e177065a9a378d7`.
- Supersedes/superseded-by: none.
- Rollback/correction: block the PR and rotate any later confirmed credential
  without displaying it.

## `EVID-HRMNY-20260830-PORTAL-008` — browser acceptance state

- Decision/finding: a Playwright specification proves the staff preview is
  visibly read-only and lacks Approve/Request Changes controls; it passed in
  both final-head Linux E2E jobs as part of the 77/77 suites.
- Reason: obtain runtime proof despite the separately preserved local Windows
  body stall.
- Alternatives considered: omit UI proof; claim from source inspection.
- Trade-offs: hosted synthetic browser proof does not establish a live
  Supabase/cookie session or named-client UAT.
- Evidence: `client-preview-readonly-ui.spec.ts`; jobs `99239188471` and
  `99239192175`.
- Confidence/freshness: high for the tested preview runtime.
- Affected components: staff preview UI.
- Status: passed in hosted Linux CI; production/user acceptance remains open.
- Supersedes/superseded-by: finalized by
  `EVID-HRMNY-20260830-PORTAL-012`.
- Rollback/correction: block the PR and fix if the hosted browser gate fails.

## `EVID-HRMNY-20260830-PORTAL-009` — atomic campaign receipt proof

- Decision/finding: deterministic tests prove exact approval/rejection replay,
  changed-feedback conflict, injected audit rollback, projector failure plus
  replay recovery, one-winner same-item concurrency, and isolation when a
  delayed failure overlaps a different item's successful decision.
- Reason: a terminal campaign decision must never be separated from its client
  attribution, audit, or durable projection intent.
- Alternatives considered: sequential happy-path tests only.
- Trade-offs: memory-mode adversarial proof and compiled SQL do not replace a
  disposable PostgreSQL concurrency test.
- Evidence: campaign/feedback focused tests and the independent reviewer replay;
  the successful cross-item decision retained one portal audit and one applied
  outbox while the failed item retained none.
- Confidence/freshness: high for memory mode; medium-high overall until
  `GAP-HRMNY-20260830-PORTAL-002` closes.
- Affected components: campaign repository, audit, seam outbox, projector.
- Status: passed locally and independently reviewed.
- Supersedes/superseded-by: supersedes intermediate failing designs recorded in
  `FAIL-HRMNY-20260830-PORTAL-005`; none.
- Rollback/correction: block the slice if any adversarial case regresses.

## `EVID-HRMNY-20260830-PORTAL-010` — first hosted run and browser-contract correction

- Decision/finding: both initial stacked-PR verify and database-migration jobs
  passed, both Vercel preview checks passed, and the browser job passed 73 of 77
  journeys. Its four failures all asserted the generic client effects removed
  by this containment slice; no failing assertion requested the new staff
  preview behavior, and `client-preview-readonly-ui.spec.ts` passed.
- Reason: preserve negative evidence and distinguish an inherited test-contract
  mismatch from product, provider, deployment, or user acceptance.
- Alternatives considered: omit the failed run; classify the preview as
  accepted; restore the effect paths.
- Trade-offs: the slice remains unaccepted until the corrected head completes
  hosted Linux browser and security review.
- Evidence: Actions runs `33303233430` and `33303244947`; E2E jobs
  `99235091588` and `99235124529`; correction commit
  `3d4213a293e6f088018086c08f9f6d2d6c1ff264`; local unit 645/645, lint,
  typecheck, and production build gates passed after correction.
- Confidence/freshness: high for the captured runs and local correction.
- Affected components: stacked PR #239, browser contracts, Chat, AI settings.
- Status: negative receipt preserved; correction later passed.
- Supersedes/superseded-by: superseded by
  `EVID-HRMNY-20260830-PORTAL-012`.
- Rollback/correction: block merge and deployment until every required hosted
  check reaches a successful terminal result.

## `EVID-HRMNY-20260830-PORTAL-011` — second hosted run and read-only assertion correction

- Decision/finding: corrected-head Actions runs `33304452266` and
  `33304454078` each passed verify and fresh/upgrade database migration jobs.
  Each E2E job passed 76 of 77 journeys; Chat read-only, OS-settle read-only,
  staff preview denial, portal isolation, campaign approvals, and the remaining
  route/security journeys passed. The only failure was the over-broad
  zero-tool assertion in `ai-agent-tool-results.spec.ts`.
- Reason: retain exact hosted evidence while distinguishing safe scoped reads
  from forbidden client writes.
- Alternatives considered: describe the near-pass as green; omit the repeated
  failure; change runtime behavior to satisfy the test.
- Trade-offs: another complete hosted rerun is required even though no runtime
  source changed in the final assertion correction.
- Evidence: verify jobs `99238381099` and `99238385985`; database jobs
  `99238381199` and `99238386075`; E2E jobs `99238381198` and `99238386186`;
  commit `3376752a5b1cc8f423940894163a5c2016bfa4e0`; local 22/22 policy tests and
  Playwright specification compilation passed.
- Confidence/freshness: high.
- Affected components: PR #239 browser acceptance and one contract assertion.
- Status: negative receipt preserved; final hosted rerun passed.
- Supersedes/superseded-by: supersedes the four-failure diagnosis as the latest
  intermediate hosted state; superseded by `EVID-HRMNY-20260830-PORTAL-012`.
- Rollback/correction: block merge/deployment until the complete corrected head
  is green.

## `EVID-HRMNY-20260830-PORTAL-012` — terminal hosted preview gates

- Decision/finding: on head `a11549ffabea2bd0064ec3aa0ffc5f8d61348cae`,
  push run `33304750432` and pull-request run `33304751661` both passed verify,
  fresh/upgrade database migration, and Linux E2E. Each browser job passed all
  77 journeys in 1.4 minutes. Both Vercel preview artifacts, the approval
  reviewer, and the security reviewer reached successful terminal states.
- Reason: close the code/preview test state with immutable provider receipts
  while keeping operational acceptance states separate.
- Alternatives considered: rely on one duplicate run; call preview deployment
  production accepted; omit the earlier negative receipts.
- Trade-offs: duplicate push/PR execution costs CI time; the result still does
  not prove live Supabase sessions, recovery, named-user UAT, or production.
- Evidence: verify jobs `99239188445` and `99239192016`; database jobs
  `99239188347` and `99239192174`; E2E jobs `99239188471` and `99239192175`;
  Vercel checks `hrmny-os` and `hrmny-os-web`; approval reviewer
  `bc-781c9104-8fa5-4bcb-9c6e-586acc1da0db`; security reviewer
  `bc-ac7e87b2-635e-4e6a-a34f-875d3a327bc8`.
- Confidence/freshness: high; terminal checks read on 2026-08-30.
- Affected components: PR #239 reviewed preview slice.
- Status: code, database-migration CI, preview deployment, and synthetic hosted
  browser acceptance passed; merge and all live operational acceptance remain
  unapproved.
- Supersedes/superseded-by: supersedes the pending states in `-008`, `-010`,
  and `-011`; none.
- Rollback/correction: do not merge or promote automatically; rerun all gates
  after any implementation change and preserve separate live canary/UAT gates.
