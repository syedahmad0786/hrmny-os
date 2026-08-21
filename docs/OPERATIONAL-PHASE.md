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

## Preview deploy (this branch)

| Target | Status | URL |
|--------|--------|-----|
| Vercel `hrmnyco/hrmny-os` | Ready | [branch preview](https://hrmny-os-git-ahmadbukhari097-functional-os-wire-a4e8-hrmnyco.vercel.app) |
| Deployment | Ready | https://hrmny-k5iatp1z5-hrmnyco.vercel.app |

Open while signed into Vercel (deployment protection SSO). Prod `https://hrmny-os.vercel.app` updates only after merge.

## Smoke after each deploy

```bash
curl -s "$URL/api/ready"
# expect {"ok":true,...,"xeroWriteEnabled":false}
```

Browser: login → People / Time / Finance / Clients / Delivery / Dashboards.
