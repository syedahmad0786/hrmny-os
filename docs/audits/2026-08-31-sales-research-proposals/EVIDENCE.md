# Evidence

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
`41145c85e799f6b906dfca23a37aea0894cc9582`. Evidence is synthetic/local unless
stated otherwise; none is provider, recovery, user, or production acceptance.

## `EVID-HRMNY-20260831-RESEARCH-001` — immutable core implementation

- Decision/finding: commit `41145c85e799f6b906dfca23a37aea0894cc9582`
  contains only the Sales research/Gate 1 core and deterministic tests; pending
  UI, CI proof, and `.system-harness/` files are excluded.
- Reason: bind the core contract to a reviewable Git object.
- Alternatives considered: one combined complete-HRMNY change; an uncommitted
  worktree description.
- Trade-offs: dependent UI/database proof reviews are required.
- Evidence: Git commit and staged secret/diff checks.
- Confidence/freshness: high.
- Affected components: 11 Sales server/test files.
- Status: passed source-integrity gate; hosted review pending.
- Supersedes/superseded-by: none.
- Rollback/correction: reviewed revert or forward fix with the same gates.

## `EVID-HRMNY-20260831-RESEARCH-002` — deterministic test and compile gates

- Decision/finding: 34 focused Sales tests passed; the full web suite passed 125
  files and 679 tests; web typecheck, lint, diff check, and optimized production
  build passed.
- Reason: prove replay, mismatch, lineage, identity conflicts, receipts, role
  denial, evidence policy, and repository integration before review.
- Alternatives considered: source inspection only; focused tests only.
- Trade-offs: the local worktree also contained dependent UI/proof changes and
  is not an exact-SHA hosted receipt.
- Evidence: local command outputs captured on 2026-08-31.
- Confidence/freshness: high for the tested worktree.
- Affected components: Sales core, web app, production build graph.
- Status: passed locally; exact-SHA hosted gate open.
- Supersedes/superseded-by: none.
- Rollback/correction: rerun after every source correction and block on failure.

## `EVID-HRMNY-20260831-RESEARCH-003` — independent boundary review

- Decision/finding: three bounded reviews returned no remaining P0/P1 in their
  final core/UI scope after remediation; the contract reviewer retained two
  downstream provider gaps rather than approving them.
- Reason: challenge security, identity, provider, and UI claims independently.
- Alternatives considered: supervisor-only review; treat gaps as accepted.
- Trade-offs: reviewer approval is code evidence, not execution/provider proof.
- Evidence: final reviewer reports for contract, backend/PostgreSQL structure,
  and UI/E2E behavior.
- Confidence/freshness: high.
- Affected components: Sales research, Apollo gates, UI, CI proof design.
- Status: core review passed; free/paid provider acceptance open.
- Supersedes/superseded-by: supersedes initial findings recorded in
  `FAIL-HRMNY-20260831-RESEARCH-001`.
- Rollback/correction: rerun bounded review after material changes.

## `EVID-HRMNY-20260831-RESEARCH-004` — negative local browser receipt

- Decision/finding: three unrelated Playwright cases timed out in initial
  navigation while the page displayed `Checking access…`; direct HTTP page and
  asset reads were healthy, but three Chromium asset requests stayed pending.
- Reason: preserve the exact negative evidence and avoid a false UI pass.
- Alternatives considered: suppress the cases; classify direct HTTP as browser
  acceptance.
- Trade-offs: Linux CI must establish browser execution.
- Evidence: `FAIL-HRMNY-20260831-RESEARCH-002/003` and local error contexts.
- Confidence/freshness: high for the local session.
- Affected components: local Windows browser harness.
- Status: failed locally; hosted browser gate pending.
- Supersedes/superseded-by: none.
- Rollback/correction: keep the tests unchanged and use hosted terminal results.

## `EVID-HRMNY-20260831-RESEARCH-005` — immutable UI review slice

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; branch
  `ahmadbukhari097/codex/phase-4b-sales-research-ui-20260831`; commit
  `21774d858b66676dc4f9cfd48d039abf7b079472`.
- Decision/finding: the dependent commit contains six UI/E2E files and no
  database-CI proof or harness state.
- Reason: keep the operator surface reviewable separately from the core and
  disposable-PostgreSQL proof.
- Alternatives considered: add UI to the 1,805-line core change; combine all
  Phase 4 work in one pull request.
- Trade-offs: the review stack must land in order.
- Evidence: Git commit, staged diff check, staged secret scan, and independent
  UI reviewer approval with no remaining P0/P1.
- Confidence/freshness: high for source integrity; hosted execution pending.
- Affected components: research console, Hunt, inbound, Sales settings, and two
  browser specifications.
- Status: locally reviewed; hosted browser/preview acceptance open.
- Supersedes/superseded-by: none.
- Rollback/correction: revert only this dependent commit while preserving the
  server boundary; rerun all browser contracts after correction.

## `EVID-HRMNY-20260831-RESEARCH-006` — immutable PostgreSQL proof slice

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; branch
  `ahmadbukhari097/codex/phase-4c-sales-postgres-proof-20260831`; commit
  `8e4b8ba118e9bf5f33dc6f28c49edec38d7cc4f7`.
- Decision/finding: the dependent commit adds a guarded, disposable-PostgreSQL
  CI proof for separate-process proposal and Gate 1 races.
- Reason: memory tests cannot establish real database uniqueness, transaction,
  or concurrency behavior.
- Alternatives considered: exercise production; rely on process-local locks;
  run a database test without destination guards.
- Trade-offs: the proof adds CI time and remains an unexecuted contract until a
  hosted job passes.
- Evidence: six-file commit, staged secret/diff checks, explicit local-host and
  write gates, disabled provider modes, blocked fetch, and independent reviewer
  approval of the structure.
- Confidence/freshness: high for source/guard design; execution pending.
- Affected components: CI database job, Sales store, migration runtime.
- Status: documented and committed; hosted PostgreSQL acceptance open.
- Supersedes/superseded-by: none.
- Rollback/correction: revert this proof-only commit without changing product
  behavior; fix any hosted failure and preserve its receipt.

## `EVID-HRMNY-20260831-RESEARCH-007` — first hosted split and consolidation

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; branch
  stack PRs #241–#243.
- Decision/finding: #241 push run `33365024980` and PR run `33365048046`
  both passed their database jobs, then failed verify and browser build because
  the old console referenced the removed `research.runDaily` contract. Both
  preview deployments failed. The UI head
  `5f79ea0a601691618dfa18f589db76c1269e2ed8` was fast-forwarded into #241;
  GitHub marked #242 merged into that feature branch at 06:45:03Z. `main` and
  production were untouched.
- Reason: preserve the negative hosted receipt and the exact review-state
  correction rather than obscuring it.
- Alternatives considered: restore the obsolete runtime API; leave a known
  broken core review; combine the PostgreSQL proof too.
- Trade-offs: product server/UI review is larger, while database proof remains
  independently reviewable in #243.
- Evidence: jobs `99403777507`, `99403777746`, `99403846780`, and
  `99403846742`; PR #242 merge metadata identifies the feature base and actor.
- Confidence/freshness: high; read directly from GitHub on 2026-08-31.
- Affected components: #241 review boundary, #242 review state, #243 base.
- Status: negative split receipt preserved; corrected-head hosted gates pending.
- Supersedes/superseded-by: supersedes the original three-PR product split;
  pending terminal corrected receipt.
- Rollback/correction: do not restore `runDaily`; keep #243 proof-only and do
  not merge #241/#243 into `main` automatically.

## `EVID-HRMNY-20260831-RESEARCH-008` — first PostgreSQL execution and TLS correction

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; PR #243;
  correction `53122fceb0fee4f0f53c03202d2d8c5fec56b625`.
- Decision/finding: database jobs `99405492450` and `99405501137` both
  provisioned the pinned Supabase/PostgreSQL image and applied migrations, then
  failed before tests with “Client network socket disconnected before secure
  TLS connection was established”; three tests were skipped in each job.
- Reason: preserve the reproducible execution failure and bind its least-
  privilege correction.
- Alternatives considered: remove TLS globally; enable an unguarded environment
  switch; point CI at a remote database.
- Trade-offs: shared DB code gains a small policy resolver, while TLS downgrade
  is allowed only for an explicit local disposable-CI tuple.
- Evidence: runs `33365589634` and `33365592869`; 20 DB unit tests, DB/web
  typecheck, DB/web lint, 32 focused Sales tests, diff check, and secret scan
  passed after correction.
- Confidence/freshness: high for cause and local correction gates; corrected
  hosted execution pending.
- Affected components: DB connection policy and #243 database job.
- Status: negative receipt preserved; correction committed, hosted rerun open.
- Supersedes/superseded-by: supersedes the unexecuted proof claim; pending
  terminal corrected receipt.
- Rollback/correction: revert the override and proof together on any remote-host
  or missing-gate acceptance; never relax default TLS.

## `EVID-HRMNY-20260831-RESEARCH-009` — runtime reached and immutable-audit correction

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; PR #243;
  correction `289721dfde1a85aedd2df0c83bcb9ac1c5142393`.
- Decision/finding: database jobs `99407221603` and `99407234027` both
  connected through the guarded loopback TLS exception, applied migrations,
  and passed the concurrent exact-replay case. The remaining two cases failed
  before execution because the proof cleanup attempted to delete from the
  append-only `audit_event` table.
- Reason: retain proof that application/database concurrency executed while
  distinguishing a destructive test-harness defect from a product defect.
- Alternatives considered: weaken the append-only trigger; truncate audit
  history; hide the failed cases.
- Trade-offs: every proof invocation now uses unique request-scoped fixtures
  and exact receipt/signal assertions, leaving immutable records untouched
  until the disposable CI database is destroyed with its job.
- Evidence: runs `33366173142` and `33366176032`; local web typecheck/lint,
  DB 20-test suite/typecheck, formatting, diff, and staged secret checks passed
  for the correction.
- Confidence/freshness: high for cause and correction; corrected hosted
  execution pending.
- Affected components: Sales PostgreSQL proof harness only.
- Status: negative receipt preserved; non-destructive correction committed;
  terminal hosted rerun open.
- Supersedes/superseded-by: follows `EVID-HRMNY-20260831-RESEARCH-008`; pending
  successful runtime receipt.
- Rollback/correction: revert the proof correction only if exact-scoped
  assertions fail; never add mutation of `audit_event` to test cleanup.
