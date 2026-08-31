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

## `EVID-HRMNY-20260831-RESEARCH-010` — disposable PostgreSQL runtime passed twice

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; PR #243;
  head `a31cf23fbbfdcfe99903df38fe3d455c9ec4373e`.
- Decision/finding: push job `99408940527` in run `33366754463` and PR job
  `99408959731` in run `33366758431` both applied the repository migrations
  and passed all three separate-process PostgreSQL cases. Exact replay produced
  one proposal/signal/receipt, payload mismatch left no partial duplicate, and
  concurrent Gate 1 produced one canonical company with linked lineage.
- Reason: establish repeatable database transaction, uniqueness, idempotency,
  and serialization behavior without touching a shared or production system.
- Alternatives considered: accept one run only; infer runtime behavior from
  unit tests; use a remote database.
- Trade-offs: this is synthetic runtime acceptance for a disposable schema,
  not deployed-schema readback, recovery, user, provider, or production
  acceptance.
- Evidence: both job APIs returned `completed/success`; logs show one test file
  and three tests passed in 3.444s and 3.870s respectively, including each
  named concurrency case.
- Confidence/freshness: high; read directly from GitHub on 2026-08-31.
- Affected components: Sales proposal persistence, Gate 1 transaction, inbox,
  signal lineage, audit append path, and CI database policy.
- Status: synthetic disposable-PostgreSQL runtime accepted; broader acceptance
  remains explicitly open.
- Supersedes/superseded-by: supersedes pending execution states in
  `EVID-HRMNY-20260831-RESEARCH-008/009`; none.
- Rollback/correction: preserve the jobs and logs; fix forward on regression
  without weakening TLS guards or append-only audit enforcement.

## `EVID-HRMNY-20260831-RESEARCH-011` — provider/synthetic browser mismatch

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; product
  head `5f79ea0a601691618dfa18f589db76c1269e2ed8`.
- Decision/finding: push job `99405049509` and PR job `99405060099` each
  started 88 Chromium tests, passed the first 27, then consumed their timeout
  budget in legacy tests that attempted to fill the now-disabled Apollo query
  field. Both jobs were cancelled at the 25-minute workflow limit.
- Reason: retain the negative receipt and the source-level cause instead of
  increasing timeouts or re-enabling provider mocks.
- Alternatives considered: restore writable mock-provider fields; delete the
  affected continuity tests; accept direct HTTP preview as browser proof.
- Trade-offs: a separate synthetic input and updated tests were required.
- Evidence: runs `33365456016` and `33365459564`; source inspection identified
  the first blocking action as `fill` on `hunt-apollo-query`, which is
  intentionally disabled when Apollo is disconnected.
- Confidence/freshness: high for the logs; high-confidence source inference for
  the blocking action because cancellation prevented Playwright's final error
  summary.
- Affected components: four synthetic Sales/delivery browser journeys.
- Status: negative receipt preserved; corrected by `762ffec...`.
- Supersedes/superseded-by: superseded by
  `EVID-HRMNY-20260831-RESEARCH-012/014`.
- Rollback/correction: retain fail-closed provider fields and route fixtures
  through the explicit synthetic control only.

## `EVID-HRMNY-20260831-RESEARCH-012` — corrected product browser head passed twice

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; product
  head `762ffec1ca78137ed0d86778965abae7bb699010`.
- Decision/finding: push E2E job `99412056704` and PR E2E job `99412067764`
  each passed all 88 Chromium journeys in 1.5 and 1.6 minutes. The corrected
  synthetic Apollo fixture, disconnected free search, Gate 1 desktop/mobile,
  won handover, portal links, and client sandbox cases all passed.
- Reason: establish Linux browser execution after the local Windows asset stall
  and the provider/synthetic test mismatch.
- Alternatives considered: rely on local source/build proof; accept one run;
  weaken provider disconnection assertions.
- Trade-offs: this proves deterministic synthetic/UI behavior, not provider,
  named-user, recovery, or production acceptance.
- Evidence: runs `33367816049` and `33367819821`; paired verify/database jobs
  and both Vercel review previews also passed.
- Confidence/freshness: high; read directly from GitHub on 2026-08-31.
- Affected components: full browser suite and product review head.
- Status: hosted synthetic browser accepted at the exact head.
- Supersedes/superseded-by: supersedes `EVID-HRMNY-20260831-RESEARCH-004/011`;
  reaffirmed by `EVID-HRMNY-20260831-RESEARCH-014`.
- Rollback/correction: keep the browser boundary and block review on any future
  provider-field or role-isolation regression.

## `EVID-HRMNY-20260831-RESEARCH-013` — random-value privacy assertion flake

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; proof head
  `cbc623ba7078782137891c7f7165e287bfaa4918`.
- Decision/finding: push verify job `99412377647` failed one of 679 tests when
  a random asset UUID contained `afee`; the portal test incorrectly searched
  every serialized value for `fee`. Paired PR verify job `99412387184` passed
  with a different UUID, confirming the probabilistic assertion.
- Reason: preserve a deterministic explanation of the one-sided CI result and
  strengthen the actual privacy check.
- Alternatives considered: rerun until green; pin UUIDs; remove the portal
  finance denial test.
- Trade-offs: correction `dd732f3...` calls the same recursive forbidden-key
  guard as the portal projection and retains separate leak-injection coverage.
- Evidence: run `33367901444` failed only `m6.demo.test.ts`; paired run
  `33367904814` passed. Ten repeated local file executions produced 120 passing
  tests, followed by typecheck and lint success.
- Confidence/freshness: high.
- Affected components: portal payload security test; no runtime payload change.
- Status: negative receipt preserved and correction confirmed by current runs.
- Supersedes/superseded-by: superseded by
  `EVID-HRMNY-20260831-RESEARCH-014`.
- Rollback/correction: inspect keys/schema, never unconstrained random values,
  when testing forbidden payload fields.

## `EVID-HRMNY-20260831-RESEARCH-014` — terminal current-head synthetic gates

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; product
  head `dd732f3ad76a71f208ba9e7c6e8de6899bcb2887`; proof head
  `90fc72fbc2c02fbd8380aba6659efbd4b5dbb303`.
- Decision/finding: product runs `33368491587/33368494829` and proof runs
  `33368523215/33368526480` each passed database, verify, and E2E. All four E2E
  jobs passed 88 tests in 1.3–1.5 minutes; proof database jobs `99414196449`
  and `99414206335` each passed all three PostgreSQL concurrency cases.
- Reason: bind the final reviewed source stack to duplicate hosted execution
  after both browser and privacy-test corrections.
- Alternatives considered: rely on earlier pre-rebase runs; accept only the PR
  event; infer the proof from unchanged patches.
- Trade-offs: external security review remained a separate status and passed
  both heads; none of these receipts authorizes merge, production, provider,
  recovery, or UAT.
- Evidence: verify jobs `99414099715`, `99414109530`, `99414196542`, and
  `99414206600`; E2E jobs `99414099819`, `99414109840`, `99414196237`, and
  `99414206658`; four passing database jobs; both Vercel review deployments
  passed for each PR; Cursor security reviewers
  `bc-47acb3bb-8b87-4e31-adb6-5697d9236a4c` and
  `bc-16f3c348-0a7e-48b4-ace4-8a62aa47c725` passed.
- Confidence/freshness: high; read directly from GitHub on 2026-08-31.
- Affected components: complete Phase 4 product/proof review stack.
- Status: synthetic code, database, browser, preview, approval, and security
  review gates accepted; merge and all operational acceptance remain
  separate.
- Supersedes/superseded-by: supersedes pending exact-head hosted gate claims;
  none.
- Rollback/correction: do not merge automatically; retain the run/job receipts
  and correct forward on any later gate regression.
