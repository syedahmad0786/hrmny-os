# Failures

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
`41145c85e799f6b906dfca23a37aea0894cc9582`.

## `FAIL-HRMNY-20260831-RESEARCH-001` — review exposed incomplete boundaries

- Decision/finding: independent review found ambiguous company merges, Gate 1
  without a terminal receipt, incomplete signal reconciliation, synthetic
  Apollo leakage, unsupported roles, hidden mutation errors, and reserved-IP
  evidence acceptance.
- Reason: preserve corrected failures and their lessons.
- Alternatives considered: omit the findings after correction.
- Trade-offs: the implementation gained explicit blockers and tests.
- Evidence: three bounded reviewer reports and 34 focused passing tests after
  remediation.
- Confidence/freshness: high.
- Affected components: evidence validation, Gate 1, Apollo, roles, UI contract.
- Status: corrected before immutable core commit; later provider gaps remain.
- Supersedes/superseded-by: superseded by ADRs `-001` through `-004`.
- Rollback/correction: retain every regression fixture and re-run independent
  review after boundary changes.

## `FAIL-HRMNY-20260831-RESEARCH-002` — Windows development server returned no body

- Decision/finding: the local Next development server accepted connections for
  `/`, `/login`, and Sales routes but did not complete response bodies.
- Reason: preserve the first local browser-runtime failure rather than calling
  specification compilation a pass.
- Alternatives considered: wait indefinitely; weaken tests; omit the failure.
- Trade-offs: an optimized server and hosted Linux CI are required for proof.
- Evidence: timed local requests and terminated development session.
- Confidence/freshness: high for this Windows environment.
- Affected components: local Node 24 / Next development harness.
- Status: unresolved local environment issue; not yet a product defect.
- Supersedes/superseded-by: none.
- Rollback/correction: diagnose independently; do not change product contracts
  solely to accommodate the local server.

## `FAIL-HRMNY-20260831-RESEARCH-003` — optimized local Chromium asset stall

- Decision/finding: the optimized server returned Sales HTML and direct static
  asset requests with HTTP 200, but Chromium left three static assets pending,
  kept `document.readyState=loading`, and timed out three unrelated cases in
  `page.goto` before assertions.
- Reason: classify the common harness failure precisely and keep browser
  acceptance open.
- Alternatives considered: run the remaining cases for repeated 90-second
  failures; claim the server HTTP result as UI acceptance.
- Trade-offs: hosted Linux E2E becomes the exact-SHA browser gate.
- Evidence: Playwright error contexts, pending-request probe, and direct 200
  reads of the same assets.
- Confidence/freshness: high for the observed session; cause unproven.
- Affected components: local Windows Chromium/Next serving path.
- Status: open local harness issue; hosted proof pending.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve artifacts, use bounded diagnostics, and never
  weaken assertions or extend unbounded waits.

## `FAIL-HRMNY-20260831-RESEARCH-004` — local PostgreSQL runtime unavailable

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; branch
  `ahmadbukhari097/codex/phase-4c-sales-postgres-proof-20260831`; commit
  `8e4b8ba118e9bf5f33dc6f28c49edec38d7cc4f7`.
- Decision/finding: Docker was unavailable locally, so the disposable
  PostgreSQL proof could not be executed on this host.
- Reason: record the missing execution rather than infer database behavior from
  source inspection.
- Alternatives considered: point the test at production or an unknown remote
  database; skip the proof entirely.
- Trade-offs: hosted CI is the first allowed execution environment.
- Evidence: local runtime discovery and the proof's non-local target guard.
- Confidence/freshness: high.
- Affected components: local database test harness only.
- Status: local execution unavailable; hosted proof pending.
- Supersedes/superseded-by: none.
- Rollback/correction: use the isolated CI service; never weaken the local-target
  and explicit-write gates.

## `FAIL-HRMNY-20260831-RESEARCH-005` — server/UI split was not buildable

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; PR #241
  initial head `b10aeb010ecaf71ce06f36c59ff774b9ad2c02bf`.
- Decision/finding: removing the server `runDaily` procedure while its UI
  consumer lived only in the next stacked PR made #241 fail typecheck, browser
  build, and preview deployment in two identical hosted runs.
- Reason: record that an API and its only consumer replacement form one
  deployable vertical slice.
- Alternatives considered: reintroduce a deprecated synthetic procedure; keep
  a permanently red base PR; ignore duplicated failures.
- Trade-offs: core and UI are consolidated in #241; the database race proof
  remains separate in #243.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-007`.
- Confidence/freshness: high.
- Affected components: Sales research router and console; PR stack.
- Status: corrected on the feature branch; corrective hosted reruns pending.
- Supersedes/superseded-by: superseded by #241 head `5f79ea0...`.
- Rollback/correction: preserve atomic API/consumer changes and never restore a
  synthetic visible pathway solely to make an intermediate branch compile.

## `FAIL-HRMNY-20260831-RESEARCH-006` — disposable database TLS mismatch

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; PR #243
  initial head `c56603b650856c2b43a95b4b4f6ce5515534cd66`.
- Decision/finding: the application DB client correctly defaulted to required
  TLS, but the loopback CI container did not offer TLS, so both proof jobs
  failed in setup and skipped all three tests.
- Reason: retain the difference between migration success and application
  runtime connectivity.
- Alternatives considered: disable TLS for all connections; use production;
  mark migration success as runtime proof.
- Trade-offs: correction adds an explicit local disposable-CI-only exception.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-008`.
- Confidence/freshness: high.
- Affected components: DB client policy and PostgreSQL proof setup.
- Status: corrected in `53122fc...`; hosted confirmation pending.
- Supersedes/superseded-by: pending corrected execution receipt.
- Rollback/correction: fail closed unless hostname, `CI=true`, explicit write
  gate, and disable mode all match; TLS remains required otherwise.

## `FAIL-HRMNY-20260831-RESEARCH-007` — proof cleanup violated audit immutability

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; PR #243
  head `436b1c76edc97b8d819ba3ebafa740ea2ba71129`.
- Decision/finding: both hosted database jobs passed the first concurrency test
  and then failed when between-test cleanup issued `delete` against the
  append-only `audit_event` table.
- Reason: preserve the invariant-enforcement receipt and the test-design lesson
  rather than weakening production schema policy for disposable fixtures.
- Alternatives considered: disable the trigger in CI; truncate broad tables;
  delete immutable history in setup/teardown.
- Trade-offs: correction `289721dfde1a85aedd2df0c83bcb9ac1c5142393`
  uses unique per-run identities and exact request-scoped queries; records live
  only for the isolated job lifetime.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-009`.
- Confidence/freshness: high.
- Affected components: PostgreSQL proof harness; no product runtime path.
- Status: corrected and confirmed by both hosted PostgreSQL jobs in
  `EVID-HRMNY-20260831-RESEARCH-010`.
- Supersedes/superseded-by: destructive cleanup is superseded by correction
  `289721d...` and passing receipt `EVID-HRMNY-20260831-RESEARCH-010`.
- Rollback/correction: preserve append-only enforcement and correct proof data
  isolation instead of changing the operational invariant.

## `FAIL-HRMNY-20260831-RESEARCH-008` — synthetic tests reused a disabled provider field

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; product
  head `5f79ea0a601691618dfa18f589db76c1269e2ed8`.
- Decision/finding: legacy synthetic browser journeys tried to type fixture
  company names into the real Apollo query input after the product correctly
  made it read-only while disconnected.
- Reason: provider and fixture controls had shared client state before the
  fail-closed boundary was introduced.
- Alternatives considered: enable the provider form in mock mode; increase
  Playwright timeouts; drop downstream continuity tests.
- Trade-offs: correction adds a separate synthetic input in collapsed test
  tools and preserves both provider truth and continuity coverage.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-011/012`.
- Confidence/freshness: high.
- Affected components: Hunt and four browser journeys.
- Status: corrected in `762ffec...`; duplicate hosted browser proof passed.
- Supersedes/superseded-by: superseded by `ADR-HRMNY-20260831-RESEARCH-005`.
- Rollback/correction: never couple fixture data entry to a disabled provider
  control.

## `FAIL-HRMNY-20260831-RESEARCH-009` — portal regex matched a random UUID

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; proof run
  `33367901444`.
- Decision/finding: an assertion looking for `fee` anywhere in serialized
  portal data failed when a random UUID contained those letters; the paired
  run passed with another UUID.
- Reason: value-wide substring matching did not represent the actual forbidden
  field boundary.
- Alternatives considered: retry until green; seed fixed UUIDs; remove the
  portal privacy assertion.
- Trade-offs: the corrected test delegates recursive key validation to the
  production portal guard and retains explicit forbidden-key failure coverage.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-013/014`.
- Confidence/freshness: high.
- Affected components: one M6 portal test; no runtime data path.
- Status: corrected in `dd732f3...`; duplicate current verify runs passed.
- Supersedes/superseded-by: superseded by
  `RSN-HRMNY-20260831-RESEARCH-003`.
- Rollback/correction: assert payload keys/schema, not arbitrary generated
  values.
