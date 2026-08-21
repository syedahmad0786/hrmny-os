# Env fill status — what we already have vs what you paste next

**Updated:** 2026-08-21 (production ship PR #63 · `ea9f4f0` on https://hrmny-os.vercel.app)

## Live now (production `/api/ready`)

`database:up` · `pgvector:true` · `authMode:supabase` · `llmProvider:openrouter` · `xeroWriteEnabled:false`

| Tool | Status |
|------|--------|
| Composio / Google OAuth / OpenRouter | **configured** |
| Apollo / Hunter / Xero / n8n | **mock** until API keys pasted |

## Shipped on prod (2026-08-21)

Ops command home · `/crm/hunt` · `/tasks` · Hrmny `/chat` · `/tickets` · `/notifications` · creative image gen · agent CRUD · Composio reconnect.

Live evidence sheet: https://docs.google.com/spreadsheets/d/107TARos-8OZ9r_PZNy6AzVZwDWWpQq93mksjHxphWoc

## Access reality check

| Source | Status |
|--------|--------|
| Live prod `hrmny-os.vercel.app` | **Updated** via main merge #63 |
| Local `.env.local` (user-filled) | Used for local/dev |
| Vercel MCP | Personal team only — prod deploy went through GitHub → hrmnyco |

---

## Paste next for full live tools

| Env var | Where |
|---------|--------|
| `APOLLO_API_KEY` | Connections vault or Vercel env |
| `HUNTER_API_KEY` | Connections vault or Vercel env |
| `XERO_CLIENT_ID` + `XERO_CLIENT_SECRET` | Vercel env (writes stay off) |
| `OPENROUTER_PRIVILEGED_API_KEY` | Optional salaries workspace |
| `CRON_SECRET` | Vercel hrmny-os env |
