# Runbooks

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
`41145c85e799f6b906dfca23a37aea0894cc9582`.

## `RUN-HRMNY-20260831-RESEARCH-001` — capture and approve sourced research

- Decision/finding: capture requires company, why-now evidence, and a plausible
  public HTTPS source; retain the returned proposal/request/receipt IDs. Gate 1
  is a later explicit decision and must stop on receipt, lineage, or identity
  conflict.
- Reason: preserve `command → evidence → decision → approved action → verified
  result → next owner`.
- Alternatives considered: auto-promote; repair missing records during approval.
- Trade-offs: manual review is required before person discovery.
- Evidence/tests: exact replay, mismatch, semantic reuse, receipt absence,
  identity conflict, and signal reconciliation fixtures.
- Prerequisites/permissions: provisioned Partner/Director/AM/Account Manager;
  no provider, credit, message, or production permission required.
- Confidence/freshness: high for the implementation commit.
- Affected components: Sales capture, Gate 1, CRM company/signal store.
- Status: active procedural record; last successful local execution 2026-08-31.
- Supersedes/superseded-by: none.
- Rollback/correction: never bypass an error; correct the proposal/source or
  resolve identity through a separately reviewed workflow.

## `RUN-HRMNY-20260831-RESEARCH-002` — correct or roll back the core slice

- Decision/finding: stop review on failed replay, receipt, identity, role,
  evidence, audit, or signal-count checks; correct forward on the feature
  branch or use a reviewed Git revert.
- Reason: rollback must not reintroduce mock research or silent CRM creation.
- Alternatives considered: edit deployed data/code directly; disable guards.
- Trade-offs: stacked review branches must preserve dependency order.
- Evidence/tests: compare to Phase 3 SHA `9b0a213...`, run focused/full/static/
  build/hosted gates, and retain negative receipts.
- Prerequisites/permissions: no automatic merge, production promotion,
  provider action, or destructive cleanup.
- Confidence/freshness: high.
- Affected components: core review branch and dependent UI/database proof.
- Status: documented, not invoked.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve `authorize → validate → apply → audit → emit`
  and never unlink or delete legacy data automatically.
