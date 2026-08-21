# Operational phase — live config

**Date:** 2026-08-21  
**Branch:** `ahmadbukhari097/functional-os-wire-a4e8`

## Verified locally

| Check | Result |
|-------|--------|
| DB (`scripts/check-db.mjs`) | up — 193 tables, 23 employees, 11 deals |
| Routes `/`, `/login`, `/crm`, `/finance`, `/people`, `/time`, `/delivery`, `/dashboards`, `/work`, `/clients`, `/billing`, `/payroll` | HTTP 200 |
| `GET /api/ready` | `ok:true`, `authMode:supabase`, `llmProvider:openrouter`, `xeroWriteEnabled:false` |
| Auth session (anonymous) | `authMode:supabase` (SSO required for staff) |

## Local env (gitignored)

Root + `apps/web/.env.local` synced. Modes: `AUTH_MODE=supabase`, `LLM_PROVIDER=openrouter`, `DAM_STORAGE=supabase`, `XERO_WRITE_ENABLED=false`.

## Still empty (non-blocking for daily OS)

Privileged OpenRouter · Xero live keys · `CRON_SECRET` · Apollo/Hunter · Upstash/Sentry

## Smoke after each deploy

```bash
curl -s "$URL/api/ready"
# expect {"ok":true,...,"xeroWriteEnabled":false}
```
