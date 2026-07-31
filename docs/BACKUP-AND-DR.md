# Backup & disaster recovery (DB-5)

**Owner:** Eng + Ops  
**Target:** Daily backups, RTO &lt; 24h, verified restore path before cutover.

## Production data plane

| Store | Product | Notes |
|-------|---------|-------|
| Primary DB | Supabase Postgres | Canonical CRM / Work / Finance / memory_chunk |
| Object storage | Supabase Storage (`hrmny-dam`) | DAM binaries; set `DAM_STORAGE=supabase` |
| Auth | Supabase Auth | Staff SSO + portal magic-link |
| Secrets | Keeper → Vercel env | Never in git |

## Daily backup (required)

1. **Supabase managed backups** — enable Point-in-Time Recovery (PITR) on the paid plan for the production project. Free-tier daily backups alone are insufficient for RTO &lt; 24h with confidence.
2. **Logical dump (belt + suspenders)** — schedule a daily `pg_dump` of the production database into an off-platform object bucket (e.g. S3 / GCS) with 30-day retention:

```bash
# Run from a locked-down ops runner with DIRECT_URL (session mode, not pooler)
pg_dump "$DIRECT_URL" \
  --format=custom \
  --no-owner \
  --file="hrmny-os-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

3. **Vercel** — keep at least one known-good deployment pin for rollback (CUTOVER checklist item 10).

## Restore drill (must pass before go-live)

| Step | Action | Pass criteria |
|------|--------|---------------|
| 1 | Provision a throwaway Supabase project or local Postgres | Empty DB |
| 2 | `pg_restore --clean --if-exists` of yesterday’s dump | Completes with 0 fatal errors |
| 3 | Apply any migrations newer than the dump (`packages/db/APPLY.md`) | Journal catches up |
| 4 | Point a preview Vercel deploy at the restore DB | `/login` + partner smoke of CRM/Work/Money |
| 5 | Confirm `memory_chunk` + `invoice` row counts ≈ production snapshot | Within documented tolerance |
| 6 | Record evidence (date, operator, dump filename, pass/fail) in the ops log | Attached to cutover pack |

**RTO budget:** restore DB ≤ 4h · re-point app ≤ 1h · smoke ≤ 2h · buffer → **&lt; 24h**.

## Rollback

1. Redeploy previous known-good Vercel deployment.  
2. If schema migration caused the incident and is not backward compatible, restore DB from the pre-migration dump (do not “fix forward” with destructive data loss without partner sign-off).  
3. Rotate any leaked credentials (see `docs/CREDENTIALS-NEEDED.md`).

## What this runbook does *not* cover yet

- Automated restore CI (recommended follow-up)  
- Multi-region failover (Singapore residency accepted for V1)  
- Bayzat / Xero external system restores (those vendors own their DR)

## Cutover gate

CUTOVER.md item 9 remains ☐ until a restore drill has a dated pass record. This document is the procedure; evidence must be attached separately.
