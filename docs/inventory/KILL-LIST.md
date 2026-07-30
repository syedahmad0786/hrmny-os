# KILL-LIST — Phase 7 hardening work-list

_Phase 1 baseline (commit `be160d3`). Every mock surface, dev persona/switcher, mock-data file, placeholder, demo control, and duplicate/legacy screen — the exhaustive Phase 7 ("kill every dead control, mock surface, dev switcher, orphan route") work-list. Sourced from the `mock-surfaces` (48) and `dead-controls` (13) sweeps._

**Disposition legend:** **WIRE-TO-REAL** = replace mock/memory with the durable path · **DELETE** = remove the surface/control · **HIDE-BEHIND-FLAG / GATE** = keep code but block in production · **KEEP** = honest by-design, review only.

Orphaned & dead/legacy **routes** are tracked in [ROUTES.md](./ROUTES.md) (9 orphaned real routes, 5 dead redirects) and are in scope for the same Phase 7 pass.

## Dev personas & switchers

_Default disposition: DELETE, or hard-gate so the persona list is empty in production builds (auth already forces Supabase when `NODE_ENV=production`)._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `dev-personas-session` | dev-only | `apps/web/src/server/auth/session.ts` | (group default) | DEV_USERS: 7 staff + 2 portal personas (portal_a/b bound to Demo Co/Other Co client UUIDs); getAuthMode() forces supabase when NODE_ENV=production but dev mode is default otherwise |
| `auth-devusers-endpoint` | dev-only | `apps/web/src/server/trpc/root.ts` | (group default) | publicProcedure auth.devUsers (line ~122) lists all switchable personas whenever authMode=dev; feeds every persona selector in the UI |
| `staff-shell-dev-switcher` | dev-only | `apps/web/src/components/staff-shell.tsx` | (group default) | Header 'Dev only' persona <select> (~line 327) driven by trpc.auth.devUsers + setDevRole; visible whenever devUsers returns non-empty |
| `portal-shell-persona-selector` | dev-only | `apps/web/src/components/portal-shell.tsx` | (group default) | 'Client persona' selector in portal header; auto-forces dev role to portal_a on mount when current role is not portal_* |
| `portal-login-stub-token` | dev-only | `apps/web/src/app/portal/login/page.tsx` | (group default) | 'Stub token (dev only)' magic-link flow (result.stubToken) plus 'Continue to portal (dev persona)' link, active whenever Supabase browser client is unset |
| `portal-home-dev-hint` | dev-only | `apps/web/src/app/portal/page.tsx` | (group default) | Visible error copy (lines 37-38) instructs user to 'Switch Dev persona to portal_a (Demo Co) or portal_b (Other Co) in the header' |
| `portal-login-dev-stub-controls` | dev-only | `apps/web/src/app/portal/login/page.tsx` | (group default) | Stub-token block + 'Verify token' button (lines 70-83) and 'Continue to portal (dev persona)' link (lines 89-93) are dev-persona scaffolding rendered on the production portal login when Supabase is unset / devUsers exist; portal home (portal/page.tsx line 36) similarly tells users to 'Switch Dev persona to portal_a' on session error. |

## Mock-data files & mock-backed screens

_Default disposition: WIRE-TO-REAL — replace the `mock-data.ts` import with the real tRPC router (approvals/aiAdmin/connections.health) and delete the mock file._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `approvals-mock-data` | mock | `apps/web/src/app/(staff)/approvals/mock-data.ts` | (group default) | MOCK_QUEUE of 3 fabricated proposals (Tejari Foods outreach/campaign/portal); useApprovalQueue() returns the mock unconditionally; header comment says 'replace with tRPC when approvals router lands (M8 HITL)' |
| `approvals-page` | mock | `apps/web/src/app/(staff)/approvals/page.tsx` | (group default) | Entire HITL approvals screen renders mock-data queue; approve/reject act on local state only, never hit a server |
| `approvals-approve-reject-mock` | mock | `apps/web/src/app/(staff)/approvals/page.tsx` | (group default) | Approve & queue send / Reject buttons (lines 170-183) only write to local useState decisions; entire queue comes from mock-data.ts MOCK_QUEUE. Comment at line 19 admits decisions are 'optimistic and non-persisting' — no approvals router mutation exists. Nothing is sent, persisted, or audited. |
| `settings-ai-mock-data` | mock | `apps/web/src/app/(staff)/settings/ai/mock-data.ts` | (group default) | MOCK_AGENTS + MOCK_RUNS + hardcoded MONTHLY_CAP_AED=1500; useAiAdmin() returns mocks; comment says 'replace with tRPC hooks when aiAdmin router lands (M7)' |
| `settings-ai-page` | mock | `apps/web/src/app/(staff)/settings/ai/page.tsx` | (group default) | AI admin console (agents, spend, runs, kill switches) fully mock-rendered even though server/trpc/ai-admin-router.ts exists |
| `settings-ai-kill-switch-mock` | mock | `apps/web/src/app/(staff)/settings/ai/page.tsx` | (group default) | Per-agent kill-switch toggles (lines 139-155) flip local useState only over MOCK_AGENTS from mock-data.ts; spend meter, cap, and 'Recent runs' table are all fabricated. Comment at line 21 says real kill switch awaits an aiAdmin router (M7). Toggle resets on reload. |
| `connection-health-widget` | mock | `apps/web/src/app/(staff)/settings/connections/connection-health.tsx` | (group default) | MOCK_PROVIDERS health cards (Composio etc., line 26); disconnect only flips local card state ('mock optimistic disconnect' comment line 96); embedded inside the otherwise-real /settings/connections page |
| `connection-health-mock-panel` | mock | `apps/web/src/app/(staff)/settings/connections/connection-health.tsx` | (group default) | Entire Connection Health panel (top of the real /settings/connections page) renders MOCK_PROVIDERS with fabricated statuses (Hunter '401 from provider', n8n 'reachable · 3 active workflows', Apollo quota). Connect/Disconnect/Reconnect buttons (lines 156-187) only flip local overrides state — no mutation, resets on reload. Comment says replace with connections.health in M7. |

## Demo-store & silent memory fallbacks

_Default disposition: WIRE-TO-REAL — force the durable Postgres path; remove the silent in-memory fallback (or make it throw) so prod cannot run on process memory. See DATA.md stores._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `demo-store` | mock | `apps/web/src/server/demo-store.ts` | (group default) | 1200-line process-memory store seeded with DEMO_DEAL/EMPLOYEE/CLIENT/CLIENT_B/TASK/BRIEF IDs (Demo Co, Other Co); backing store for m2-m6/analytics/seams routers; all data lost on restart |
| `m2-routers-demo` | mock | `apps/web/src/server/trpc/m2-routers.ts` | (group default) | Invoices/proposals/employees/escalations 100% demo-store backed (0 getDb, 20+ getDemoStore); exposes invoices.resetDemo mutation |
| `m3-routers-demo` | mock | `apps/web/src/server/trpc/m3-routers.ts` | (group default) | CRM deals/quotes predominantly demo-store (39 getDemoStore vs 5 getDb refs) |
| `m4-routers-demo` | mock | `apps/web/src/server/trpc/m4-routers.ts` | (group default) | Delivery/traffic/creative/account routers 100% demo-store (0 getDb, 30 getDemoStore); exposes m4.reset |
| `m5-routers-demo` | mock | `apps/web/src/server/trpc/m5-routers.ts` | (group default) | Payroll/margin/billing routers 100% demo-store (0 getDb, 10 getDemoStore); exposes m5.reset |
| `m6-routers-demo` | mock | `apps/web/src/server/trpc/m6-routers.ts` | (group default) | Dashboards hub mixed backing (6 getDb vs 5 getDemoStore refs); demo fallback still reachable |
| `analytics-router-demo` | mock | `apps/web/src/server/trpc/analytics-router.ts` | (group default) | Demo-store only (0 getDb, 2 getDemoStore) — no real DB path at all |
| `seams-outbox-stub` | mock | `apps/web/src/server/seams.ts` | (group default) | In-memory outbox self-described in UI as 'idempotent Inngest-style stub' (0 getDb, 4 getDemoStore); events vanish on restart; surfaced on /dashboards |
| `portal-data-demo-fallback` | mock | `apps/web/src/server/portal-data.ts` | (group default) | Portal briefs/deliveries/status fall back to demo store when DATABASE_URL unset (5 getDb / 4 getDemoStore) |
| `ops-router-demo-fallback` | mock | `apps/web/src/server/trpc/ops-router.ts` | (group default) | Staff-home 'live operations' metrics silently fall back to demo store when getDb() is null (line 19-21) |
| `m1-persistence-demo-fallback` | mock | `apps/web/src/server/m1-persistence.ts` | (group default) | Audit events and health signals fall back to in-memory demo store without DATABASE_URL — audit trail evaporates on restart |
| `connections-router-demo-fallback` | mock | `apps/web/src/server/trpc/connections-router.ts` | (group default) | 6 getDemoStore fallbacks beside 8 getDb paths — connections list/save degrade to in-memory silently |
| `feature-requests-router-demo` | mock | `apps/web/src/server/trpc/feature-requests-router.ts` | (group default) | /requests feature-intake falls back to demo store (1 getDb / 3 getDemoStore) |
| `work-admin-router-demo` | mock | `apps/web/src/server/trpc/work-admin-router.ts` | (group default) | Admin console roles/clients fall back to demo-store arrays (8 getDemoStore refs incl. role create/update on the in-memory list) |
| `work-attachments-memory-store` | mock | `apps/web/src/server/trpc/work-management-router.ts` | (group default) | Task/doc attachments use getDemoStore().objectStore = memory object store unless DAM_STORAGE=supabase — uploaded files lost on restart (lines ~4857, 8360-8432) |

## Demo / reset controls on production pages

_Default disposition: DELETE or hide behind a non-prod flag — these call real `m4.reset`/`m5.reset`/`invoices.resetDemo` mutations from production finance/payroll/delivery pages._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `finance-reset-demo` | mock | `apps/web/src/app/(staff)/finance/page.tsx` | (group default) | Demo-store-backed finance screen with visible 'Reset M2 finance' button (trpc.invoices.resetDemo) |
| `billing-reset-demo` | mock | `apps/web/src/app/(staff)/billing/page.tsx` | (group default) | Demo-store-backed billing screen with visible 'Reset M5 demo' button (trpc.m5.reset) |
| `margin-reset-demo` | mock | `apps/web/src/app/(staff)/margin/page.tsx` | (group default) | Demo-store-backed margin screen with visible 'Reset M5 demo (seed retainer + costs)' button |
| `payroll-reset-demo` | mock | `apps/web/src/app/(staff)/payroll/page.tsx` | (group default) | Demo-store-backed payroll run screen with visible 'Reset M5 demo' button |
| `delivery-reset-demo` | mock | `apps/web/src/app/(staff)/delivery/page.tsx` | (group default) | Demo-store-backed delivery screen with visible 'Reset M4 demo' button (trpc.m4.reset) |
| `traffic-reset-demo` | mock | `apps/web/src/app/(staff)/traffic/page.tsx` | (group default) | Demo-store-backed traffic screen with visible 'Reset M4 demo' button |
| `creative-reset-demo` | mock | `apps/web/src/app/(staff)/creative/page.tsx` | (group default) | Demo-store-backed creative screen with visible 'Reset M4 demo' button |
| `account-reset-demo` | mock | `apps/web/src/app/(staff)/account/page.tsx` | (group default) | Demo-store-backed AM screen with two 'Reset M4 demo' controls (lines 149, 411 'Reset M4 demo to seed calendar') |
| `demo-reset-buttons-prod-pages` | dev-only | `apps/web/src/app/(staff)/billing/page.tsx` | (group default) | 'Reset M4/M5 demo' buttons are wired to real m4.reset/m5.reset mutations but are demo scaffolding exposed on production pages: billing, payroll, margin, finance (resetDemo), account, creative, delivery, traffic. Also roles/page.tsx queries hardcoded seed deal id e0000000-...-000000000001. Milestone-demo surface, not launch UI. |

## Hardcoded demo copy in live screens

_Default disposition: WIRE-TO-REAL — replace fabricated content with queried state; remove baked-in demo client names._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `staff-home-demo-card` | mock | `apps/web/src/app/(staff)/page.tsx` | (group default) | Live-metrics home page hardcodes 'Demo Co · delivery approval' card (line 221) plus fake progress bars fixed at 76/52/88% |
| `staff-home-waiting-panel` | partial | `apps/web/src/app/(staff)/page.tsx` | (group default) | 'Waiting on you' approvals panel (lines 216-249) hardcodes 'Demo Co · delivery approval' and fake progress-bar widths (76%/52%/88%) regardless of real data; the links navigate correctly but the approval content is static demo copy, not queried state. |
| `crm-tejari-lane-option` | mock | `apps/web/src/app/(staff)/crm/page.tsx` | (group default) | Hardcoded '<option value="tejari">Tejari</option>' in the lane filter (line 97) — demo client name baked into production filter UI |
| `dashboards-hub-milestone` | dev-only | `apps/web/src/app/(staff)/dashboards/page.tsx` | (group default) | Visible 'Milestone 6 · One OS' kicker and 'Outbox — idempotent Inngest-style stub' copy; backed by seams/m6 demo data |

## Milestone-acceptance probe pages

_Default disposition: DELETE or gate to non-prod — `/gate`, `/roles`, `/assets` are M1 acceptance probes (raw JSON dumps, hardcoded seed IDs), not launch UI. (`feature-lab-page` is the real Admin console — keep, but remove its demo-store fallback.)_

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `gate-demo-page` | dev-only | `apps/web/src/app/(staff)/gate/page.tsx` | (group default) | 'Gate demo' M1 acceptance probe: create 'M1 acceptance <date>' deal, trip/schedule health signals, raw JSON dumps; copy references 'M1 Chat/stub criterion' |
| `roles-demo-page` | dev-only | `apps/web/src/app/(staff)/roles/page.tsx` | (group default) | 'Roles & margin' RBAC probe: hardcoded demo deal e0000000-0000-4000-8000-000000000001, session JSON dump, copy says 'Switch the Dev role in the header' |
| `assets-demo-page` | dev-only | `apps/web/src/app/(staff)/assets/page.tsx` | (group default) | 'DAM upload' probe: default title 'M1 demo asset', uploads fabricated demo.txt (hrmny-dam-demo-<ts>) and prints signed-URL JSON |
| `feature-lab-page` | dev-only | `apps/web/src/app/(staff)/admin/features/page.tsx` | KEEP (real Admin console) — but remove its demo-store fallback. | Feature Lab dev console (global/client/role/user feature overrides via trpc.admin.features); wired as the primary 'Admin' nav destination in staff-shell; router has demo-store fallback |

## Inert / dead controls

_Default disposition: DELETE the control, or wire it — buttons/selects that look interactive but do nothing (or silently drop user input)._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `connection-health-change-btn` | dead | `apps/web/src/app/(staff)/settings/connections/connection-health.tsx` | (group default) | 'Change' button (line 171) has no onClick handler at all — completely inert control rendered on every connected provider card. |
| `crm-quote-discount-tier` | dead | `apps/web/src/app/(staff)/crm/quote/page.tsx` | (group default) | 'Discount tier' select (lines 121-127) is uncontrolled (defaultValue="none"); its value is never read, never persisted, and there is no save mutation anywhere on the commercial panel. Pure decoration implying a pricing workflow that does not exist. |
| `crm-inbound-market-select` | dead | `apps/web/src/app/(staff)/crm/inbound/page.tsx` | FIX — wire the Market value into the `leads.inbound.create` payload (currently discarded). | 'Market' select in the capture-lead form (lines 95-102) is uncontrolled defaultValue="UAE" and its value is never included in the leads.inbound.create payload — user choice of UAE/KSA/Both is silently discarded while the rest of the form submits. |
| `crm-seams-linkedin-view-rule` | dead | `apps/web/src/app/(staff)/crm/seams/page.tsx` | (group default) | LinkedIn card footer 'View rule →' (lines 89-92) is styled identically to the working 'Connect →' links on sibling cards but is a plain span with no href or handler — looks clickable, does nothing. |

## Legacy / duplicate screens

_Default disposition: DELETE — bare `redirect()` aliases of `/crm*` and `/people` with no inbound links._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `sales-legacy-redirects` | dev-only | `apps/web/src/app/(staff)/sales` | (group default) | 4 legacy duplicate screens now bare redirects to /crm*: sales/page.tsx, sales/[id]/page.tsx, sales/inbound/page.tsx, sales/outreach/page.tsx |
| `hr-legacy-redirect` | dev-only | `apps/web/src/app/(staff)/hr/page.tsx` | (group default) | Legacy duplicate screen — bare redirect to /people |

## Stub adapters & providers

_Default disposition: WIRE-TO-REAL — provision keys and flip `*_MODE=live`; replace the n8n stub verifier with real HMAC; swap the mock LLM provider for the live model._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `integrations-stub-adapters` | mock | `packages/integrations/src/index.ts` | (group default) | createApolloStub/createBayzatStub/createXeroStub/createHunterStub/createComposioStub/createN8nStub — adapters run in stub mode unless *_MODE=live plus API key (e.g. APOLLO_MODE, apollo/index.ts line 49) |
| `ai-provider-stub` | mock | `packages/ai/src/provider.ts` | (group default) | LLM provider returns '[mock:<model>] stub response' when ANTHROPIC_API_KEY missing (line ~189); plus mockExtractInvoice keyword classifier in invoice-extract.ts self-marked 'swap for the live model in prod' |
| `n8n-webhook-stub-verifier` | dev-only | `apps/web/src/app/api/webhooks/n8n/route.ts` | WIRE-TO-REAL — replace stub with constant-time HMAC verification. | Signature verification stubbed: N8N_WEBHOOK_SECRET unset = accept all ('dev only' reason string); when set, uses non-constant-time exact match self-labelled 'stub verifier — replace with HMAC' |

## Sandbox & demo/pitch surfaces

_Default disposition: GATE / DELETE — the sandbox reset endpoint is a test surface exposed as an app route; `desk-site` is a separate committed pitch/demo Vercel app._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `work-sandbox-api` | dev-only | `apps/web/src/app/api/work/sandbox/environment/route.ts` | (group default) | Sandbox environment bootstrap/reset endpoint (bootstrapSandboxDatabase/resetSandboxDatabase) guarded by sandboxRequestAuthorized — test-environment surface exposed as an app route |
| `desk-site-demo-deploy` | dev-only | `desk-site` | (group default) | Separate public Vercel pitch/demo site (hrmny-os-desk) with static 521-line hardcoded landing + CRM/portal mockups ('partner-ready demo' copy) and committed _deploy-payload.json/_deploy-meta.json/_mcp-deploy-args.json artifacts |

## Honest by-design (UX review only)

_Default disposition: KEEP — honest/disabled-by-design controls; flag for UX review, not removal._

| Surface | Sweep status | File | Disposition | Note |
|---------|--------------|------|-------------|------|
| `admin-work-ai-approval-locked-checkbox` | real | `apps/web/src/app/(staff)/admin/work/page.tsx` | KEEP — honest, intentionally locked; UX review only. | AI guardrails form checkbox 'Explicit human approval is required' (line 1656) is permanently checked+disabled; intentional by design — requireHumanApproval is hardcoded true in the save mutation. Disabled-forever control but honest; flag for UX review only. |

## Audit confirmations (no action)

Sweep entries that are **clean-bill-of-health checks**, not kill items — recorded so the count reconciles.

| Check | Result |
|-------|--------|
| `no-broken-links` | Cross-checked every href in apps/web/src (pages, layouts, StaffShell/PortalShell/CrmSubnav/WorkNav components, and server-provided dashboards.hub hrefs) against the app directory: all resolve to existing routes; /hr and /sales/* are working redirects to /people and /crm/*. No dangling links found. |
| `all-other-pages-wired` | Every remaining page file sampled (work, work/planning, work/my-tasks, work/messages, work/inbox, work/search, work/workflows, work/ai + studio + teammates, admin/work, admin/features, admin/audit, crm/* , clients, client-preview, people, time, talent, benefits, workplace, work-schedule, workforce-payroll, requests, my-card, conventions, gate, assets, settings/connections, settings/asana-migration, login, card/[slug], forms/[formId], portal/*): all buttons/forms/toggles dispatch real tRPC mutations or legitimate local view state; no other empty/console-only handlers found. |
