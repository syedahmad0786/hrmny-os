# Failures

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; final
implementation commit `fc2d288074bc44624abbb9e701b5c5ffa7adb775`.

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
- Affected components: 27-case PostgreSQL runtime suite and disposable
  migration verifier.
- Status: unresolved locally; bounded hosted fallback selected.
- Supersedes/superseded-by: none.
- Rollback/correction: use CI's disposable PostgreSQL service and never point
  synthetic verification at production.
