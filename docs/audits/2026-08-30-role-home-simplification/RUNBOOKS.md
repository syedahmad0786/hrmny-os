# Runbooks

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; exact model ID not exposed; branch
`ahmadbukhari097/codex/phase-3-role-home-20260830`; commit
`cde54907048f43d5bc7717e24e0d50b66f1768a7`.

## `RUN-HRMNY-20260830-ROLE-001` — review a role-policy change

- Decision/finding: change role aliases, priorities, paths, and placement only
  in the pure workspace policy; never add authorization there.
- Reason: keep presentation changes bounded, deterministic, and testable.
- Alternatives considered: scatter role checks across pages or CSS.
- Trade-offs: new role behavior requires explicit matrix updates.
- Evidence/tests: run role policy, session capability, work router, full suite,
  lint, typecheck, build, and all Playwright role journeys.
- Prerequisites/permissions: review current canonical roles and exact feature
  keys; no provider or production access required.
- Confidence/freshness: high for this implementation commit.
- Affected components: workspace policy, staff shell, home.
- Status: active procedural record; last successful local execution 2026-08-30.
- Supersedes/superseded-by: none.
- Rollback/correction: revert the policy change, rerun the same gates, and
  retain server-side permission/capability checks.

## `RUN-HRMNY-20260830-ROLE-002` — rollback or correct the slice

- Decision/finding: stop before merge/promotion on any data-scope, capability,
  route-reachability, browser, or regression failure; correct forward on the
  feature branch or use a reviewed Git revert.
- Reason: presentation rollback must never reintroduce organization-wide home
  data, hidden-as-zero blockers, or client-preview privilege.
- Alternatives considered: edit production directly; disable checks.
- Trade-offs: stacked dependencies require preserving Phase 2 history.
- Evidence/tests: compare to `037ada23...`, confirm `.system-harness/` remains
  excluded, run diff check and all gates, then obtain a new preview receipt.
- Prerequisites/permissions: no automatic merge or production promotion;
  production rollback would require a separate human checkpoint.
- Confidence/freshness: high.
- Affected components: PR #240 and its Phase 2 base.
- Status: documented, not invoked.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve `authorize → validate → apply → audit → emit`
  and server authority in every correction.
