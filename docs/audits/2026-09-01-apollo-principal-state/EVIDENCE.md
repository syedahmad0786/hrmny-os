# Evidence

Common metadata for every record: 2026-09-01;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4e-apollo-principal-state-20260901`; implementation
commit `5a166dd935ba1d9ec5fadbf94de8e101a2fc1dc5`; base
`e3551726dd95e9085625b0d5a10f226453d14f24`.

## `EVID-HRMNY-20260901-APOLLO-018` — deterministic local principal matrix

- Decision/finding: root lint passed seven tasks; root typecheck passed seven
  tasks; root tests passed 946 cases (web 720, database 30, integrations 111,
  gate 25, AI 56, cache 4); the final isolated web production build generated
  86 routes; and the complete focused Hunt Playwright file passed 8/8 in 9.4
  seconds through the checked-in Windows bridge.
- Reason: principal isolation requires real mounted-page transitions and stale
  asynchronous responses, not only static review.
- Alternatives considered: unit-only proof; reload-only browser test; live
  Apollo trial.
- Trade-offs: local memory/mock proof cannot grant provider, deployment,
  recovery, UAT, or production acceptance. Hosted exact-head CI is pending.
- Evidence: commands executed with `DATABASE_MODE=memory`, `AUTH_MODE=dev`,
  `WORK_ENVIRONMENT_KIND=sandbox`, mock/disabled AI and providers,
  `APOLLO_ALLOW_PAID_OPERATIONS=false`, and `XERO_WRITE_ENABLED=false`.
  Browser cases prove current terminal render, same-principal reload, legacy and
  mismatched deletion, inaccessible storage denial, delayed status suppression,
  delayed mutation suppression, readiness blocking, no effect request while
  unresolved, Research draft remount, and mobile containment.
- Confidence/freshness: high for local deterministic execution on 2026-09-01.
- Affected components: all implementation files in commit `5a166dd`.
- Status: local proof accepted; hosted event matrices pending.
- Supersedes/superseded-by: supersedes the local-open portion of
  `GAP-HRMNY-20260831-APOLLO-009`; hosted receipt will supersede this state.
- Rollback/correction: preserve failures, rerun the same safe matrix after every
  source change, and never add live credentials to synthetic tests.

## `EVID-HRMNY-20260901-APOLLO-019` — bounded independent review

- Decision/finding: two read-only reviewers challenged principal sourcing,
  storage exceptions, cache races, Research draft leakage, stale callbacks,
  pending labels, and test determinism. Final review reported no blocking
  implementation defect after remediation. A separate scheduler reviewer kept
  provider-wide concurrency open for Phase 4f.
- Reason: adversarial review finds cross-account races that happy-path tests
  miss.
- Alternatives considered: self-review only; allow reviewers to edit the same
  files.
- Trade-offs: review does not replace execution or hosted acceptance.
- Evidence: final agent reports and implemented regression cases.
- Confidence/freshness: high for reviewed source; no independent test execution.
- Affected components: Phase 4e source, tests, and Phase 4f dependency.
- Status: review complete; hosted checks pending.
- Supersedes/superseded-by: none.
- Rollback/correction: reopen the exact finding on any future failing case and
  preserve `GAP-010/012` as explicit boundaries.
