# Runbooks

## Safe activation order

1. Review and apply migration 0077 in an approved non-production database.
2. Read back both tables, named constraints/indexes, append-only trigger, RLS state, and browser-role revocations.
3. Configure one trusted organization UUID from a reviewed server-owned source.
4. Add and verify the default-denied `qm:use` permission and feature mapping.
5. Construct the principal only inside the authenticated `staffProcedure` seam.
6. Start with a named local-synthetic session binding and run replay, cross-owner, stale-policy, and immutability canaries.
7. Keep proposals non-actionable until exact preview and approval receipts are implemented.

## Forward-safe rollback

Disable the route/adapter and preserve the immutable decision ledger. Do not drop or rewrite decision rows. Suspend or revoke session bindings with a new state version, verify that stale decisions fail, and record the rollback receipt. A provider rollback, connection-loss test, or database restore requires a separately approved recovery window.

## Acceptance boundary

Code review, disposable database verification, preview deployment, provider connection, recovery, UAT, merge, and production acceptance are separate states. One passing state must not be reported as another.
