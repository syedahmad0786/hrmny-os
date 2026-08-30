# Evidence

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; tool/model `Codex agent (exact model ID not
exposed)`; branch `ahmadbukhari097/codex/phase-1-sales-effect-containment-20260830`;
commit `10d997c7e28221f186ecec7aa3b101b2a6096dc3`. Evidence is local/synthetic unless
explicitly stated; none of it is provider, destination, recovery, user, or
production acceptance.

## `EVID-HRMNY-20260830-SALES-001` — immutable implementation

- Decision/finding: commit `10d997c7e28221f186ecec7aa3b101b2a6096dc3`
  contains the reviewed source, tests, workflow environment, and corrected
  compatibility documentation.
- Reason: bind claims to exact code.
- Alternatives considered: describe an uncommitted worktree.
- Trade-offs: later corrections require a superseding commit.
- Evidence: Git commit and staged-name review excluding `.system-harness/`.
- Confidence/freshness: high; current.
- Affected components: entire slice.
- Status: verified locally.
- Supersedes/superseded-by: none.
- Rollback/correction: Git revert after approval.

## `EVID-HRMNY-20260830-SALES-002` — deterministic tests

- Decision/finding: `pnpm test` passed all seven tested workspace packages;
  web result was 122 files / 625 tests, with 625 passing.
- Reason: verify containment and repository regression together.
- Alternatives considered: focused tests only.
- Trade-offs: synthetic tests do not prove providers.
- Evidence: local command receipt from 2026-08-30.
- Confidence/freshness: high.
- Affected components: packages and web app.
- Status: passed.
- Supersedes/superseded-by: supersedes the intermediate 624/625 run.
- Rollback/correction: rerun after every code change.

## `EVID-HRMNY-20260830-SALES-003` — lint

- Decision/finding: `pnpm lint` passed all seven linted workspace packages.
- Reason: static source-quality gate.
- Alternatives considered: web-only lint.
- Trade-offs: lint does not prove behavior.
- Evidence: local command receipt.
- Confidence/freshness: high.
- Affected components: repository source.
- Status: passed.
- Supersedes/superseded-by: none.
- Rollback/correction: rerun after modifications.

## `EVID-HRMNY-20260830-SALES-004` — type checking

- Decision/finding: `pnpm typecheck` passed all seven typed workspace packages.
- Reason: verify route unions, readiness response, and service guards compile.
- Alternatives considered: rely on build inference.
- Trade-offs: types do not prove runtime policy.
- Evidence: local command receipt.
- Confidence/freshness: high.
- Affected components: repository TypeScript.
- Status: passed.
- Supersedes/superseded-by: none.
- Rollback/correction: rerun after modifications.

## `EVID-HRMNY-20260830-SALES-005` — production builds

- Decision/finding: both Next applications built successfully; the main app
  generated 86 routes and the desk app generated six static pages.
- Reason: prove production compilation under the reviewed code.
- Alternatives considered: dev server only.
- Trade-offs: a build is not a deployment or runtime acceptance receipt.
- Evidence: `pnpm build` and a second exact-safe web build.
- Confidence/freshness: high.
- Affected components: web and desk artifacts.
- Status: passed.
- Supersedes/superseded-by: none.
- Rollback/correction: rebuild from a corrected commit.

## `EVID-HRMNY-20260830-SALES-006` — independent containment review

- Decision/finding: a bounded read-only reviewer found no remaining P0/P1
  provider/database-effect bypass after final remediation; its focused suite
  passed 10/10 tests.
- Reason: challenge the supervisor's entrypoint inventory independently.
- Alternatives considered: self-review only.
- Trade-offs: review was scoped to containment, not all Sales correctness.
- Evidence: reviewer findings mapped to policy, routes, tools, direct services,
  readiness, and Hunt UI.
- Confidence/freshness: high.
- Affected components: legacy Sales containment surface.
- Status: passed.
- Supersedes/superseded-by: supersedes earlier reviewer findings that were fixed.
- Rollback/correction: repeat review after any guard change.

## `EVID-HRMNY-20260830-SALES-007` — diff hygiene

- Decision/finding: `git diff --check` passed and the bounded credential-pattern
  scan found no secret-shaped addition.
- Reason: prevent whitespace defects and obvious credential leakage.
- Alternatives considered: skip manual scan because gitleaks was unavailable.
- Trade-offs: pattern scan is not a complete secret scanner.
- Evidence: local command receipt; `.system-harness/` remained untracked.
- Confidence/freshness: medium-high.
- Affected components: committed diff.
- Status: passed with stated tool gap.
- Supersedes/superseded-by: none.
- Rollback/correction: run CI secret scanning and rotate any later confirmed
  credential without exposing it.

## `EVID-HRMNY-20260830-SALES-008` — local browser gate is not accepted

- Decision/finding: local Playwright did not complete; Next returned API/tRPC
  headers but no body bytes on Windows, leaving the shell on `Checking access…`.
- Reason: preserve negative evidence rather than convert a build into a browser
  acceptance claim.
- Alternatives considered: omit the failure; weaken the test wait condition.
- Trade-offs: Linux CI browser acceptance remains a PR gate.
- Evidence: two 90-second navigation timeouts and direct HTTP reproduction.
- Confidence/freshness: high for failure symptom.
- Affected components: local browser acceptance.
- Status: failed locally; CI pending.
- Supersedes/superseded-by: none.
- Rollback/correction: if Linux CI fails, block the PR and fix the server path.
