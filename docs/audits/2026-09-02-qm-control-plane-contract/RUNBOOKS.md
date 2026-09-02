# Runbooks

## Next safe local phase: durable adapter

1. Start from this branch after review; do not merge automatically.
2. Draft the PostgreSQL tables, unique key, row-level ownership rules, and transaction contract as a separate migration proposal.
3. Review the migration and rollback plan before applying it anywhere.
4. Implement the adapter against an isolated synthetic database only.
5. Prove duplicate-request atomicity, revocation-before-replay, organization isolation, and receipt immutability.
6. Record the exact migration revision and database readback. Keep deployment, recovery, UAT, and production states open.

## Provider Phase Zero: read-only inventory

Requires explicit human approval and named account ownership.

1. Read account, organization, billing, region, network, app, machine, secret-name, and retention metadata without creating or changing resources.
2. Record resource identifiers and timestamps without exposing credential values.
3. Stop if account ownership, billing, privacy, or tenant-isolation requirements are ambiguous.
4. Produce a proposed configuration and cost envelope for separate approval.

## Provider connection and synthetic canary

Requires approved Phase Zero evidence and a non-production destination.

1. Create only the approved isolated resources.
2. Record stable private service discovery and provider readback receipts.
3. Connect a synthetic HRMNY principal and synthetic records only.
4. Verify precheck, proposal, approval handoff, and effect receipt without a live customer destination.
5. Disable the connection and prove the kill switch.

## Recovery canary

Requires a separate explicit approval because it may terminate a process, interrupt a connection, or change provider state.

1. Identify the exact non-production resource and rollback point.
2. Capture a healthy baseline and owner approval receipt.
3. Execute one bounded failure mode.
4. Measure detection, fail-closed behavior, recovery time, replay safety, and data integrity.
5. Restore the baseline and capture provider/database readback.

## Human gates

- PR review does not authorize merge.
- Merge does not authorize deployment.
- Deployment does not authorize provider use or destination delivery.
- Provider success does not authorize UAT acceptance.
- UAT does not authorize recovery testing or production acceptance.
