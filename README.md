# hrmny OS

Single-tenant internal OS for Creative Harmony / hrmny (Dubai).

Execution source of truth: `../hrmny_OS_Execution/00-MASTER-BUILD-SPEC.md`.

## Monorepo

```
hrmny-os/
├── apps/web              # Next.js 15 App Router (staff + /portal)
├── packages/db           # Drizzle schema, migrations, RLS, RBAC helpers
├── packages/gate         # authorize → validate → apply → audit → emit
├── packages/integrations # ObjectStore + Xero / Bayzat / Composio adapters
├── packages/ai           # LLMProvider + invoice extract mock
└── packages/ui           # tokens + primitives
```

## Prerequisites

- Node.js **22.x** preferred (`.nvmrc`); `>=22` OK
- pnpm **9.15.x** (`packageManager` / Corepack)

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
```

## Setup

```bash
cd hrmny-os
cp .env.example .env.local
cp apps/web/.env.example apps/web/.env.local
pnpm install
```

### Env (M1–M6)

| Variable | Required for | Notes |
|---|---|---|
| `AUTH_MODE` | Auth | `dev` (default) uses `x-dev-role` personas; `supabase` when project exists |
| `NEXT_PUBLIC_SUPABASE_URL` | Live auth/storage | Leave empty for memory/dev demo |
| `XERO_MODE` | Finance post | `mock` (default) or `live` — live without keys **fails loud** |
| `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` | Live Xero | Only when `XERO_MODE=live` |
| `APOLLO_MODE` / `APOLLO_API_KEY` | Email enrich | `mock` default; `live` fails loud without key |
| `HUNTER_MODE` / `HUNTER_API_KEY` | Email verify | `mock` default; waterfall half-2 |
| `BAYZAT_SOURCE` | HR mirror | `csv` (default fallback) or `api` |
| `BAYZAT_API_KEY` | Bayzat API | Required if `BAYZAT_SOURCE=api` without seed |
| `LLM_PROVIDER` | Invoice intake | `mock` (default without keys) returns structured propose payload |
| `DATABASE_URL` / `DIRECT_URL` | Migrations | See `packages/db/APPLY.md` |
| `COMPOSIO_API_KEY` | Live OAuth | Stub redirects / stub send without it |
| `GOOGLE_CHAT_WEBHOOK_URL` | Health / HR escalate notify | Stub records signal if unset |

## Apply DB (Supabase)

Full steps: **`packages/db/APPLY.md`**.

Without a live project, leave `DATABASE_URL` empty — the app uses an in-memory store so demos and tests still run.

## Run locally

```bash
pnpm dev          # http://localhost:3000
pnpm typecheck
pnpm test         # gate + RBAC + M1–M6 demo caller tests
```

### M1 demo script (MASTER §12.1)

1. Open `/` — staff shell with Dev role switcher.
2. **Gate:** `/gate` — illegal `→ close` → `GATE_BLOCKED`; `discover → qualify` → audit id.
3. **Audit:** `/admin/audit` (as partner) — see `deal.transition` before/after.
4. **AM margin deny:** Dev role AM → `/roles` — no `marginPct`; `deals.margin` → FORBIDDEN.
5. **DAM:** `/assets` — create + upload + signed URL.
6. **Connections:** `/settings/connections` — Composio OAuth stubs.

### M2 demo script (MASTER §12.2)

1. **Invoice intake:** `/finance` (role **finance**) → Intake → Approve proposal → Approve invoice → Post to Xero. Expect `mock-xero-inv-*` and source attached on audit.
2. **Unknown TRN:** body hint containing `unknown TRN` → approve ok, **post blocked** (never guessed).
3. **HR spawn:** `/hr` (role **hr**) → Accept offer → lifecycle `hire_packet` + bundle flag.
4. **Escalation:** Run escalation job → in-app escalation + `hr_escalation` health signal.
5. **Bayzat CSV:** paste/import CSV on `/hr` → mirror rows; OS never writes Bayzat master.

### M3 demo script (MASTER §12.3)

1. **BUAF:** `/sales` → open Demo Co → uncheck Fit → Score BUAF → Advance to engage → `GATE_BLOCKED`.
2. **Verify email:** check all four BUAF → Hot → Verify waterfall (Apollo→Hunter mock) → Voice check → advance to scope.
3. **Outreach HITL:** Queue draft → `/sales/outreach` → Approve & stub-send (audit; no auto-send).
4. **Quote floor:** advance to `price_cost` → build thin-margin quote → Advance to close → `OVERRIDE_REQUIRED` until partner override reason.
5. **Won→Handover:** healthy quote → Close won → Fire Handover Pack → client + 7-phase onboarding → `/clients/{id}` Immersion form.

Dev personas: `partner`, `am`, `finance`, `hr`, `director` (header `x-dev-role`).

### M4 demo script (MASTER §12.4)

1. **DoR block:** `/traffic` → Reset M4 → Try lock with sparse brief → blocked (&gt;2 missing). Fill ≤2 missing → lock → `brief_ready`.
2. **QC gate:** `/creative` (role **creative_director**) → Advance to client_review → `task.creative_qc` block → QC pass → client_review OK.
3. **T-48h:** `/account` → Change shoot → blocked; Re-eval with pending ref → T-24 escalate; Reschedule edge allows date change.
4. **Task board:** `/delivery` — 11-state columns without Asana.
5. **Canva:** `/settings/connections` → Connect Canva stub → List designs smoke.

Dev personas add: `traffic`, `creative_director`.

## What ships in M2

- `@hrmny/integrations` Xero mock + live fail-loud factory; Bayzat CSV parse + adapter
- `@hrmny/ai` mock `LLMProvider` structured invoice propose payload
- Gate sets: `invoice`, `employee` (9-phase), `payroll_run` SoD scaffolding
- tRPC: `invoices.*`, `employees.*`, `requisitions.*`, thin `payroll.runs.*`
- UI: `/finance`, `/hr`
- Tests: propose-approve-post, TRN hold, Bayzat CSV, HR phase gates, payroll SoD

## What ships in M3

- Deal gates G1–G6: BUAF, verified-email, voice, margin floor, discount tiers, vendor fee 20%
- Apollo / Hunter mock + live interfaces; Composio stub send after HITL
- tRPC: `deals.*`, `scopes.*`, `outreach.*`, `leads.*`, `clients.*` (immersion/onboarding)
- UI: `/sales`, `/sales/[id]`, `/sales/outreach`, `/sales/inbound`, `/clients/[id]`
- Tests: BUAF block, email verify, margin override, won→handover, HITL idempotent send

## What ships in M4

- Gate: task 11-state + QC@5, DoR Form 2 (≤2 missing), T-48h / T-24h shoot lock
- tRPC: `calendars.*`, `briefs.*`, `tasks.*`, `dashboards.capacity/delivery`, `clients.month1.*`, `m4.reset`
- UI: `/delivery`, `/traffic`, `/creative`, `/account`, Canva toolkit on Connections
- Tests: DoR block/lock, QC gate, T-48h + reschedule, Canva stub

### M5 demo script (MASTER §12.5)

1. **Retainer draft:** `/billing` → Reset M5 → Auto-draft retainers → Approve → Post to Xero → Webhook paid. Expect `mock-xero-inv-*`.
2. **Margin dashboard:** role **partner** or **finance** → `/margin` — per-client margin + over-servicing. Role **am** → FORBIDDEN (no margin in payload).
3. **Payroll:** `/payroll` → role **hr** Draft + Confirm → role **director** (or partner) Approve → Post Xero JE. `disbursed` stays false.
4. **SoD:** same HR cannot approve; **Try disburse** must fail (`payroll.never_disburse`).

## What ships in M5

- Retainer / progress / first invoice drafts (VAT 5%) + month-start batch + paid webhook stub
- Margin engine (`dashboards.margin.*`) — partners/finance only; AM FORBIDDEN
- Payroll full loop: Bayzat lines → HR confirm → Director approve → Xero JE (**never disburse**)
- VAT Module F: unread docs block close; quarterly prepare + Director sign
- Gate: `vat_period` unread-docs; payroll SoD enforced end-to-end
- UI: `/billing`, `/payroll`, `/margin`
- Tests: retainer path, AM margin deny, payroll SoD + never-disburse, VAT close

### M6 demo script (MASTER §12.6)

1. **Portal scope:** `/portal` → Dev persona **portal_a** → Reset M6 → see Demo Co briefs/tasks/assets/status only.
2. **Isolation:** switch to **portal_b** → only Other Co rows; no Demo Co titles.
3. **No finance:** as portal_a, staff calls to `/margin`, invoices, payroll APIs return FORBIDDEN (network tab).
4. **Seam brief.lock:** staff **traffic** → `/traffic` → fill DoR → lock → seam spawns creative task; re-lock/re-drive same key is idempotent.
5. **Seam creative.approved:** **creative_director** → `/creative` → QC pass → delivery status `in_delivery` visible in portal.
6. **Dashboards hub:** `/dashboards` — five system cards linking Sales / Delivery / Traffic / HR / Money.
7. **Hypercare:** `CUTOVER.md` — training cohorts + 30-day support window.

Dev personas add: `portal_a`, `portal_b` (header `x-dev-role` / portal shell switcher).

## What ships in M6

- Portal route group UI (`/portal/*`) — **no finance/margin/payroll imports** in portal layout
- `portal.*` tRPC with app-layer `client_id` scoping + staff API boundary for portal actors
- Seams outbox stub: `brief.lock`, `creative.approved` (+ deal.won noted); idempotent re-drive
- `/dashboards` hub for five system views
- `CUTOVER.md` cutover / training / 30-day hypercare
- Tests: portal isolation + seam idempotency

## Credit-aware build note (M1–M6)

Until **15 Aug 2026**, execution used nested agents + mock-first adapters so quality models stayed on gates/RLS/money/auth while boilerplate used light models. See `../hrmny_OS_Execution/02-AGENT-PLAYBOOK.md` §2 / §Applied.

## Deploy wiring (scaffold)

| File | Purpose |
|---|---|
| `vercel.json` | Turborepo install/build for `@hrmny/web` |
| `supabase/config.toml` | Local/link stub — create project in dashboard, then `npx supabase link` |
| `packages/db/APPLY.md` | Apply migrations + RLS + seed to Supabase Postgres |

Link Vercel project root to `hrmny-os/`, set env from `.env.example`, deploy. Live SSO/keys still required for production acceptance.

## Remaining gaps (production)

- Live Supabase Auth (SSO + portal magic-link) + Postgres RLS enforced in DB (app-layer checks cover demo)
- Vercel prod project + secrets (Composio, Xero, Apollo, Hunter, Bayzat, Chat webhook) — **config files ready; account create is manual**
- Live Xero OAuth token exchange + durable webhook persistence (`xero_invoice_mirror`)
- Bank rec queue (Module C) UI
- Inngest workers for retainer month-start, T-48h, SLA day-for-day (callable via tRPC/seams today)
- Full rate-card workbook + DATE-FIRST calendar depth
- Deep Meta/Google/TikTok ads analytics + full marketing automation (parked V2)
- One-channel social publish MVP / Airtable wrap (optional)
- UAE residency migrate path (documented; not V1 blocker)
