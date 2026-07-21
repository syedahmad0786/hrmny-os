# hrmny OS — Cutover, training & hypercare

**Milestone:** M6 · **Status:** Demo-ready (dev/mocks) · **Date:** 2026-07-16  
**Owner:** Lead engineer + client ops sponsor

---

## 1. Cutover goals

1. Staff day-to-day work runs in hrmny OS (sales → delivery → money), not Asana/Airtable for core boards.
2. Client portal (`/portal`) is the scoped read/approve surface — **no finance**.
3. Cross-system seams (`deal.won`, `brief.lock`, `creative.approved`, …) are idempotent and auditable.
4. 30-day hypercare clock starts at M6 sign-off.

---

## 2. Pre-cutover checklist

| # | Item | Owner | Done |
|---|---|---|---|
| 1 | Supabase prod project + migrations applied (`packages/db/APPLY.md`) | Eng | ☐ |
| 2 | Vercel prod + preview; env from `.env.example` (no secrets in git) | Eng | ☐ |
| 3 | Google Workspace SSO for staff; portal magic-link allowlist | Eng + IT | ☐ |
| 4 | Composio OAuth apps (Gmail, LinkedIn, Canva, Calendar) redirect URLs | Eng | ☐ |
| 5 | Xero / Bayzat / Apollo / Hunter keys in Keeper → Vercel env | Client | ☐ |
| 6 | Asana residual export → OS task boards reconciled | Ops | ☐ |
| 7 | Role matrix signed (AM margin deny, payroll SoD, portal scopes) | Partners | ☐ |
| 8 | Freeze list of live seams (idempotency keys agreed) | Eng | ☐ |
| 9 | Backup + DR: daily dump, RTO &lt; 24h documented | Ops | ☐ |
| 10 | Feature flags / rollback: previous Vercel deployment known-good | Eng | ☐ |

---

## 3. Cutover rehearsal (T−7 to T−1)

1. **T−7:** Seed staging with anonymized Demo Co + one real client shadow.
2. **T−5:** Run M1–M6 demo scripts end-to-end on staging (`AUTH_MODE=dev` then SSO).
3. **T−3:** Portal isolation test — portal_a cannot see portal_b or margin/payroll.
4. **T−2:** Seam re-drive test — same idempotency key does not double-spawn tasks.
5. **T−1:** Training dry-run (below); freeze schema migrations except hotfixes.

---

## 4. Training plan (roles)

| Cohort | Length | Focus |
|---|---|---|
| Partners / Directors | 60 min | Dashboards hub, margin, overrides, audit |
| AM / CS | 90 min | Sales→handover, Month-1, portal approvals coaching |
| Traffic / Creative | 90 min | DoR, boards, QC@5, Canva connect |
| Finance / HR | 90 min | Invoice propose-approve-post, payroll SoD, VAT close |
| Client portal champions | 45 min | Magic-link, deliveries, approvals, reports (no money) |

**Artifacts:** short Loom per cohort + this checklist; office hours calendar for hypercare week 1.

---

## 5. Go-live day

1. Announce freeze window; enable production feature flags for staff modules already demoed.
2. Point `app.` and `portal.` DNS; verify RLS + session isolation with one real portal user.
3. Disable Asana writes for cutover boards (read-only archive).
4. Start **hypercare clock** (below); open shared support channel (Chat/Slack).

---

## 6. Hypercare (30 days)

| Window | Cadence | Focus |
|---|---|---|
| Days 1–7 | Same-day response | Auth, portal scope bugs, seam failures, Xero post |
| Days 8–21 | Next-business-day | Adoption friction, report gaps, role tweaks |
| Days 22–30 | Triage backlog | V1.1 parking vs hotfix; hypercare exit review |

**Exit criteria:** no P0 open &gt; 48h; portal finance exclusion still holds; payroll never disbursed from OS; weekly adoption check (work of record in OS).

---

## 7. Rollback

1. Vercel: promote previous production deployment.
2. Supabase: restore last daily dump if migration fault (prefer forward-fix).
3. Re-enable Asana write for affected boards only.
4. Disable seam workers / Inngest if double-fire suspected; drain outbox manually.

---

## 8. Production gaps (post-demo)

Tracked in repo README — live Supabase Auth, durable Xero webhooks, Composio keys, Inngest crons, Bayzat API vs CSV, UAE residency migrate path (not V1 blocker).
