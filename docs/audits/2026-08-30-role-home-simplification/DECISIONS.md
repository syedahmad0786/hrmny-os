# Decisions

Common scope/date/actor for every record: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; supervisor
`Codex /root`; tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-3-role-home-20260830`; implementation commit
`cde54907048f43d5bc7717e24e0d50b66f1768a7`.

## `ADR-HRMNY-20260830-ROLE-001` — role policy is presentation only

- Decision/finding: deterministic role profiles may prioritize enabled routes
  and home copy, but they never grant access or replace server authorization.
- Reason: navigation convenience must not become a second permission system.
- Alternatives considered: encode permissions in the UI role map; expose every
  module in one fixed navigation list.
- Trade-offs: the UI can hide an enabled route when its exact server capability
  is absent, and server denial remains the final boundary.
- Evidence: `EVID-HRMNY-20260830-ROLE-001`, `-002`, and `-004`.
- Confidence/freshness: high; reviewed against the implementation commit.
- Affected components: staff shell, role workspace policy, auth session.
- Status: implemented and locally tested; merge/production pending.
- Supersedes/superseded-by: refines the fixed module navigation; none.
- Rollback/correction: preserve server checks and revert only the presentation
  policy through the reviewed rollback runbook.

## `ADR-HRMNY-20260830-ROLE-002` — personal home uses scoped Work signals

- Decision/finding: staff home reads only `work.personal.myTasks` and
  `work.personal.inbox`; organization-wide operating totals are excluded.
- Reason: an employee landing page must show owned work, decisions, blockers,
  evidence, and next handoff without disclosing unrelated operations.
- Alternatives considered: retain `ops.overview`; create a new summary store;
  infer ownership in the browser.
- Trade-offs: global operating health remains available in authorized
  dashboards rather than on every employee's home.
- Evidence: `EVID-HRMNY-20260830-ROLE-001`, `-002`, and `-003`.
- Confidence/freshness: high for scoped source behavior.
- Affected components: staff home, My Tasks query, personal inbox.
- Status: implemented and locally tested.
- Supersedes/superseded-by: supersedes the organization-wide home metrics;
  none.
- Rollback/correction: do not restore global data to personal home without a
  reviewed data-exposure decision.

## `ADR-HRMNY-20260830-ROLE-003` — one primary action with fixed disclosure

- Decision/finding: `Open My Tasks` is the sole primary action when available;
  two role-relevant lanes may support it, and remaining enabled areas stay
  under **More**. The global approval queue is permanently a **More** action.
- Reason: routine work needs an obvious start while global decision inventory
  must not be mistaken for personally owned approvals.
- Alternatives considered: promote the first enabled lane; remove legacy
  routes; keep ten equal-priority navigation items.
- Trade-offs: some experienced users make one extra interaction to reach an
  advanced area, but every enabled route remains reachable.
- Evidence: `EVID-HRMNY-20260830-ROLE-002` and `-004`.
- Confidence/freshness: high; the partial-feature case has a regression test.
- Affected components: staff home action policy and staff shell navigation.
- Status: implemented and locally tested.
- Supersedes/superseded-by: none.
- Rollback/correction: change placement only through the pure policy and its
  role/feature test matrix.

## `ADR-HRMNY-20260830-ROLE-004` — dependency state fails closed per client

- Decision/finding: resolve `work.dependencies` from one override snapshot for
  each selected project/client; return `null` and display visibility
  unavailable when the dependency feature is not permitted.
- Reason: hidden blocker information must never be represented as zero.
- Alternatives considered: use organization-only feature state; omit blockers;
  return zero when unavailable.
- Trade-offs: the aggregate blocker total is withheld if any visible task has
  incomplete dependency visibility.
- Evidence: `EVID-HRMNY-20260830-ROLE-002` and independent review `-004`.
- Confidence/freshness: high for memory/database query contracts; hosted
  provider behavior is outside this slice.
- Affected components: My Tasks memory/database paths, role home metrics.
- Status: implemented and locally tested.
- Supersedes/superseded-by: corrects the first intermediate role slice; none.
- Rollback/correction: preserve nullable fail-closed semantics in any forward
  query optimization.
