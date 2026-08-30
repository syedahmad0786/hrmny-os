# Failures

Common scope/date/actor for every record: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; supervisor
`Codex /root`; tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-2-portal-approval-boundary-20260830`; implementation
commit `b2fea0bc9ae94e38595841783e177065a9a378d7`.

## `FAIL-HRMNY-20260830-PORTAL-001` — middleware refinement did not propagate

- Decision/finding: the first web typecheck failed because the portal middleware
  non-null refinement was not reflected in the mutation callback type.
- Reason: `ctx.user` remained `SessionUser | null` to TypeScript even though the
  procedure middleware guarantees a portal user.
- Alternatives considered: weaken the service actor type; add another runtime
  branch inside the mutation.
- Trade-offs: the sole legitimate callsite uses a non-null assertion tied to
  the existing middleware contract.
- Evidence: compiler error at `m6-routers.ts`; subsequent focused and full
  typechecks passed after correction.
- Confidence/freshness: high.
- Affected components: portal approvals tRPC mutation.
- Status: corrected and retested.
- Supersedes/superseded-by: none.
- Rollback/correction: if middleware changes, replace the assertion with a
  typed narrowing middleware and retain the service-level validation.

## `FAIL-HRMNY-20260830-PORTAL-002` — Graphify command/path invocation errors

- Decision/finding: two Graphify refresh attempts used the wrong invocation
  shape/path; one later command produced an unintended duplicate output folder
  at the repository root.
- Reason: the version output was interpreted as a command, then the projection
  path and cluster target were supplied incorrectly.
- Alternatives considered: ignore the duplicate; delete broad generated paths.
- Trade-offs: the exact duplicate was inspected and removed with a scoped patch;
  the canonical run graph was preserved.
- Evidence: harness failure record, graph diagnostics, and clean tracked status.
- Confidence/freshness: high.
- Affected components: local harness/Graphify evidence only.
- Status: corrected; no provider, repository history, or production state was
  changed.
- Supersedes/superseded-by: none.
- Rollback/correction: always target the exact run directory and canonical
  `graphify-out/graph.json`; never run clustering at repository root.

## `FAIL-HRMNY-20260830-PORTAL-003` — local Windows browser body stall

- Decision/finding: the inherited local Next/Playwright environment can return
  headers without response body bytes and leave the UI on `Checking access…`.
- Reason: not yet isolated; this is the same preserved negative evidence from
  the preceding Sales slice.
- Alternatives considered: claim browser acceptance from the build; weaken UI
  assertions.
- Trade-offs: the new read-only browser check must be accepted on hosted Linux
  CI rather than locally.
- Evidence: prior local reproduction and `EVID-HRMNY-20260830-PORTAL-008`.
- Confidence/freshness: medium-high; current code was not reclassified as a
  browser pass.
- Affected components: local browser evidence only.
- Status: open tooling/runtime gap; hosted CI pending.
- Supersedes/superseded-by: inherited from `EVID-HRMNY-20260830-SALES-008`.
- Rollback/correction: block the PR if hosted Linux fails; investigate local
  server streaming separately.

## `FAIL-HRMNY-20260830-PORTAL-004` — prompt and wildcard authorization bypass

- Decision/finding: the first containment revision still let a paraphrase such
  as “Mark the client-review deliverable approved” reach write-capable tools
  through wildcard custom-agent execution; direct custom-agent Chat could also
  auto-execute configured tools.
- Reason: prompt classification and alias removal were treated as the boundary
  while the generic executor remained effect-capable.
- Alternatives considered: add more regex terms; remove only the reproduced
  alias.
- Trade-offs: remediation made generic client execution and client Chat
  structurally read-only and moved deliberate drafts behind typed wrappers.
- Evidence: independent reproduction, full-state/no-fetch adversarial tests,
  and clean reviewer replay.
- Confidence/freshness: high.
- Affected components: AI tools, custom agents, Chat, client-scoped writes.
- Status: corrected and independently retested; no P0/P1 remains from this
  pathway.
- Supersedes/superseded-by: none.
- Rollback/correction: never restore wildcard/model-selected client effects;
  add exact typed commands instead.

## `FAIL-HRMNY-20260830-PORTAL-005` — campaign state could outrun its evidence

- Decision/finding: intermediate revisions failed exact replay, retained state
  after injected audit failure, allowed contradictory concurrent approve/reject
  outcomes, and later used whole-array rollback that could erase a different
  item's successful audit/outbox.
- Reason: state, attribution, and projection intent were not one atomic unit;
  per-item locking could not protect shared global arrays.
- Alternatives considered: caller-side serialization; recreate missing audit
  IDs on replay; globally restore snapshots.
- Trade-offs: remediation added locked PostgreSQL transaction semantics and
  local staging with synchronous publication; legacy unattributed states fail
  closed.
- Evidence: injected audit/projector failures, exact replay/conflict tests,
  same-item concurrency, deterministic cross-item failure reproduction, and
  independent clean replay.
- Confidence/freshness: high in memory mode; PostgreSQL integration gap remains.
- Affected components: campaign decision, audit, seam outbox, feedback and
  notification projection.
- Status: corrected and independently retested; no P0/P1 remains from this
  pathway.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve state-plus-receipt atomicity and rerun all
  adversarial cases after any repository change.

## `FAIL-HRMNY-20260830-PORTAL-006` — hardening test maintenance failures

- Decision/finding: one mechanical wrapper migration touched read calls and a
  mixed-case tool missed the lowercase allowlist; later assertions counted
  audits from prior seeded state, and a mutable callback value required an
  explicit staged transaction object for TypeScript narrowing.
- Reason: broad test-call replacement and global fixture counts obscured the
  exact behavior under test.
- Alternatives considered: weaken assertions; suppress type errors.
- Trade-offs: tests now target exact IDs/receipts and typed wrappers explicitly.
- Evidence: failing focused/typecheck receipts followed by green reruns.
- Confidence/freshness: high.
- Affected components: tests and local transaction staging types only.
- Status: corrected and retested.
- Supersedes/superseded-by: none.
- Rollback/correction: keep exact object-scoped assertions and rerun focused
  gates before repository-wide verification.
