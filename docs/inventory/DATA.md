# DATA — tables, migrations & in-memory stores

_Phase 1 baseline (commit `be160d3`). Drizzle schema, raw-SQL migrations, and the process-memory stores that stand in for them._

**32 data items** (26 table/migration entries + 6 in-memory stores) — real **14** · partial **7** · mock **6** · dev-only **1** · dead **4**

`real` = live production path · `partial` = real path + silent mock/memory fallback · `mock` = mock/demo-only, no real backing · `dev-only` = dev/demo scaffolding · `dead` = unreachable / no effect — here `mock` marks a table that is never read/written (all flow runs in memory), `partial` marks a table with a real read **or** write but not both.

Key fact: **~184 `CREATE TABLE` statements** exist across migrations `0000–0061`, but only **51** are modelled in the Drizzle schema; the rest are reached via raw `` sql`` `` in server modules. Many "durable" tables (`invoice`, `agent_runs`, `outreach_items`, `competitor_findings`, mirrors) have migrations but **no live write path** — the feature runs entirely on the in-memory demo store.

## Tables & migrations

| Item | Status | Location | Note |
|------|--------|----------|------|
| `schema-tables-count` | real | `packages/db/src/schema/tables.ts` | Exactly 51 pgTable definitions (role...campaignItems); drizzle schema-of-record for the M1 core, HR leave/attendance, payroll v2, CRM, DAM, ops and campaign tables |
| `sql-only-table-surface` | partial | `packages/db/migrations` | ~184 CREATE TABLE statements across 0000-0061 but only 51 modeled in drizzle; ~141 tables (work_*, asana_*, bayzat HR, payroll-finance, workplace, benefits, digital cards, ai custom apps) exist only in raw SQL and are accessed via sql`` in server modules |
| `mig-core-m1-0000-0007` | real | `packages/db/migrations/0000_early_morph.sql` | Core M1 band: 0000 baseline 26 tables (plus non-journaled 0000_clean.sql variant), 0001 v_client_margin security_invoker view, 0002 CRM (5), 0003 pgvector memory_chunk, 0004 tickets (2), 0005 RLS lockdown, 0006 connection_account, 0007 scheduled_job |
| `mig-hr-band-0008-0015` | real | `packages/db/migrations/0009_leave_attendance.sql` | HR band: 0008 employee-directory ALTER (no tables), 0009 leave/attendance, 0010-0011 Bayzat core HR + talent, 0012 payroll finance, 0013 shifts/timesheets, 0014 workplace (extends ticket w/ service_request_type), 0015 benefits reporting; served by core-hr.ts/talent.ts/payroll-core.ts/shifts-timesheets.ts/workplace.ts raw SQL |
| `mig-apps-band-0016-0018` | real | `packages/db/migrations/0016_ai_custom_apps.sql` | 0016 AI custom apps, 0017 digital cards, 0018 feature lab (feature_override); backed by ai-custom-apps.ts, digital-cards.ts, features.ts raw SQL |
| `mig-work-band-0019-0056` | real | `packages/db/migrations/0019_work_management.sql` | Work suite: ~30 migrations 0019-0056 (work_project/work_item/daily/workflows/planning/governance/identity/api-webhooks/ai/ai-studio/teammates/sandbox/scheduled-rules/messages/proofing/OOO/accessibility/my-tasks/personal-projects/custom-task-types/public-forms/rule-webhooks/dashboard-sharing/rates/custom-fields/status-templates); raw SQL via work-*.ts modules and work routers |
| `mig-asana-band` | real | `packages/db/migrations/0024_asana_sync.sql` | Asana bridge: 0024 sync, 0027 webhooks, 0034 extended import, 0035 reconciliation, 0045 my-tasks import; served by asana-sync.ts/asana-import.ts/asana-webhooks.ts/asana-migration.ts raw SQL |
| `mig-0057-missing` | dead | `packages/db/migrations` | Slot 0057 does not exist: files and meta/_journal.json (61 entries) jump 0056_work_rule_owner_notifications to 0058_agent_runs; harmless gap but breaks any 0000-0061-is-contiguous assumption |
| `mig-late-band-0058-0061` | partial | `packages/db/migrations/0058_agent_runs.sql` | 0058 agent_runs (read-only in code), 0059 outreach_items (zero code refs), 0060 lead_intel: contact_edges/win_loss_notes/competitor_findings (zero code refs), 0061 campaign_items (fully wired); only 0061 has a live write path |
| `rls-coverage` | real | `packages/db/src/migration-security.test.ts` | RLS claim enforced by test: 0005 enables RLS + revokes anon/authenticated on 35 baseline tables (must equal tables created in 0000/0002/0003/0004/0006), and every 0009+ migration must self-contain ENABLE ROW LEVEL SECURITY + REVOKE FROM PUBLIC/anon/authenticated for each table it creates; test regex skips 0007/0008 but 0007 self-locks and 0008 creates no tables |
| `dead-delivery-tables` | dead | `packages/db/src/schema/tables.ts` | account_team_member, immersion, scope, scope_deliverable_line, calendar, calendar_slot: zero non-test read/write anywhere (drizzle or raw SQL); immersion/scope/calendar features run entirely on demo-store Maps in m3/m4-routers |
| `dead-mirror-tables` | dead | `packages/db/src/schema/tables.ts` | bayzat_employee_mirror, xero_invoice_mirror, airtable_task_mirror: no code touches the DB tables; Bayzat/Xero mirroring is simulated in-memory in m2-routers/demo-store |
| `tbl-invoice` | mock | `packages/db/src/schema/tables.ts` | invoice DB table never read/written; all invoice flows (m2-routers, portal-data billing view) run against demo-store in-memory invoices |
| `tbl-memory-chunk` | dead | `packages/ai/src/memory/upsert.ts` | memory_chunk (pgvector, 0003): upsertMemoryChunk/retrieve helpers exist in packages/ai/src/memory but have zero callers in apps or scripts |
| `tbl-agent-runs` | partial | `apps/web/src/server/trpc/ai-admin-router.ts` | agent_runs read via raw SQL for the AI cost panel, but nothing ever inserts rows: packages/ai/src/run-agent.ts persist hook is never bound to the DB, so the panel reads an always-empty table |
| `tbl-brief` | partial | `apps/web/src/server/portal-data.ts` | brief is read via raw SQL (public.brief) for portal data but never written; brief authoring/DoR-lock lives only in demo-store (m4-routers, seams.ts events) |
| `tbl-task` | partial | `apps/web/src/server/portal-data.ts` | task read + status-updated via raw SQL (portal-data.ts 'update public.task ... for update'; ops-router reads), but task creation/delivery board is demo-store only (m4-routers) |
| `tbl-ticket-split` | partial | `apps/web/src/server/trpc/workplace-router.ts` | ticket + ticket_comment genuinely written via workplace-router raw SQL (service requests join service_request_type), while trpc/tickets-router.ts is a parallel memory-only Map implementation whose health endpoint self-reports mode:'memory' — two ticket surfaces, one durable |
| `tbl-auth-rbac` | real | `apps/web/src/server/auth/session.ts` | role, employee, employee_role, permission_policy, employee_auth, client_portal_user read/written via drizzle in auth/session.ts, root.ts, feature-lab-router, work-sandbox.ts raw SQL |
| `tbl-hr-suite` | real | `apps/web/src/server/trpc/hr-operations-router.ts` | leave_policy, leave_balance, leave_request, attendance_record, attendance_correction_request fully read/written via drizzle in hr-operations-router |
| `tbl-payroll-v2` | real | `apps/web/src/server/trpc/payroll-v2-router.ts` | salary_package, payroll_run, payroll_line, employee_expense, employee_loan, payslip read/written via drizzle in payroll-v2-router |
| `tbl-crm-core` | partial | `apps/web/src/server/crm/repository.ts` | company, contact, deal, activity, crm_note, crm_task served by crm/repository.ts drizzle path — but backend silently flips to seeded in-memory store when DATABASE_URL unset (getCrmBackend: postgres\|memory) |
| `tbl-client` | real | `apps/web/src/server/trpc/m3-routers.ts` | client + client_portal_user read/written via raw SQL in m3-routers (win-to-client conversion writes company/deal/client/audit_event) plus feature-lab-router drizzle reads |
| `tbl-dam-assets` | real | `apps/web/src/server/trpc/root.ts` | asset + asset_version inserted/read via drizzle in root.ts assetsRouter and read by portal-data.ts; binary storage defaults to in-memory object store unless DAM_STORAGE=supabase |
| `tbl-ops-band` | real | `apps/web/src/server/m1-persistence.ts` | audit_event (written from ~10 routers), health_signal, scheduled_job (root.ts + api/cron/jobs), convention, connection_account, feature_request, feature_override, work_sandbox all have live read/write paths |
| `tbl-campaign-items` | real | `apps/web/src/server/campaigns/repository.ts` | campaign_items (0061) read/written via drizzle when DATABASE_URL set; memory fallback otherwise |

## In-memory stores (durability risk)

Process-local stores that back production routers. Data is **lost on every restart/redeploy** and is the root of the `partial` API status. Phase 7 must swap each for its durable Postgres path.

| Store | Status | File | Note |
|-------|--------|------|------|
| `store-demo-store` | mock | `apps/web/src/server/demo-store.ts` | 1211-line central in-memory store (deals, invoices, immersions, briefs, tasks, calendars, conventions, health) imported by 16 non-test modules: root, m1-persistence, portal-data, seams, analytics/connections/feature-lab/feature-requests/ops/work-admin/work-management routers and m2-m6 routers |
| `store-crm-memory` | mock | `apps/web/src/server/crm/memory.ts` | Seeded CRM memory fallback (379 lines, JW Marriott/Emaar demo rows); selected by crm/repository.ts whenever getDb() is null |
| `store-campaigns-memory` | mock | `apps/web/src/server/campaigns/memory.ts` | Seeded campaigns memory fallback mirroring crm/memory.ts; selected by campaigns/repository.ts when getDb() is null |
| `store-leadgen` | mock | `apps/web/src/server/leadgen/store.ts` | Process-local Maps standing in for outreach_items (0059) and competitor_findings (0060); self-documented 'merged-but-inert' — no postgres binding exists at all, migrations are schema-only |
| `store-tickets-maps` | mock | `apps/web/src/server/trpc/tickets-router.ts` | Module-level Map<TicketRow>/Map<TicketCommentRow>; comment says 'in-memory until DATABASE_URL + 0004_tickets applied' but no DB path was ever added — durable ticket writes only happen via the separate workplace-router |
| `store-db-fallback` | dev-only | `apps/web/src/server/db.ts` | getDb() caches tryCreateDb(DATABASE_URL) and returns null when unset, silently flipping CRM/campaigns/m3 to memory; m2/m4/m5 routers are pure demo-store and never touch Postgres even with DATABASE_URL set, while 9 modules use requireDb() and throw instead |

## Dead / unbacked tables

Migrated tables with **zero** non-test read/write anywhere — candidates for deletion or wiring in Phase 7.

| Item | Note |
|------|------|
| `mig-0057-missing` | Slot 0057 does not exist: files and meta/_journal.json (61 entries) jump 0056_work_rule_owner_notifications to 0058_agent_runs; harmless gap but breaks any 0000-0061-is-contiguous assumption |
| `dead-delivery-tables` | account_team_member, immersion, scope, scope_deliverable_line, calendar, calendar_slot: zero non-test read/write anywhere (drizzle or raw SQL); immersion/scope/calendar features run entirely on demo-store Maps in m3/m4-routers |
| `dead-mirror-tables` | bayzat_employee_mirror, xero_invoice_mirror, airtable_task_mirror: no code touches the DB tables; Bayzat/Xero mirroring is simulated in-memory in m2-routers/demo-store |
| `tbl-memory-chunk` | memory_chunk (pgvector, 0003): upsertMemoryChunk/retrieve helpers exist in packages/ai/src/memory but have zero callers in apps or scripts |
