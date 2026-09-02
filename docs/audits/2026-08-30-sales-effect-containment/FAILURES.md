# Failures and learning

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; tool/model `Codex agent (exact model ID not
exposed)`; branch `ahmadbukhari097/codex/phase-1-sales-effect-containment-20260830`;
commit `10d997c7e28221f186ecec7aa3b101b2a6096dc3`. Every corrected failure remains
part of the permanent learning record.

## `FAIL-HRMNY-20260830-SALES-001` — missing test import

- Decision/finding: the first focused run failed because the new daily signal
  constant was not imported into its test.
- Reason: test expansion outpaced the import update.
- Alternatives considered: loosen the assertion; import the canonical symbol.
- Trade-offs: none material.
- Evidence: initial focused-test failure; corrected test source.
- Confidence/freshness: high.
- Affected components: daily-cron test only.
- Status: corrected; regression suite passes.
- Supersedes/superseded-by: none.
- Rollback/correction: retain symbol-based assertions.

## `FAIL-HRMNY-20260830-SALES-002` — seeded-memory assumption

- Decision/finding: an early assertion assumed CRM reset meant an empty store,
  but reset deliberately reseeds fixtures.
- Reason: the test asserted emptiness instead of immutability.
- Alternatives considered: change product reset behavior; compare snapshots.
- Trade-offs: snapshot assertions are slightly more verbose.
- Evidence: corrected before/after operational snapshot test.
- Confidence/freshness: high.
- Affected components: containment test only.
- Status: corrected.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve fixture-aware before/after comparison.

## `FAIL-HRMNY-20260830-SALES-003` — denial path could notify Chat

- Decision/finding: the first refusal implementation reused a helper capable of
  sending a Google Chat webhook.
- Reason: persistence and external notification were coupled.
- Alternatives considered: swallow webhook failures; split local persistence.
- Trade-offs: refusal alerts are local-only for now.
- Evidence: independent review and hostile-webhook zero-fetch test.
- Confidence/freshness: high.
- Affected components: health signals and Chat alerts.
- Status: corrected with `recordHealthSignal`.
- Supersedes/superseded-by: none.
- Rollback/correction: never use an external notifier in the denied path.

## `FAIL-HRMNY-20260830-SALES-004` — incomplete legacy entrypoint inventory

- Decision/finding: initial containment missed `crm.prospect`,
  `deals.verifyEmail`, and direct service imports; mock provider modes were also
  not yet part of the exact predicate.
- Reason: the first pass guarded only the known scheduler/router surface.
- Alternatives considered: accept route-only coverage; inventory and add
  service-level defense-in-depth.
- Trade-offs: more files changed, but bypass risk is removed.
- Evidence: independent review and 10-test focused re-review.
- Confidence/freshness: high.
- Affected components: routes, agent tools, core services, providers.
- Status: corrected; reviewer found no remaining P0/P1 bypass.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve both entrypoint and service assertions.

## `FAIL-HRMNY-20260830-SALES-005` — deterministic DB mode exposed one test assumption

- Decision/finding: switching ordinary tests to memory mode caused the
  production-auth guard test to fail for the database guard before reaching its
  intended auth assertion.
- Reason: the test relied on inherited global database mode.
- Alternatives considered: return global tests to auto mode; override this one
  test explicitly.
- Trade-offs: one test has a local environment stub.
- Evidence: full suite first run 624/625, then 625/625 after correction.
- Confidence/freshness: high.
- Affected components: security test setup.
- Status: corrected.
- Supersedes/superseded-by: none.
- Rollback/correction: keep test-specific environment intent explicit.

## `FAIL-HRMNY-20260830-SALES-006` — local Windows browser response stall

- Decision/finding: both Next dev and production servers returned HTTP headers
  for API/tRPC requests on Windows but emitted zero response-body bytes; Chromium
  remained on `Checking access…` until the 90-second navigation timeout.
- Reason: bounded diagnosis establishes a local Next/Node response-stream
  failure, but the lower-level cause is not yet proven.
- Alternatives considered: change product auth to make the test pass; use live
  credentials; rely on Linux CI.
- Trade-offs: local browser acceptance is not claimed; Linux CI must decide the
  PR browser gate.
- Evidence: Playwright error context; `curl` received HTML normally but timed
  out with `content-length: 2741` and zero bytes on `auth.session`.
- Confidence/freshness: high for symptom, medium for environmental attribution.
- Affected components: local Playwright/Next HTTP acceptance only.
- Status: open environmental failure; no product workaround applied.
- Supersedes/superseded-by: none.
- Rollback/correction: reproduce on Linux CI; if CI fails, diagnose the API
  handler before merge. Preserve captured evidence locally.

## `FAIL-HRMNY-20260830-SALES-007` — raw URL was not a valid harness receipt

- Decision/finding: the first Inngest completion transition rejected a raw URL
  in the receipt field because the harness requires an explicit reference
  scheme; no task state changed.
- Reason: a URL is source evidence, while the transition receipt must be a
  stable typed reference.
- Alternatives considered: weaken receipt validation; use a receipt reference
  and retain URLs in the message.
- Trade-offs: one corrected transition was required.
- Evidence: harness validation error and
  `receipt:inngest-official-docs-20260830`.
- Confidence/freshness: high.
- Affected components: local execution-state metadata only.
- Status: corrected; Inngest source task succeeded.
- Supersedes/superseded-by: none.
- Rollback/correction: use explicit `receipt:`, `config:`, or other allowed
  reference schemes; never place credentials in the field.

## `FAIL-HRMNY-20260830-SALES-008` — cluster-only removed graph metadata

- Decision/finding: Graphify 0.9.5 preserved 213 nodes and 626 edges but rewrote
  the run graph's metadata object empty and removed the top-level project commit
  stamp during `cluster-only`.
- Reason: the generic serializer does not retain the custom harness projection
  metadata.
- Alternatives considered: omit clustering; accept an unbound graph; reattach
  only the evidence boundary and exact project/harness commits.
- Trade-offs: a deterministic post-cluster metadata correction is required.
- Evidence: before/after graph inspection and the zero-defect graph diagnostic.
- Confidence/freshness: high for the observed 0.9.5 behavior.
- Affected components: local Graphify provenance metadata only; relationships
  were unchanged.
- Status: corrected locally.
- Supersedes/superseded-by: none.
- Rollback/correction: rerun the projection, cluster, then restore the projection
  metadata until the serializer preserves it natively.
