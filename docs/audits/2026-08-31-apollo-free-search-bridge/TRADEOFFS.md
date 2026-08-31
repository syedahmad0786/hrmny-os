# Trade-offs

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4d-apollo-free-receipts-20260831`; implementation
commit `6b82f165b3c552a2daa95c88d4010156aafbbcc1`.

## `TRADE-HRMNY-20260831-APOLLO-001` — asynchronous UX for durable control

- Decision/finding: submit, persist, and poll rather than hold the browser open
  through a provider request.
- Reason: durable replay and fast acknowledgement outweigh a one-response UX.
- Alternatives considered: synchronous tRPC call; optimistic client result.
- Trade-offs: the UI needs pending state, reload recovery, cancellation, and
  status polling; in return it gains stable evidence and failure recovery.
- Evidence: browser and state-machine tests.
- Confidence/freshness: high locally.
- Affected components: Hunt UI, router, receipt service.
- Status: accepted for this pilot.
- Supersedes/superseded-by: none.
- Rollback/correction: keep the durable receipt even if later transport becomes
  streaming or push-based.

## `TRADE-HRMNY-20260831-APOLLO-002` — safety-first throughput ceiling

- Decision/finding: initial Inngest execution uses global concurrency one and a
  database lease/token fence.
- Reason: two schedulers and uncertain provider limits require a conservative
  first production ceiling.
- Alternatives considered: per-user concurrency; unbounded queue; in-memory
  mutex.
- Trade-offs: a backlog may wait longer; duplicate provider effects are less
  likely and rate-limit evidence is easier to interpret.
- Evidence: Inngest handler and lease tests; open managed-runtime gap.
- Confidence/freshness: high for code, low for real throughput until canary.
- Affected components: scheduler, worker, provider rate strategy.
- Status: corrected: accepted for Inngest execution only; cron can overlap a
  different job and remains blocked from live rollout by gap 010.
- Supersedes/superseded-by: corrected by
  `ADR-HRMNY-20260831-APOLLO-007`; none.
- Rollback/correction: pause intake or worker; increase concurrency only through
  a reviewed ADR backed by provider receipts.

## `TRADE-HRMNY-20260831-APOLLO-003` — bounded retention drain

- Decision/finding: the daily cleanup drains at most 20 batches of 500 and emits
  a backlog signal if the final batch is full.
- Reason: cleanup must be bounded so it cannot monopolize the application.
- Alternatives considered: unbounded delete loop; one batch with no backlog
  signal; manual cleanup.
- Trade-offs: a backlog over 10,000 rows may need multiple runs or an approved
  operational intervention.
- Evidence: cron route contracts; production scheduling gap.
- Confidence/freshness: high locally, unproven at production volume.
- Affected components: retention worker and observability.
- Status: implemented; production behavior open.
- Supersedes/superseded-by: none.
- Rollback/correction: disable cleanup, inspect counts read-only, then tune batch
  size through a reviewed change.

## `TRADE-HRMNY-20260831-APOLLO-004` — manual production promotion

- Decision/finding: 0075 does not auto-run on merge and requires exact inputs.
- Reason: backup ownership, target identity, and production authority require a
  human release checkpoint.
- Alternatives considered: automatic migration; unrestricted CLI invocation.
- Trade-offs: release is slower and depends on environment approval, while an
  unintended database mutation is less likely.
- Evidence: production workflow contract and `ADR-HRMNY-20260831-APOLLO-006`.
- Confidence/freshness: high for source; environment enforcement unverified.
- Affected components: GitHub Actions and Supabase production database.
- Status: accepted, unexecuted.
- Supersedes/superseded-by: none.
- Rollback/correction: cancel before apply on any ambiguity; require a new exact
  review for changed inputs.

## `TRADE-HRMNY-20260831-APOLLO-005` — fail closed on provider redirects

- Decision/finding: reject redirects on every credentialed Apollo request.
- Reason: credential containment outweighs transparent redirect compatibility.
- Alternatives considered: automatic redirect following; destination allowlist
  implemented inside this slice.
- Trade-offs: a provider infrastructure redirect produces an operator-visible
  failure and reconciliation work, but cannot silently carry the employee key.
- Evidence: commit `d66be9d` and adapter tests.
- Confidence/freshness: high locally.
- Affected components: Apollo adapter and retry classification.
- Status: accepted.
- Supersedes/superseded-by: none.
- Rollback/correction: add reviewed same-origin/manual redirect support only if
  official behavior requires it.

## `TRADE-HRMNY-20260831-APOLLO-006` — stacked CI proof dependency

- Decision/finding: inherit Phase 4c before the Apollo hosted proof.
- Reason: it owns the proven disposable-database SSL boundary and existing
  Sales proposal runtime proof.
- Alternatives considered: parallel sibling PRs with conflicting CI scripts;
  replace Phase 4c's proof.
- Trade-offs: landing order matters, while duplicated security policy and
  ambiguous hosted receipts are avoided.
- Evidence: PR #243, merge commit `a343a51`, and `ADR-HRMNY-20260831-APOLLO-009`.
- Confidence/freshness: high; hosted head not yet published.
- Affected components: review stack and CI database job.
- Status: accepted for this review slice.
- Supersedes/superseded-by: none.
- Rollback/correction: retarget only after the dependency lands or an equivalent
  reviewed commit becomes the base.
