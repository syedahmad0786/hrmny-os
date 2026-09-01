# Failures

Common metadata for every record: 2026-09-01;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4e-apollo-principal-state-20260901`; commit
`5a166dd935ba1d9ec5fadbf94de8e101a2fc1dc5`.

## `FAIL-HRMNY-20260901-APOLLO-013` — Playwright header masked the soft switch

- Decision/finding: the first focused run passed five cases, then the two new
  account-switch cases failed: the in-flight label remained `Searching…` and
  the readiness gate timed out.
- Reason: Playwright's context-level `x-dev-role: partner` header overrode the
  browser application's changed dev persona on intercepted requests. The page
  selector changed to AM while server queries still resolved Partner.
- Alternatives considered: weaken assertions; reload; remove the dev header
  contract.
- Trade-offs: tests now explicitly switch both the browser persona and the
  synthetic transport header; production identity behavior is unchanged.
- Evidence: failed run output and corrected 2/2 then 8/8 browser runs.
- Confidence/freshness: high.
- Affected components: test harness only.
- Status: corrected; failure retained.
- Supersedes/superseded-by: superseded by
  `EVID-HRMNY-20260901-APOLLO-018`.
- Rollback/correction: preserve explicit transport identity in same-tab persona
  tests and never substitute a reload for mounted-page proof.

## `FAIL-HRMNY-20260901-APOLLO-014` — one aggregate Windows build lost `_document`

- Decision/finding: an aggregate `pnpm build` compiled the web application but
  failed during page-data collection with `PageNotFoundError: /_document`.
  Immediate isolated web rebuild succeeded with all 86 routes.
- Reason: intermittent Windows Next build-artifact resolution; no source/type
  failure was reported and the same source had already built successfully.
- Alternatives considered: claim the failed aggregate run green; delete source;
  ignore the isolated rerun.
- Trade-offs: hosted Linux CI remains the authoritative aggregate build receipt;
  the local intermittent failure is retained rather than hidden.
- Evidence: failed aggregate output followed by successful isolated web build.
- Confidence/freshness: high for observed failure; root cause medium.
- Affected components: local Windows build harness, not a demonstrated product
  route defect.
- Status: locally recovered; hosted exact-head build pending.
- Supersedes/superseded-by: none.
- Rollback/correction: rerun from a settled build directory and rely on hosted
  CI before acceptance; investigate only if it recurs there.

No failed path called a provider, used a credit, sent a message, deployed,
migrated production, changed an account, or wrote Xero.

