# Runbooks

Common metadata for every record: 2026-09-02;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; actor `Codex /root`;
tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-4f-apollo-provider-slot-20260901`; implementation
commit `fc2d288074bc44624abbb9e701b5c5ffa7adb775`.

## `PROC-HRMNY-20260902-APOLLO-008` — review, migrate, deploy, and reopen free People Search

- Decision/finding: use four separate checkpoints: source acceptance,
  production migration, new-runtime deployment, and bounded provider/user
  acceptance. Never combine them into one success state.
- Reason: migration `0076` must see zero running work, and the old runtime must
  not reopen the lane after the schema changes.
- Alternatives considered: deploy and migrate automatically; rolling mixed
  runtime; reopen on healthy endpoint alone.
- Trade-offs: requires a maintenance window and multiple receipts.
- Evidence: `ADR-HRMNY-20260902-APOLLO-015` and the manual workflow.
- Confidence/freshness: high for procedure; not production-executed.
- Affected components: GitHub, Supabase/PostgreSQL, application runtime, Apollo,
  monitoring, and Sales users.
- Status: version 1, documented, unexecuted.
- Supersedes/superseded-by: none.
- Rollback/correction: stop at the current checkpoint, keep Apollo quiesced,
  preserve receipts, and correct forward under a new reviewed record.

### 1. Source acceptance

1. Confirm the stacked base and exact source head.
2. Pass both push and pull-request matrices, including disposable `db:verify`,
   migration application, and `test:ci:apollo-postgres`.
3. Pass preview build and security review. Keep the pull request open for human
   review; do not auto-merge.

### 2. Production migration checkpoint

1. Obtain separate approval for merge and the production maintenance window.
2. Drain and disable every old Apollo People Search worker; capture a
   quiescence receipt showing zero running jobs.
3. Verify backup/PITR and capture its receipt.
4. Run `HRMNY production migration 0076` only from the exact reviewed `main`
   SHA and the GitHub `Production` environment. Use the canonical project ref,
   verified-TLS direct/session port-5432 secret, both exact confirmation
   phrases, and receipt references.
5. Accept only exact journal, hash, schema, security, zero-running, backfill,
   and duplicate-slot readback. Keep Apollo closed after success.

### 3. New-runtime and recovery checkpoint

1. Drain old instances again and deploy only the reviewed new runtime.
2. Run synthetic concurrent cron/Inngest/employee jobs and forced worker/session
   loss. Verify one healthy provider lane, honest ambiguity, cleanup, alerting,
   and rollback.
3. Confirm direct Vault rotation uses the governed connection workflow so the
   `connection_account` version changes.
4. Do not reopen on migration or health alone.

### 4. Bounded live and user checkpoint

1. Obtain separate approval for one zero-credit Apollo People Search canary.
2. Use one named employee and one exact query; record request ID, provider
   response receipt, destination persistence, reconciliation, and no credit use.
3. Revoke and reconnect once, verify provider/destination readback, then perform
   named-user UAT.
4. Widen only after provider, destination, recovery, user, and production
   acceptance are each explicitly recorded.

### 5. Incident response

1. On duplicate-running, lock-loss, stale credential, or ambiguous-outcome
   alert, disable free People Search and keep existing receipts immutable.
2. Reconcile provider responses and CRM destination state by stable request ID.
3. Rotate credentials through the governed connection path if authentication is
   uncertain. Do not edit Vault alone.
4. Correct forward or restore under separate approval; never drop migration
   objects or erase ambiguity to make the dashboard appear healthy.
