# Staging go-live checklist (remaining external gates)

In-repo production-readiness work for the current branch is complete
(see PR / `docs/PLAN-PRODUCTION.md`). This checklist is what humans must still do
with real credentials and staging access.

## 1. Database

- [ ] Supabase staging project linked (`npx supabase link`)
- [ ] Extension `vector` enabled
- [ ] `pnpm db:migrate` against staging (`DIRECT_URL`)
- [ ] Run `pnpm db:verify` against disposable local Supabase PostgreSQL
- [ ] Confirm the target journal includes **0066–0070**
- [ ] Optional: seed staging only (`packages/db/seed/*`) — never production

Details: `packages/db/APPLY.md`

## 2. App env (Vercel staging)

Copy from `.env.example`. Minimum for a real staging smoke:

| Variable | Purpose |
|----------|---------|
| `AUTH_MODE=supabase` | Live SSO + edge redirect |
| `DATABASE_URL` / `DIRECT_URL` | Postgres (fail-loud if missing) |
| `NEXT_PUBLIC_SUPABASE_URL` + publishable key | Browser auth |
| `SUPABASE_SECRET_KEY` | Server storage / admin |
| `NEXT_PUBLIC_APP_URL` | Canonical staging URL |
| `OPENAI_API_KEY` | Embeddings for `memory_chunk` |
| `OPENROUTER_API_KEY` + `LLM_PROVIDER=openrouter` | Live agents (else mock) |
| `COMPOSIO_API_KEY` | Real tool connections / send-after-approve |
| `CRON_SECRET` | `/api/cron/jobs` |

Full list: `docs/CREDENTIALS-NEEDED.md`

## 3. Backup / DR

- [ ] Follow `docs/BACKUP-AND-DR.md`
- [ ] Run one restore drill and attach dated evidence
- [ ] Tick CUTOVER.md item 9 only after the drill passes

## 4. Smoke (invite-only)

With a partner SSO account on staging:

1. `/` shows **Your queue today** (not brand orbit)  
2. `/crm` — create deal, filter by lane (labeled selects)  
3. `/finance` — intake propose → approve (persists after redeploy)  
4. `/work` + `/delivery` — tasks survive restart  
5. Theme toggle light/dark (sidebar stays charcoal)  
6. Sign out → middleware sends anonymous users to `/login`

## 5. Accessibility

Local axe CI covers primary routes (`e2e/a11y-scan.spec.ts`). Optional:
re-run BrowserStack `startAccessibilityScan` once MCP credentials are valid.

## 6. Meeting pack (optional)

Authenticate Notion MCP, then use meeting-intelligence to create:

- Internal pre-read: staging go / no-go  
- Agenda: migration apply + UAT cohort  

## Done when

Staging smoke passes for the flows above, migration `0070` and CUTOVER #1/#9 have evidence,
and partners schedule Dubai UAT.
