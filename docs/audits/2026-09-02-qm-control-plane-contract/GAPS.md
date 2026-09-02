# Gaps

## Blocking the next implementation state

1. Implement a durable PostgreSQL `QmControlRepository` adapter with an atomic uniqueness constraint on organization, employee, and request ID.
2. Implement the protected server adapter that derives `QmTrustedPrincipal` from the current HRMNY session; never accept it from a client body.
3. Implement resource-specific repository scope resolvers for work, CRM, and approved memory records.
4. Connect proposal records to the existing HRMNY preview, approval, effect-broker, verification, and immutable-receipt lifecycle.

## Blocking provider acceptance

1. Obtain named QM/Fly account ownership, billing boundary, region, retention, and network-isolation decisions.
2. Perform provider Phase Zero read-only inventory and record provider resource IDs and readback receipts.
3. Configure personal runtime isolation and stable private service discovery.
4. Prove that no raw production credential enters QM and that egress is bounded.

## Blocking production acceptance

1. Deploy a connected QM runtime and integration route to a named non-production destination and verify the exact revision there. The automatic Vercel web preview does not satisfy this gate.
2. Run synthetic canaries against the deployed durable adapter.
3. Obtain explicit approval before any connection-loss, process-termination, rollback, or recovery test.
4. Complete owner UAT, recovery acceptance, security review, merge review, and production acceptance as separate gates.

## Deliberately untouched

The worktree `hrmny-os-postgresjs-hardening-20260902` remains at `d949461bf0ab47f2f07978a6ebdd2d2e448000aa` with its existing user-owned changes to `package.json`, `pnpm-lock.yaml`, and `patches/`. This phase did not modify, install, test, commit, discard, or execute that work.
