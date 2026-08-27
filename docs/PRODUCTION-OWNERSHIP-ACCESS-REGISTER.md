# Production ownership and access register

**Purpose:** Named owners, consoles, and acceptance steps for every live connection.  
**Rule:** never paste secret values into this file, chat, git, or email. Store values in Keeper folder `hrmny-os / production` (or Vercel encrypted env) and reply “done” per line.

**Companions:** [CREDENTIALS-NEEDED.md](./CREDENTIALS-NEEDED.md) · [BUILD-ACCESS-INVENTORY.md](./BUILD-ACCESS-INVENTORY.md) · [audits/2026-08-27-os-completion/HUMAN-GATES.md](./audits/2026-08-27-os-completion/HUMAN-GATES.md)

**Client locks (do not change without a new scoped engagement):**

- `XERO_WRITE_ENABLED=false`
- `LLM_PROVIDER=mock` in this repo / CI until Phase 0 activation is approved
- `DAM_STORAGE=memory` until Supabase Storage go-live is approved

---

## How a connection is accepted

1. Owner creates the provider app / key in the named console.
2. Callback / webhook URLs from the bridge sheet are registered (no secrets in the ticket).
3. Secret reference is stored in Keeper, then pasted into Vercel Production + Preview (and local `.env.local` if needed).
4. Operator runs the verification step and records date + person (not the secret).
5. OS Connections UI (or `/api/ready`) shows configured — not mock — for that tool.

---

## Ownership matrix

| Platform | Canonical owner | Resource | Console | Status |
|---|---|---|---|---|
| GitHub | `syedahmad0786` | `hrmny-os` | github.com/syedahmad0786/hrmny-os | have |
| Vercel | developer@hrmny.co team | project `hrmny-os` · `prj_w1fqlkGdhZcjVquTD5cDTJqxVVbt` · team `team_1JFUzpwQIfMIYzFhsmVaBatl` | vercel.com | have URL; MCP cannot manage this team |
| Supabase | developer@hrmny.co org | ref `klrugedztqxlvyghyzxs` · ap-southeast-1 | supabase.com/dashboard/project/klrugedztqxlvyghyzxs | partial |
| Google Workspace SSO | developer@hrmny.co | `@hrmny.co` OAuth client | Google Cloud + Supabase Auth | need first-login UAT |
| Xero | finance owner (unnamed) | read/mirror tenant | developer.xero.com | need app + tenant auth |
| OpenRouter general | TBD workspace A | day-to-day agents | openrouter.ai | need |
| OpenRouter privileged | TBD workspace B | salaries / finance LLM only | openrouter.ai | need |
| Apollo | sales owner | people/company API | app.apollo.io | deferred / need for M8 |
| Hunter | sales owner | Email Verifier credits | hunter.io | deferred; account previously dead |
| NeverBounce | sales owner | single/check credits | app.neverbounce.com | deferred |
| Composio | TBD | Gmail / Canva / LinkedIn / Asana | app.composio.dev | deferred |
| n8n Cloud | hrmny | `hrmny.app.n8n.cloud` | n8n Cloud settings | need API key |
| Inngest | TBD | durable AI pipelines | app.inngest.com | deferred (cron substitute lives) |
| Resend | TBD | portal / report mail | resend.com | deferred |
| Sentry | TBD | prod DSN | sentry.io | deferred |
| Upstash | TBD | Redis REST | console.upstash.com | deferred |
| Keeper | vault owners | `hrmny-os / production` | Keeper | need |
| Google Chat | ops | health alerts | Chat space → webhooks | rotate (previous value leaked) |

Fill names (not secrets) below when known:

| Item | Value | Owner |
|------|-------|-------|
| Xero organisation / tenant name | | |
| Who authorises the Xero tenant | | |
| OpenRouter workspace A name | | |
| OpenRouter workspace B name | | |
| Google OAuth client display name | | |
| Cron secret rotation owner | | |
| Vercel production deploy owner | | |
