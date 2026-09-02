# Gaps

## Blocking route activation

1. HRMNY must define the trusted organization UUID/source; it cannot come from a command body, browser session response, `clientId`, or chat thread.
2. Add a default-denied durable `qm:use` permission and explicit feature mapping.
3. Preserve verified Supabase authentication provenance at the resolver seam; current `SessionUser` does not distinguish verified production identity from permitted development auth.
4. Add resource-specific ownership resolvers for work, CRM, and approved-memory reads. A stored precheck is not data access.

## Blocking actionable approval

1. Add a server-owned canonical `previewRef` and resolver, lock the exact preview/version, recompute its digest, and bind the approval display to that artifact.
2. Add the QM proposal to a presentation-only approval query without reusing current handlers that immediately send or publish.
3. Record a separate immutable approval decision before any effect intent is created.
4. Do not add an effect outbox or executor until the preview, approver, permission, expiry, destination, and readback contracts are accepted.

## Blocking provider and production acceptance

1. Named QM/Fly account owner, billing boundary, region, retention, network, secret-custody, and recovery decisions.
2. Provider Phase Zero read-only inventory and stable resource/readback receipts.
3. Connected non-production deployment, synthetic canary, reconciliation, and approved recovery test.
4. Security review, owner UAT, merge review, and production acceptance as separate decisions.

## Deliberately skipped

The PostgreSQL socket-hardening Phase 4G worktree remains untouched. Its package, lockfile, and patch changes were neither installed, tested, committed, discarded, nor used by this phase.
