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
  visibly read-only and lacks Approve/Request Changes controls, but its Linux
  execution receipt is pending the stacked PR.
- Reason: the inherited local Windows body stall cannot be converted into a
  browser pass.
- Alternatives considered: omit UI proof; claim from source inspection.
- Trade-offs: browser acceptance remains pending until hosted CI is green.
- Evidence: `client-preview-readonly-ui.spec.ts`; hosted result pending.
- Confidence/freshness: high for source, pending for runtime.
- Affected components: staff preview UI.
- Status: pending Linux CI.
- Supersedes/superseded-by: none.
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
