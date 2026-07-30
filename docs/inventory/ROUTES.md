# ROUTES — hrmny-os route inventory

_Phase 1 baseline (commit `be160d3`). Every Next.js App Router page/route in `apps/web/src/app`._

**69 routes** — real **61** · mock **2** · dev-only **1** · dead **5**

`real` = live production path · `partial` = real path + silent mock/memory fallback · `mock` = mock/demo-only, no real backing · `dev-only` = dev/demo scaffolding · `dead` = unreachable / no effect

- **Backing** — what renders the data (tRPC procedures, a local `mock-data.ts`, a `redirect()`, or a direct server fn).
- **Reachability** — how a user gets there: primary nav, a sub-nav/tab bar, only via a hub/link, `orphaned` (no inbound link), or public/entry by design.
- Every route below is `auth=staff` unless the ID starts with `portal-` (`auth=portal`) or `public-`/`login` (`auth=public`). There is **no `middleware.ts`** — auth is per-handler/shell only (see DEFECTS `no-edge-middleware`).

## Full route table

| # | Route | URL | File | Status | Backing | Reachability | Notes |
|---|-------|-----|------|--------|---------|--------------|-------|
| 1 | `staff-home` | `/` | `apps/web/src/app/(staff)/page.tsx` | real | tRPC | primary nav | tRPC-backed home dashboard; auth=staff (StaffShell session gate); in staff-shell primary nav (Home). |
| 2 | `staff-account` | `/account` | `apps/web/src/app/(staff)/account/page.tsx` | real | tRPC | hub / link only | tRPC-backed; auth=staff; not in shell nav — reachable only via /delivery hub page link. |
| 3 | `staff-admin-audit` | `/admin/audit` | `apps/web/src/app/(staff)/admin/audit/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed (24-line audit feed); auth=staff; in nav (staff-shell topbar icon + admin/features tab bar). |
| 4 | `staff-admin-features` | `/admin/features` | `apps/web/src/app/(staff)/admin/features/page.tsx` | real | tRPC | primary nav | tRPC-backed Feature Lab; auth=staff; in staff-shell primary nav (Admin); is itself the admin tab-bar hub linking /admin/work, /settings/connections, /settings/ai, /approvals, /roles, /admin/audit. |
| 5 | `staff-admin-work` | `/admin/work` | `apps/web/src/app/(staff)/admin/work/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed Work admin console (2228 lines); auth=staff; reachable via admin/features tab bar. |
| 6 | `staff-approvals` | `/approvals` | `apps/web/src/app/(staff)/approvals/page.tsx` | mock | mock-data.ts | sub-nav / tab bar | Backed entirely by local ./mock-data.ts (MOCK_QUEUE, useApprovalQueue) — file comment says replace with tRPC approvals router when M8 HITL lands; auth=staff; reachable via admin/features tab bar and /settings/ai. |
| 7 | `staff-assets` | `/assets` | `apps/web/src/app/(staff)/assets/page.tsx` | real | tRPC | orphaned | tRPC-backed DAM page; auth=staff; ORPHANED — matched in staff-shell Delivery highlight pattern but no link anywhere (not even /delivery hub). |
| 8 | `staff-benefits` | `/benefits` | `apps/web/src/app/(staff)/benefits/page.tsx` | real | tRPC | hub / link only | tRPC-backed; auth=staff; not in shell nav — reachable via /people hub page link. |
| 9 | `staff-billing` | `/billing` | `apps/web/src/app/(staff)/billing/page.tsx` | real | tRPC | orphaned | tRPC-backed (invoices.list/draft/approve/issue/markPaidFromWebhook); auth=staff; ORPHANED — in staff-shell Finance highlight pattern but no link from /finance or anywhere else. |
| 10 | `staff-client-preview` | `/client-preview` | `apps/web/src/app/(staff)/client-preview/page.tsx` | real | tRPC | primary nav | tRPC-backed portal-as-client preview; auth=staff; in staff-shell primary nav + topbar toggle; /clients rows link here with ?client= param. |
| 11 | `staff-clients` | `/clients` | `apps/web/src/app/(staff)/clients/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed client list; auth=staff; reachable via staff-shell topbar toggle and CrmSubnav (Clients tab). |
| 12 | `staff-clients-id` | `/clients/[id]` | `apps/web/src/app/(staff)/clients/[id]/page.tsx` | real | tRPC | orphaned | tRPC-backed client detail; auth=staff; ORPHANED — /clients list links to /client-preview?client=… instead, no inbound link to this detail route anywhere. |
| 13 | `staff-conventions` | `/conventions` | `apps/web/src/app/(staff)/conventions/page.tsx` | real | tRPC | orphaned | tRPC-backed; auth=staff; effectively ORPHANED — only inbound link is from /gate, which is itself orphaned. |
| 14 | `staff-creative` | `/creative` | `apps/web/src/app/(staff)/creative/page.tsx` | real | tRPC | hub / link only | tRPC-backed; auth=staff; not in shell nav — reachable via /delivery hub page link. |
| 15 | `staff-crm` | `/crm` | `apps/web/src/app/(staff)/crm/page.tsx` | real | tRPC | primary nav | tRPC-backed pipeline; auth=staff; in staff-shell primary nav (CRM) and CrmSubnav (Pipeline). |
| 16 | `staff-crm-activities` | `/crm/activities` | `apps/web/src/app/(staff)/crm/activities/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed; auth=staff; reachable via CrmSubnav. |
| 17 | `staff-crm-companies` | `/crm/companies` | `apps/web/src/app/(staff)/crm/companies/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed; auth=staff; reachable via CrmSubnav. |
| 18 | `staff-crm-contacts` | `/crm/contacts` | `apps/web/src/app/(staff)/crm/contacts/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed; auth=staff; reachable via CrmSubnav. |
| 19 | `staff-crm-deals` | `/crm/deals` | `apps/web/src/app/(staff)/crm/deals/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed; auth=staff; reachable via CrmSubnav; rows router.push to /crm/deals/[id]. |
| 20 | `staff-crm-deals-id` | `/crm/deals/[id]` | `apps/web/src/app/(staff)/crm/deals/[id]/page.tsx` | real | tRPC | hub / link only | tRPC-backed deal detail; auth=staff; reachable from /crm pipeline and /crm/deals list row links. |
| 21 | `staff-crm-inbound` | `/crm/inbound` | `apps/web/src/app/(staff)/crm/inbound/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed; auth=staff; reachable via CrmSubnav. |
| 22 | `staff-crm-outreach` | `/crm/outreach` | `apps/web/src/app/(staff)/crm/outreach/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed; auth=staff; reachable via CrmSubnav. |
| 23 | `staff-crm-quote` | `/crm/quote` | `apps/web/src/app/(staff)/crm/quote/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed quoting/commercial; auth=staff; reachable via CrmSubnav (Commercial tab). |
| 24 | `staff-crm-seams` | `/crm/seams` | `apps/web/src/app/(staff)/crm/seams/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed email+calendar seams; auth=staff; reachable via CrmSubnav; links to /settings/connections when unconnected. |
| 25 | `staff-crm-tasks` | `/crm/tasks` | `apps/web/src/app/(staff)/crm/tasks/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed; auth=staff; reachable via CrmSubnav (Sales tasks). |
| 26 | `staff-dashboards` | `/dashboards` | `apps/web/src/app/(staff)/dashboards/page.tsx` | real | tRPC | orphaned | tRPC-backed (dashboards.hub, seams.list); auth=staff; ORPHANED — route registered in features/catalog.ts but no link from any shell, hub, or admin/features page. |
| 27 | `staff-delivery` | `/delivery` | `apps/web/src/app/(staff)/delivery/page.tsx` | real | tRPC | primary nav | tRPC-backed delivery hub; auth=staff; in staff-shell primary nav; links out to /traffic, /creative, /account (but NOT /assets). |
| 28 | `staff-finance` | `/finance` | `apps/web/src/app/(staff)/finance/page.tsx` | real | tRPC | primary nav | tRPC-backed finance hub; auth=staff; in staff-shell primary nav; does NOT link to /billing or /margin despite shell grouping them under Finance. |
| 29 | `staff-gate` | `/gate` | `apps/web/src/app/(staff)/gate/page.tsx` | dev-only | tRPC | orphaned | Component literally named GateDemoPage ('Gate demo' h1) exercising admin.health/admin.jobs/crm.deals.create via tRPC; auth=staff; ORPHANED — no inbound link anywhere. |
| 30 | `staff-hr-redirect` | `/hr` | `apps/web/src/app/(staff)/hr/page.tsx` | dead | redirect() | dead / redirect | Pure redirect() to /people; legacy URL alias with zero inbound links. |
| 31 | `staff-margin` | `/margin` | `apps/web/src/app/(staff)/margin/page.tsx` | real | tRPC | orphaned | tRPC-backed (dashboards.margin.list, gated on canViewMargin); auth=staff; ORPHANED — no inbound link (not even from /finance). |
| 32 | `staff-my-card` | `/my-card` | `apps/web/src/app/(staff)/my-card/page.tsx` | real | tRPC | orphaned | tRPC-backed (digitalCards.me/templates) digital business card editor; auth=staff; ORPHANED — route in features/catalog.ts but no nav or hub link; it is the only source of /card/[slug] share URLs. |
| 33 | `staff-payroll` | `/payroll` | `apps/web/src/app/(staff)/payroll/page.tsx` | real | tRPC | orphaned | tRPC-backed (payroll.runs list/draft/confirm/approve/post); auth=staff; ORPHANED — in staff-shell People highlight pattern but no link from /people, /workforce-payroll, or anywhere. |
| 34 | `staff-people` | `/people` | `apps/web/src/app/(staff)/people/page.tsx` | real | tRPC | primary nav | tRPC-backed People/HR hub; auth=staff; in staff-shell primary nav; links out to /time, /work-schedule, /talent, /workforce-payroll, /benefits, /workplace. |
| 35 | `staff-requests` | `/requests` | `apps/web/src/app/(staff)/requests/page.tsx` | real | tRPC | primary nav | tRPC-backed feature-intake requests; auth=staff; in staff-shell primary nav. |
| 36 | `staff-roles` | `/roles` | `apps/web/src/app/(staff)/roles/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed; auth=staff; reachable via admin/features tab bar and /gate. |
| 37 | `staff-sales-redirect` | `/sales` | `apps/web/src/app/(staff)/sales/page.tsx` | dead | redirect() | dead / redirect | Pure redirect() to /crm; legacy alias, no inbound links. |
| 38 | `staff-sales-id-redirect` | `/sales/[id]` | `apps/web/src/app/(staff)/sales/[id]/page.tsx` | dead | redirect() | dead / redirect | Pure redirect() to /crm/deals/[id]; legacy alias, no inbound links. |
| 39 | `staff-sales-inbound-redirect` | `/sales/inbound` | `apps/web/src/app/(staff)/sales/inbound/page.tsx` | dead | redirect() | dead / redirect | Pure redirect() to /crm/inbound; legacy alias, no inbound links. |
| 40 | `staff-sales-outreach-redirect` | `/sales/outreach` | `apps/web/src/app/(staff)/sales/outreach/page.tsx` | dead | redirect() | dead / redirect | Pure redirect() to /crm/outreach; legacy alias, no inbound links. |
| 41 | `staff-settings-ai` | `/settings/ai` | `apps/web/src/app/(staff)/settings/ai/page.tsx` | mock | mock-data.ts | sub-nav / tab bar | Backed entirely by local ./mock-data.ts (agents/spend/runs, MONTHLY_CAP_AED=1500) — comment says replace with tRPC aiAdmin router when M7 lands; no tRPC calls at all; auth=staff; reachable via admin/features tab bar. |
| 42 | `staff-settings-asana` | `/settings/asana-migration` | `apps/web/src/app/(staff)/settings/asana-migration/page.tsx` | real | tRPC | hub / link only | tRPC-backed Asana migration tool (441 lines); auth=staff; not in shell nav — reachable only via link on /settings/connections. |
| 43 | `staff-settings-connections` | `/settings/connections` | `apps/web/src/app/(staff)/settings/connections/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC + Supabase OAuth (Google Workspace flow completed in staff-shell); auth=staff; reachable via admin/features tab bar plus links from home, seams, admin/work. |
| 44 | `staff-talent` | `/talent` | `apps/web/src/app/(staff)/talent/page.tsx` | real | tRPC | hub / link only | tRPC-backed (talent.requisitions/performance/surveys); auth=staff; reachable via /people hub link. |
| 45 | `staff-time` | `/time` | `apps/web/src/app/(staff)/time/page.tsx` | real | tRPC | hub / link only | tRPC-backed leave/attendance; auth=staff; reachable via /people hub and /talent links. |
| 46 | `staff-traffic` | `/traffic` | `apps/web/src/app/(staff)/traffic/page.tsx` | real | tRPC | hub / link only | tRPC-backed; auth=staff; reachable via /delivery hub link. |
| 47 | `staff-work` | `/work` | `apps/web/src/app/(staff)/work/page.tsx` | real | tRPC | primary nav | tRPC-backed native Work projects surface (2890 lines); auth=staff; in staff-shell primary nav and WorkNav (Projects). |
| 48 | `staff-work-ai` | `/work/ai` | `apps/web/src/app/(staff)/work/ai/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed Work AI hub (659 lines); auth=staff; in WorkNav; links out to /work/ai/studio and /work/ai/teammates. |
| 49 | `staff-work-ai-studio` | `/work/ai/studio` | `apps/web/src/app/(staff)/work/ai/studio/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed AI Studio (508 lines); auth=staff; reachable via /work/ai hub link (not directly in WorkNav). |
| 50 | `staff-work-ai-teammates` | `/work/ai/teammates` | `apps/web/src/app/(staff)/work/ai/teammates/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed AI teammates (977 lines); auth=staff; reachable via /work/ai hub link (not directly in WorkNav). |
| 51 | `staff-work-inbox` | `/work/inbox` | `apps/web/src/app/(staff)/work/inbox/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed; auth=staff; in WorkNav. |
| 52 | `staff-work-messages` | `/work/messages` | `apps/web/src/app/(staff)/work/messages/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed project messages; auth=staff; in WorkNav. |
| 53 | `staff-work-my-tasks` | `/work/my-tasks` | `apps/web/src/app/(staff)/work/my-tasks/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed (793 lines, plus lib/work-personal helpers); auth=staff; in WorkNav. |
| 54 | `staff-work-planning` | `/work/planning` | `apps/web/src/app/(staff)/work/planning/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed goals/portfolios/workload/gantt (3501 lines); auth=staff; in WorkNav. |
| 55 | `staff-work-search` | `/work/search` | `apps/web/src/app/(staff)/work/search/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed global search; auth=staff; in WorkNav and staff-shell topbar search trigger. |
| 56 | `staff-work-workflows` | `/work/workflows` | `apps/web/src/app/(staff)/work/workflows/page.tsx` | real | tRPC | sub-nav / tab bar | tRPC-backed forms/rules/templates/bundles/approvals (1435 lines); auth=staff; in WorkNav; generates public /forms/[formId] links. |
| 57 | `staff-work-schedule` | `/work-schedule` | `apps/web/src/app/(staff)/work-schedule/page.tsx` | real | tRPC | hub / link only | tRPC-backed shifts/timesheets; auth=staff; reachable via /people hub link. |
| 58 | `staff-workforce-payroll` | `/workforce-payroll` | `apps/web/src/app/(staff)/workforce-payroll/page.tsx` | real | tRPC | orphaned | tRPC-backed; auth=staff; reachable via /people hub link; does not link onward to orphaned /payroll. |
| 59 | `staff-workplace` | `/workplace` | `apps/web/src/app/(staff)/workplace/page.tsx` | real | tRPC | hub / link only | tRPC-backed; auth=staff; reachable via /people hub link. |
| 60 | `public-card-slug` | `/card/[slug]` | `apps/web/src/app/card/[slug]/page.tsx` | real | server fn | orphaned | Server component calling getPublicDigitalCard() directly (no shell, force-dynamic); auth=public by design (share URL); only generated from orphaned /my-card page — no nav entry, intentional. |
| 61 | `public-forms-id` | `/forms/[formId]` | `apps/web/src/app/forms/[formId]/page.tsx` | real | tRPC | public / entry (no nav by design) | tRPC-backed public form fill (work.forms.publicView/publicSubmit); auth=public by design; links generated from /work/workflows — no nav entry, intentional. |
| 62 | `public-login` | `/login` | `apps/web/src/app/login/page.tsx` | real | tRPC | public / entry (no nav by design) | Supabase browser-client auth page, no tRPC; auth=public; target of StaffShell redirect when session missing; not in any nav (entry point). |
| 63 | `portal-home` | `/portal` | `apps/web/src/app/portal/page.tsx` | real | tRPC | see note | tRPC-backed (portal.* routers); auth=portal (PortalShell portal.auth.session gate); in portal-shell nav (Home). |
| 64 | `portal-approvals` | `/portal/approvals` | `apps/web/src/app/portal/approvals/page.tsx` | real | tRPC | see note | tRPC-backed; auth=portal; in portal-shell nav. |
| 65 | `portal-campaign-approvals` | `/portal/campaign-approvals` | `apps/web/src/app/portal/campaign-approvals/page.tsx` | real | tRPC | see note | tRPC-backed; auth=portal; in portal-shell nav (Campaigns). |
| 66 | `portal-deliveries` | `/portal/deliveries` | `apps/web/src/app/portal/deliveries/page.tsx` | real | tRPC | see note | tRPC-backed (portal.deliveries.list), read-only 28-line list; auth=portal; in portal-shell nav. |
| 67 | `portal-login` | `/portal/login` | `apps/web/src/app/portal/login/page.tsx` | real | tRPC | public / entry (no nav by design) | Supabase auth + tRPC devUsers (dev persona switcher present); auth=public; target of PortalShell redirect; shell bypasses chrome on this path. |
| 68 | `portal-reports` | `/portal/reports` | `apps/web/src/app/portal/reports/page.tsx` | real | tRPC | see note | tRPC-backed 28-line read-only page; auth=portal; in portal-shell nav. |
| 69 | `portal-work` | `/portal/work` | `apps/web/src/app/portal/work/page.tsx` | real | tRPC | see note | tRPC-backed shared work for guests (feature work.guests); auth=portal; in portal-shell nav (Shared work). |

## Orphaned routes

Registered, real, rendering pages with **no inbound link** from any shell, hub, or admin surface — reachable only by typing the URL. Phase 7 must either wire an entry point or hide/remove them.

| Route | URL | Status | Why it matters |
|-------|-----|--------|----------------|
| `staff-assets` | `/assets` | real | tRPC-backed DAM page; auth=staff; ORPHANED — matched in staff-shell Delivery highlight pattern but no link anywhere (not even /delivery hub). |
| `staff-billing` | `/billing` | real | tRPC-backed (invoices.list/draft/approve/issue/markPaidFromWebhook); auth=staff; ORPHANED — in staff-shell Finance highlight pattern but no link from /finance or anywhere else. |
| `staff-clients-id` | `/clients/[id]` | real | tRPC-backed client detail; auth=staff; ORPHANED — /clients list links to /client-preview?client=… instead, no inbound link to this detail route anywhere. |
| `staff-conventions` | `/conventions` | real | tRPC-backed; auth=staff; effectively ORPHANED — only inbound link is from /gate, which is itself orphaned. |
| `staff-dashboards` | `/dashboards` | real | tRPC-backed (dashboards.hub, seams.list); auth=staff; ORPHANED — route registered in features/catalog.ts but no link from any shell, hub, or admin/features page. |
| `staff-gate` | `/gate` | dev-only | Component literally named GateDemoPage ('Gate demo' h1) exercising admin.health/admin.jobs/crm.deals.create via tRPC; auth=staff; ORPHANED — no inbound link anywhere. |
| `staff-margin` | `/margin` | real | tRPC-backed (dashboards.margin.list, gated on canViewMargin); auth=staff; ORPHANED — no inbound link (not even from /finance). |
| `staff-my-card` | `/my-card` | real | tRPC-backed (digitalCards.me/templates) digital business card editor; auth=staff; ORPHANED — route in features/catalog.ts but no nav or hub link; it is the only source of /card/[slug] share URLs. |
| `staff-payroll` | `/payroll` | real | tRPC-backed (payroll.runs list/draft/confirm/approve/post); auth=staff; ORPHANED — in staff-shell People highlight pattern but no link from /people, /workforce-payroll, or anywhere. |

**Intentionally reachable without nav (not orphans — do not remove):**

| Route | URL | Why |
|-------|-----|-----|
| `public-card-slug` | `/card/[slug]` | Public share URL generated from `/my-card`; no nav by design. |
| `public-forms-id` | `/forms/[formId]` | Public form-fill URL generated from `/work/workflows`; no nav by design. |
| `login` / `portal-login` | `/login`, `/portal/login` | Auth entry points; redirect targets, not nav items. |

> Note: `staff-workforce-payroll` reads as orphaned in a naive grep because its note mentions the orphaned `/payroll`, but it **is** reachable from the `/people` hub — it is not an orphan.

## Dead / legacy routes

Pure `redirect()` shims kept as legacy URL aliases, with zero inbound links. Safe to delete once external bookmarks/redirects are confirmed unneeded (Phase 7).

| Route | URL | Redirects to | Disposition |
|-------|-----|--------------|-------------|
| `staff-hr-redirect` | `/hr` | `/people` | delete (legacy alias) |
| `staff-sales-redirect` | `/sales` | `/crm` | delete (legacy alias) |
| `staff-sales-id-redirect` | `/sales/[id]` | `/crm/deals/[id]` | delete (legacy alias) |
| `staff-sales-inbound-redirect` | `/sales/inbound` | `/crm/inbound` | delete (legacy alias) |
| `staff-sales-outreach-redirect` | `/sales/outreach` | `/crm/outreach` | delete (legacy alias) |

## Mock & dev-only routes

These render but have no real backing — full disposition in [KILL-LIST.md](./KILL-LIST.md).

| Route | Status | Note |
|-------|--------|------|
| `staff-approvals` | mock | Backed entirely by local ./mock-data.ts (MOCK_QUEUE, useApprovalQueue) — file comment says replace with tRPC approvals router when M8 HITL lands; auth=staff; reachable via admin/features tab bar and /settings/ai. |
| `staff-settings-ai` | mock | Backed entirely by local ./mock-data.ts (agents/spend/runs, MONTHLY_CAP_AED=1500) — comment says replace with tRPC aiAdmin router when M7 lands; no tRPC calls at all; auth=staff; reachable via admin/features tab bar. |
| `staff-gate` | dev-only | Component literally named GateDemoPage ('Gate demo' h1) exercising admin.health/admin.jobs/crm.deals.create via tRPC; auth=staff; ORPHANED — no inbound link anywhere. |
