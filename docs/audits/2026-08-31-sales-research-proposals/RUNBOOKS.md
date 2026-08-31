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

## `RUN-HRMNY-20260831-RESEARCH-003` — execute the disposable PostgreSQL proof

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; branch
  `ahmadbukhari097/codex/phase-4c-sales-postgres-proof-20260831`; commit
  `8e4b8ba118e9bf5f33dc6f28c49edec38d7cc4f7`.
- Decision/finding: run only in CI with `CI=true`, the explicit write gate, and
  a database hostname in the local allowlist; `HRMNY_DATABASE_SSL_MODE=disable`
  is accepted only under that complete tuple. Apply migrations before the
  separate-process concurrency tests; every other DB connection requires TLS.
- Reason: prove database behavior without risking an external or production
  resource.
- Alternatives considered: use a shared database; omit migrations; simulate
  concurrency in one process.
- Trade-offs: the proof is CI-specific and costs an additional database job.
- Evidence/tests: exact replay, payload mismatch, and concurrent Gate 1 tests;
  all provider modes mock/off; network fetch forbidden; Xero writes false.
- Prerequisites/permissions: ephemeral CI service only; no production, provider,
  billing, or human credential required.
- Confidence/freshness: high for the committed procedure; first success pending.
- Affected components: GitHub Actions database job and Sales store.
- Status: active procedural record; not yet successfully executed.
- Supersedes/superseded-by: none.
- Rollback/correction: fail closed on any guard mismatch and remove the service
  with the CI job lifecycle.
