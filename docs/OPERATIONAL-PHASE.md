# Operational phase — live config

**Date:** 2026-08-21  
**Production:** https://hrmny-os.vercel.app · commit `ea9f4f0` (PR [#63](https://github.com/syedahmad0786/hrmny-os/pull/63))

## Production `/api/ready`

```json
{
  "ok": true,
  "authMode": "supabase",
  "llmProvider": "openrouter",
  "xeroWriteEnabled": false,
  "database": "up",
  "pgvector": true,
  "tools": {
    "composio": "configured",
    "apollo": "mock",
    "hunter": "mock",
    "n8n": "mock",
    "openrouter": "configured",
    "googleOAuth": "configured",
    "xero": "mock"
  }
}
```

## Live routes (HTTP 200 on prod)

`/login` · `/crm/hunt` · `/tasks` · `/chat` · `/tickets` · `/notifications` · `/creative` · `/approvals` · `/delivery`

Bundles prove: **Hunt clients**, **Hrmny** chat harness, QM attribution.

Anon users hit SSO / “Checking access…”. Full UI needs `@hrmny.co` Google Workspace.

## Tracking sheets

| Sheet | URL |
|-------|-----|
| Original checklist | https://docs.google.com/spreadsheets/d/118yT7_g0hG57zCkG62PACQIVuhocNkJNbq3fCwiKFf0 |
| Live test 2026-08-21 | https://docs.google.com/spreadsheets/d/107TARos-8OZ9r_PZNy6AzVZwDWWpQq93mksjHxphWoc |
| Checklist update note | https://docs.google.com/document/d/15IKlcFGMK30nKH8b8CXYfTvl07yWz5uObhrfenporfw |

## Demo closed loop (staff)

`/crm/hunt` → **Run demo closed loop** or **Closed loop via Apollo** seeds prospect → won → onboarding + creative task (Postgres).  
Apollo **Prospect with Apollo** writes durable CRM discover deals (same pipeline store).  
`/creative` → generate → **Attach & send to portal** lands an asset in `/portal/deliveries`.  
`/portal/onboarding` lets the client acknowledge the active phase.  
`/settings/ai` → custom agents **Run** on client/user/task memory sandbox (mock LLM if no OpenRouter credits).  
`/approvals` → outreach HITL: after approve, Gmail send uses live Composio→Gmail when connected (else stub); LinkedIn copy-draft.

## Still mock until keys

Apollo · Hunter · Xero · n8n — paste via Connections / Vercel env. Xero writes stay off.
