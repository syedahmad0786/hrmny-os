# Failures

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commits `fc2d288074bc44624abbb9e701b5c5ffa7adb775` and
`900bc0e548061b5b6872c3552b18ff8d1c309a6b`.

## `FAIL-HRMNY-20260902-APOLLO-016` — ambiguity was initially understated

- Decision/finding: early status copy and the definitive 401/403 branch could
  hide ambiguity created by a prior lost authorized attempt.
- Reason: terminal-state code initially described only the latest attempt.
- Alternatives considered: leave the UI concise; clear ambiguity on any later
  response.
- Trade-offs: operator copy is more cautious but does not imply an unverified
  provider outcome.
- Evidence: adversarial review and regression tests for status copy and a lost
  attempt followed by definitive authentication failure.
- Confidence/freshness: high.
- Affected components: receipt projection, retry/dead-letter/revoked copy.
- Status: corrected before implementation commit.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve `providerOutcomeAmbiguous` across all terminal
  transitions and reopen this failure if any projection drops it.

## `FAIL-HRMNY-20260902-APOLLO-017` — reserved-key scope was initially one-way

- Decision/finding: an early trigger draft assigned the free-search key but did
  not clear it when a job changed to another kind, silently enrolling paid or
  unrelated work.
- Reason: the invariant was expressed as an assignment rule rather than a
  bidirectional reserved-key boundary.
- Alternatives considered: document that job kinds never change; permit other
  jobs to retain the key.
- Trade-offs: the corrected trigger is stricter and the CHECK is more verbose.
- Evidence: transition proof now covers Search-to-Match and direct Match insert
  with the reserved key.
- Confidence/freshness: high.
- Affected components: migration `0076`, discovery, and disposable verifier.
- Status: corrected before implementation commit.
- Supersedes/superseded-by: none.
- Rollback/correction: reject any migration whose readback permits a non-search
  row to retain `provider:apollo`.

## `FAIL-HRMNY-20260902-APOLLO-018` — migration syntax and security omissions were caught locally

- Decision/finding: an intermediate CHECK expression missed `AND`, and the
  first final draft omitted the repository-required RLS/Data API revocation
  stanza. Independent review and `migration-security.test.ts` caught both.
- Reason: iterative migration edits and a repository-wide security convention
  were not yet reflected in the draft.
- Alternatives considered: waive the generic migration test; rely on prior RLS
  state without explicit readback.
- Trade-offs: repeating RLS/revokes is redundant but auditable and fail-closed.
- Evidence: final database tests 38/38, clean diff, exact SQL hash, and
  independent re-review.
- Confidence/freshness: high.
- Affected components: migration `0076` and its immutable contract hash.
- Status: corrected before implementation commit.
- Supersedes/superseded-by: none.
- Rollback/correction: any SQL edit requires a new hash, full database/security
  tests, and fresh review.

## `FAIL-HRMNY-20260902-APOLLO-019` — local PostgreSQL runtime unavailable

- Decision/finding: `DATABASE_URL` was unset, no local PostgreSQL client was
  installed, and the available Docker executable had no usable daemon.
- Reason: the clean worktree had no safe disposable database runtime.
- Alternatives considered: use production; install/start infrastructure
  without scope; omit the evidence gap.
- Trade-offs: database execution proof waits for hosted CI.
- Evidence: environment checks and `GAP-HRMNY-20260902-APOLLO-014`.
- Confidence/freshness: high on 2026-09-02.
- Affected components: 29-case PostgreSQL runtime suite and disposable
  migration verifier.
- Status: unresolved locally; bounded hosted fallback selected.
- Supersedes/superseded-by: none.
- Rollback/correction: use CI's disposable PostgreSQL service and never point
  synthetic verification at production.

## `FAIL-HRMNY-20260902-APOLLO-020` — first hosted database assertion leaked its test lock

- Decision/finding: the initial push and pull-request database jobs failed.
  Migration verification/application and the Sales PostgreSQL proof passed,
  then the first Apollo concurrency case expected a ten-minute retry while the
  runtime correctly returned the bounded five-second retry. The assertion
  exited before releasing the first provider promise, leaving the lock-only
  transaction open and causing 24 later cases to report `busy`.
- Reason: the test expectation did not follow the provider-lock busy contract,
  and cleanup was not protected by `finally`.
- Alternatives considered: treat all 24 cascades as runtime defects; rerun the
  unchanged test; weaken the runtime busy bound.
- Trade-offs: correction adds explicit cleanup even when an assertion fails and
  keeps the intended five-second retry behavior.
- Evidence: push run `33549333254`, job `99994613400`; pull-request run
  `33549371235`, job `99994746031`; correction commit `900bc0e`.
- Confidence/freshness: high on 2026-09-02 from both identical hosted failures.
- Affected components: Apollo PostgreSQL acceptance fixture and hosted database
  acceptance state; no production database.
- Status: corrected in source; fresh hosted proof pending.
- Supersedes/superseded-by: none.
- Rollback/correction: retain `try/finally` release plus `Promise.allSettled`,
  and never accept the failed runs as provider-slot evidence.

## `FAIL-HRMNY-20260902-APOLLO-021` — browser acceptance asserted obsolete receipt copy

- Decision/finding: 92 of 93 browser journeys passed in each initial matrix;
  the terminal-principal journey failed because it expected the obsolete
  wording “reconciled from receipt,” while the reviewed UI now reports the
  current Apollo attempt and the receipt identifier explicitly.
- Reason: the UI copy was hardened without updating the browser contract.
- Alternatives considered: restore ambiguous old wording; remove the status
  assertion; accept a flaky retry.
- Trade-offs: the corrected test asserts both `current Apollo mock attempt` and
  the synthetic receipt prefix. A local replay reached HTTP 200 but the Windows
  browser hung at navigation, so only a fresh hosted Linux run may close it.
- Evidence: push run `33549333254`, job `99994613933`; pull-request run
  `33549371235`, job `99994746036`; correction commit `900bc0e`; bounded local
  Playwright replay timed out at `page.goto` and was stopped before its retry.
- Confidence/freshness: high for hosted failure cause and source correction;
  hosted corrected result pending.
- Affected components: one Playwright assertion and source acceptance state.
- Status: corrected in source; fresh hosted proof pending.
- Supersedes/superseded-by: none.
- Rollback/correction: keep the explicit current-attempt and receipt assertions;
  investigate local browser startup separately if hosted Linux disagrees.
