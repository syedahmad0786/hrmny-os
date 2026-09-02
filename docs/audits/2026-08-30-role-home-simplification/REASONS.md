# Reasons

Common scope/date/actor: 2026-08-30; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; `Codex /root`; exact model ID not exposed; branch
`ahmadbukhari097/codex/phase-3-role-home-20260830`; commit
`cde54907048f43d5bc7717e24e0d50b66f1768a7`.

## `RSN-HRMNY-20260830-ROLE-001` — owned work before module inventory

- Decision/finding: role home follows `command → owned work → evidence →
decision → approved action → verified result → next owner`.
- Reason: employees need a next action and handoff, not a directory of system
  objects.
- Alternatives considered: retain three generic job cards; build separate
  dashboards for every role immediately.
- Trade-offs: this bounded slice shares one governed component before named
  users validate role-specific depth.
- Evidence: implementation and role policy tests in `EVID-...-ROLE-001/002`.
- Confidence/freshness: high for the design boundary; medium for daily-job
  wording until named-user UAT.
- Affected components: home information hierarchy and action ordering.
- Status: applied; user acceptance remains open.
- Supersedes/superseded-by: none.
- Rollback/correction: revise role profiles without broadening data queries.

## `RSN-HRMNY-20260830-ROLE-002` — preserve legacy reachability

- Decision/finding: prioritize three to five role areas and retain every other
  enabled area under **More**.
- Reason: route deletion is unsafe without inventory, dependency, migration,
  rollback, and approval evidence.
- Alternatives considered: delete duplicate/advanced routes now; retain the
  previous flat ten-item navigation.
- Trade-offs: known taxonomy duplication remains visible in the gap register.
- Evidence: navigation reachability tests and `GAP-HRMNY-20260830-ROLE-003`.
- Confidence/freshness: high.
- Affected components: staff shell, legacy routes, feature catalog.
- Status: applied.
- Supersedes/superseded-by: none.
- Rollback/correction: any removal requires a separately approved route/data
  migration plan.
