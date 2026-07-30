# API-SURFACE — hrmny-os tRPC + route-handler inventory

_Phase 1 baseline (commit `be160d3`). The `api` sweep counts **tRPC procedures only** (verified 637 `.query`/`.mutation` calls) plus one empty router. Non-tRPC HTTP handlers (SCIM, MCP, Work REST, webhooks, cron) are catalogued separately below and in [INTEGRATIONS.md](./INTEGRATIONS.md)._

**637 procedures + 1 empty router = 638 items**, across **48 registered namespaces** — real **192** · partial **316** · mock **123** · dev-only **6** · dead **1**

`real` = live production path · `partial` = real path + silent mock/memory fallback · `mock` = mock/demo-only, no real backing · `dev-only` = dev/demo scaffolding · `dead` = unreachable / no effect

The dominant `partial` status is structural: most routers resolve against Postgres **or** silently fall back to the in-memory demo store / seeded memory when `DATABASE_URL` (or a feature backend) is absent. See [DATA.md](./DATA.md) and [KILL-LIST.md](./KILL-LIST.md).

## Router summary

| Namespace (appRouter key) | Procedures | Status mix | Backing file(s) |
|---------------------------|-----------:|------------|-----------------|
| `work` | 154 | real=2 partial=152 | `work-management-router.ts` |
| `workAdmin` | 38 | real=4 partial=34 | `work-admin-router.ts` |
| `benefits` | 29 | real=29 | `benefits-reporting-router.ts` |
| `talent` | 27 | real=27 | `talent-router.ts` |
| `crm` | 23 | partial=23 | `crm-routers.ts` |
| `workplace` | 21 | real=21 | `workplace-router.ts` |
| `workAiTeammates` | 20 | partial=20 | `work-ai-teammates-router.ts` |
| `shiftsTimesheets` | 19 | real=19 | `shifts-timesheets-router.ts` |
| `aiCustomApps` | 19 | real=18 mock=1 | `ai-custom-apps-router.ts` |
| `portal` | 19 | partial=16 mock=3 | `m6-routers.ts`×16, `portal-approvals-router.ts`×3 |
| `coreHr` | 18 | real=18 | `core-hr-router.ts` |
| `connections` | 16 | real=5 partial=9 mock=2 | `connections-router.ts` |
| `workforcePayroll` | 15 | real=15 | `payroll-v2-router.ts` |
| `hrOperations` | 14 | real=14 | `hr-operations-router.ts` |
| `deals` | 14 | mock=13 dev-only=1 | `m3-routers.ts` |
| `admin` | 11 | real=3 partial=8 | `root.ts`×7, `feature-lab-router.ts`×4 |
| `clients` | 11 | real=2 partial=3 mock=6 | `m3-routers.ts`×9, `m4-routers.ts`×2 |
| `invoices` | 11 | mock=10 dev-only=1 | `m2-routers.ts` |
| `digitalCards` | 10 | real=10 | `digital-cards-router.ts` |
| `tickets` | 9 | mock=9 | `tickets-router.ts` |
| `calendars` | 9 | mock=9 | `m4-routers.ts` |
| `employees` | 9 | mock=9 | `m2-routers.ts` |
| `leadgen` | 9 | partial=3 mock=6 | `leadgen-router.ts` |
| `asanaMigration` | 8 | real=1 partial=6 mock=1 | `asana-migration-router.ts` |
| `campaigns` | 8 | partial=8 | `campaigns-router.ts` |
| `workAiStudio` | 7 | partial=7 | `work-ai-studio-router.ts` |
| `tasks` | 7 | mock=7 | `m4-routers.ts` |
| `outreach` | 7 | mock=7 | `m3-routers.ts` |
| `assets` | 6 | partial=6 | `root.ts` |
| `automation` | 6 | partial=5 mock=1 | `automation-router.ts` |
| `dashboards` | 6 | mock=6 | `m4-routers.ts`×2, `m5-routers.ts`×2, `m2-routers.ts`×1, `m6-routers.ts`×1 |
| `payroll` | 6 | mock=6 | `m2-routers.ts` |
| `featureRequests` | 5 | real=3 partial=2 | `feature-requests-router.ts` |
| `briefs` | 5 | mock=5 | `m4-routers.ts` |
| `vat` | 5 | mock=5 | `m5-routers.ts` |
| `leads` | 5 | mock=5 | `m3-routers.ts` |
| `workAi` | 4 | partial=4 | `work-ai-router.ts` |
| `scopes` | 4 | mock=4 | `m3-routers.ts` |
| `analytics` | 4 | partial=3 mock=1 | `analytics-router.ts` |
| `auth` | 3 | partial=1 mock=1 dev-only=1 | `root.ts` |
| `requisitions` | 3 | mock=3 | `m2-routers.ts` |
| `conventions` | 2 | partial=2 | `root.ts` |
| `clientPreview` | 2 | partial=2 | `client-preview-router.ts` |
| `seams` | 2 | mock=2 | `m6-routers.ts` |
| `m4` | 2 | dev-only=2 | `m4-routers.ts` |
| `ops` | 2 | partial=1 mock=1 | `ops-router.ts` |
| `aiAdmin` | 2 | real=1 partial=1 | `ai-admin-router.ts` |
| `m5` | 1 | dev-only=1 | `m5-routers.ts` |
| `m6 *(empty router)*` | 1 | dead=1 | `m6-routers.ts` |

## Unregistered router modules (post-baseline delta)

These router modules exist on disk **after** the baseline (added by PRs #19–#23) but are **intentionally not wired into `appRouter`** in `apps/web/src/server/trpc/root.ts` — they are held for a single batched wiring PR. They therefore do **not** appear in the 637-procedure sweep above. Verified against the branch HEAD of this PR: none of these export names are imported by `root.ts`; the three that exist are referenced only by their own tests.

| Module | Export | Procedures | Registered? | Source |
|--------|--------|-----------:|-------------|--------|
| `apps/web/src/server/trpc/scorecards-router.ts` | `scorecardsRouter` | 9 | **No** — pending batched wiring PR | PR #19 (explainable ratings, migration 0062) |
| `apps/web/src/server/trpc/ai-policy-router.ts` | `aiPolicyRouter` | 3 | **No** — pending batched wiring PR | PR #21 (autonomy governance) |
| `apps/web/src/server/trpc/people-recon-router.ts` | `peopleReconRouter` | 4 | **No** — pending batched wiring PR | PR #20 (parallel-payroll reconciliation) |
| `reports` router | *(not yet a standalone module on this HEAD)* | — | **No** — planned for the batched wiring PR | scheduled-reports scope (Phase 6) |
| `portal-feedback` router | *(feedback procedures currently inline in `campaigns` / `portal.campaignApprovals`)* | — | **No** — planned to split out in the batched wiring PR | PR #23 (portal proofing feedback, migration 0063) |

> Disposition: wire all five into `appRouter` in one reviewed PR, then re-run the route/action crawler (PR #22) to fold their procedures into this surface. Until then they are dark (no HTTP exposure).

## Full procedure inventory

Every procedure from the sweep, grouped by namespace. `kind` (query/mutation) and backing are taken verbatim from the sweep note.

### `admin` — 11 procedures · `root.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `admin.features.list` | partial | query; DB+mem fallback |
| `admin.features.resolve` | partial | query; DB+mem fallback |
| `admin.features.setOverride` | partial | mutation; DB+mem fallback; writes audit |
| `admin.features.removeOverride` | partial | mutation; DB+mem fallback; writes audit |
| `admin.roles.list` | partial | query; DB+mem fallback |
| `admin.permissions.list` | real | query; DB (drizzle); hardcoded policy fallback w/o DB |
| `admin.audit.list` | partial | query; DB+mem fallback |
| `admin.health.get` | partial | query; DB+mem fallback |
| `admin.health.emitStub` | partial | mutation; DB+mem fallback; health signal only, no audit event |
| `admin.jobs.list` | real | query; DB (drizzle); empty [] w/o DB |
| `admin.jobs.scheduleHealth` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |

### `aiAdmin` — 2 procedures · `ai-admin-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `aiAdmin.dashboard` | real | query; DB (drizzle) rollup of agent runs |
| `aiAdmin.toggleAgent` | partial | mutation; DB+mem fallback; writes audit |

### `aiCustomApps` — 19 procedures · `ai-custom-apps-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `aiCustomApps.customApps.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `aiCustomApps.customApps.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.customApps.setActive` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.customApps.records.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `aiCustomApps.customApps.records.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.customApps.records.update` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.customApps.records.archive` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.reports.metrics` | mock | query; computed/hardcoded, no persistence |
| `aiCustomApps.reports.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `aiCustomApps.reports.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.reports.approve` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.reports.run` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.reports.runs` | real | query; DB required (throws w/o DATABASE_URL) |
| `aiCustomApps.reports.schedules.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `aiCustomApps.reports.schedules.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.reports.schedules.setStatus` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.reports.naturalLanguage.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `aiCustomApps.reports.naturalLanguage.propose` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `aiCustomApps.reports.naturalLanguage.accept` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |

### `analytics` — 4 procedures · `analytics-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `analytics.winRate` | partial | query; computed over Postgres-or-memory CRM data |
| `analytics.churnRisk` | mock | query; computed over in-memory data |
| `analytics.capacityForecast` | partial | query; computed over DB+mem fallback data |
| `analytics.weeklyReport` | partial | query; computed over DB+mem fallback data |

### `asanaMigration` — 8 procedures · `asana-migration-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `asanaMigration.status` | mock | query; computed/hardcoded |
| `asanaMigration.dryRun` | partial | mutation; DB+mem fallback; writes audit |
| `asanaMigration.import` | partial | mutation; DB+mem fallback; writes audit |
| `asanaMigration.syncStatus` | real | query; DB (drizzle) |
| `asanaMigration.syncNow` | partial | mutation; DB+mem fallback; writes audit |
| `asanaMigration.syncWebhookStatus` | partial | query; DB+mem fallback |
| `asanaMigration.syncWebhookEnable` | partial | mutation; DB+mem fallback; writes audit |
| `asanaMigration.syncWebhookDisable` | partial | mutation; DB+mem fallback; writes audit |

### `assets` — 6 procedures · `root.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `assets.create` | partial | mutation; DB+mem fallback; writes audit |
| `assets.uploadVersion` | partial | mutation; DB+mem fallback (object store via demo-store); writes audit |
| `assets.get` | partial | query; DB+mem fallback |
| `assets.signedUrl` | partial | mutation; DB+mem fallback; writes audit |
| `assets.list` | partial | query; DB+mem fallback |
| `assets.qc` | partial | mutation; DB+mem fallback; CD role gate; writes audit |

### `auth` — 3 procedures · `root.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `auth.session` | partial | query; DB+mem fallback |
| `auth.devUsers` | dev-only | query; dev-mode persona list, empty in prod auth |
| `auth.logout` | mock | mutation; no-op stub; no audit |

### `automation` — 6 procedures · `automation-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `automation.health` | partial | query; external n8n adapter; blocked w/o API key |
| `automation.listWorkflows` | partial | query; external n8n adapter |
| `automation.eventMap` | mock | query; hardcoded N8N_EVENT_MAP |
| `automation.proposeWorkflow` | partial | mutation; external n8n adapter, propose-only (never fires); no audit |
| `automation.triggerWorkflow` | partial | mutation; external n8n adapter, HITL trigger; no audit |
| `automation.getExecutionStatus` | partial | query; external n8n adapter |

### `benefits` — 29 procedures · `benefits-reporting-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `benefits.catalog.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.catalog.adminList` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.catalog.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.catalog.setActive` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.catalog.addEligibilityRule` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.catalog.setEligibilityRuleActive` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.enrolments.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.enrolments.request` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.enrolments.decide` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.enrolments.close` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.dependants.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.dependants.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.dependants.setStatus` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.health.availablePolicies` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.health.policies` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.health.createPolicy` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.health.setPolicyStatus` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.health.members` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.health.addMember` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.health.setMemberStatus` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.health.cards` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.health.addCard` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.health.endorsements` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.health.requestEndorsement` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.health.decideEndorsement` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.perks.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `benefits.perks.record` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.perks.decide` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `benefits.reports.snapshot` | real | query; DB required (throws w/o DATABASE_URL) |

### `briefs` — 5 procedures · `m4-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `briefs.get` | mock | query; in-memory demo store |
| `briefs.createForTask` | mock | mutation; in-memory demo store; writes audit |
| `briefs.updateBody` | mock | mutation; in-memory demo store; no audit |
| `briefs.validateDor` | mock | mutation; in-memory demo store; DoR gate check; no audit |
| `briefs.lock` | mock | mutation; in-memory demo store; DoR lock gate; writes audit |

### `calendars` — 9 procedures · `m4-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `calendars.listByClient` | mock | query; in-memory demo store (M4) |
| `calendars.get` | mock | query; in-memory demo store |
| `calendars.create` | mock | mutation; in-memory demo store; writes audit |
| `calendars.addSlot` | mock | mutation; in-memory demo store; no audit |
| `calendars.refApprove` | mock | mutation; in-memory demo store; gate transition w/ audit |
| `calendars.shoot` | mock | mutation; in-memory demo store; T-48 shoot-lock gate w/ audit |
| `calendars.finalApprove` | mock | mutation; in-memory demo store; gate transition w/ audit |
| `calendars.evaluateLock` | mock | query; in-memory demo store; shoot-lock evaluation |
| `calendars.escalations` | mock | query; in-memory demo store |

### `campaigns` — 8 procedures · `campaigns-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `campaigns.health` | partial | query; Postgres-or-memory via campaigns/repository |
| `campaigns.list` | partial | query; Postgres-or-memory |
| `campaigns.get` | partial | query; Postgres-or-memory |
| `campaigns.createDraft` | partial | mutation; Postgres-or-memory; gate transition + audit via repository |
| `campaigns.transition` | partial | mutation; Postgres-or-memory; approve-before-publish gate + audit via repository |
| `campaigns.pendingApproval` | partial | query; Postgres-or-memory |
| `campaigns.calendar` | partial | query; Postgres-or-memory |
| `campaigns.report` | partial | query; Postgres-or-memory |

### `clientPreview` — 2 procedures · `client-preview-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `clientPreview.workspace` | partial | query; DB+mem fallback via portal-data |
| `clientPreview.act` | partial | mutation; DB+mem fallback; audit via helper (portal-data) |

### `clients` — 11 procedures · `m3-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `clients.month1.get` | mock | query; in-memory demo store |
| `clients.month1.transition` | mock | mutation; in-memory demo store; gate transition w/ audit |
| `clients.list` | partial | query; DB+mem fallback |
| `clients.get` | partial | query; DB+mem fallback |
| `clients.create` | partial | mutation; DB+mem fallback; writes audit |
| `clients.portalUsers.list` | real | query; DB (drizzle) |
| `clients.portalUsers.invite` | real | mutation; DB (drizzle); writes audit |
| `clients.immersion.upsert` | mock | mutation; in-memory demo store; writes audit |
| `clients.immersion.get` | mock | query; in-memory demo store |
| `clients.onboarding.get` | mock | query; in-memory demo store |
| `clients.onboarding.signoff` | mock | mutation; in-memory demo store; writes audit |

### `connections` — 16 procedures · `connections-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `connections.list` | partial | query; DB+mem fallback |
| `connections.saveApiKey` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `connections.asanaStatus` | partial | query; external adapter (Composio) |
| `connections.workApps` | partial | query; DB+mem fallback |
| `connections.startWorkAppLink` | partial | mutation; DB+mem fallback; writes audit |
| `connections.disconnectWorkApp` | partial | mutation; DB+mem fallback; writes audit |
| `connections.managedToolkits` | partial | query; DB+mem fallback |
| `connections.managedAccounts` | real | query; DB required (throws w/o DATABASE_URL) |
| `connections.authorizeManaged` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `connections.disconnectManaged` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `connections.saveGoogleWorkspace` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `connections.startOAuth` | partial | mutation; DB+mem fallback; writes audit |
| `connections.disconnect` | partial | mutation; DB+mem fallback; writes audit |
| `connections.status` | mock | query; computed from env/config, no persistence |
| `connections.completeOAuth` | partial | mutation; DB+mem fallback; writes audit |
| `connections.canvaListDesigns` | mock | query; in-memory only |

### `conventions` — 2 procedures · `root.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `conventions.list` | partial | query; DB+mem fallback |
| `conventions.upsert` | partial | mutation; DB+mem fallback; writes audit |

### `coreHr` — 18 procedures · `core-hr-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `coreHr.employees` | real | query; DB required (throws w/o DATABASE_URL) |
| `coreHr.inviteEmployee` | real | mutation; DB required + Supabase auth invite; writes audit (raw audit_event insert) |
| `coreHr.profile.get` | real | query; DB required (throws w/o DATABASE_URL) |
| `coreHr.profile.update` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `coreHr.documents.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `coreHr.documents.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `coreHr.assets.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `coreHr.assets.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `coreHr.assets.assign` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `coreHr.assets.return` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `coreHr.lifecycle.templates` | real | query; DB required (throws w/o DATABASE_URL) |
| `coreHr.lifecycle.createTemplate` | real | mutation; DB required (throws w/o DATABASE_URL); no audit |
| `coreHr.lifecycle.start` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `coreHr.lifecycle.tasks` | real | query; DB required (throws w/o DATABASE_URL) |
| `coreHr.lifecycle.completeTask` | real | mutation; DB required (throws w/o DATABASE_URL); no audit |
| `coreHr.letters.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `coreHr.letters.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `coreHr.letters.updateStatus` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |

### `crm` — 23 procedures · `crm-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `crm.health` | partial | query; Postgres-or-memory via crm/repository |
| `crm.stages` | partial | query; Postgres-or-memory via crm/repository |
| `crm.companies.list` | partial | query; Postgres-or-memory |
| `crm.companies.get` | partial | query; Postgres-or-memory |
| `crm.companies.create` | partial | mutation; Postgres-or-memory; no audit |
| `crm.companies.update` | partial | mutation; Postgres-or-memory; no audit |
| `crm.contacts.list` | partial | query; Postgres-or-memory |
| `crm.contacts.get` | partial | query; Postgres-or-memory |
| `crm.contacts.create` | partial | mutation; Postgres-or-memory; no audit |
| `crm.contacts.update` | partial | mutation; Postgres-or-memory; no audit |
| `crm.deals.stages` | partial | query; Postgres-or-memory |
| `crm.deals.list` | partial | query; Postgres-or-memory |
| `crm.deals.get` | partial | query; Postgres-or-memory |
| `crm.deals.create` | partial | mutation; Postgres-or-memory; no audit |
| `crm.deals.update` | partial | mutation; Postgres-or-memory; no audit |
| `crm.deals.moveStage` | partial | mutation; Postgres-or-memory; gate transition (transition()) + writeAudit |
| `crm.activities.list` | partial | query; Postgres-or-memory |
| `crm.activities.create` | partial | mutation; Postgres-or-memory; no audit |
| `crm.notes.list` | partial | query; Postgres-or-memory |
| `crm.notes.create` | partial | mutation; Postgres-or-memory; no audit |
| `crm.tasks.list` | partial | query; Postgres-or-memory |
| `crm.tasks.create` | partial | mutation; Postgres-or-memory; no audit |
| `crm.tasks.update` | partial | mutation; Postgres-or-memory; no audit |

### `dashboards` — 6 procedures · `m4-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `dashboards.capacity` | mock | query; in-memory demo store |
| `dashboards.delivery` | mock | query; in-memory demo store |
| `dashboards.hrLifecycle` | mock | query; in-memory demo store |
| `dashboards.margin.list` | mock | query; in-memory demo store; margin permission gated |
| `dashboards.margin.get` | mock | query; in-memory demo store; margin permission gated |
| `dashboards.hub` | mock | query; in-memory demo store |

### `deals` — 14 procedures · `m3-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `deals.list` | mock | query; in-memory demo store only (legacy M3) |
| `deals.create` | mock | mutation; in-memory demo store; writes audit (demo) |
| `deals.get` | mock | query; in-memory demo store |
| `deals.update` | mock | mutation; in-memory demo store; no audit |
| `deals.margin` | mock | query; in-memory demo store |
| `deals.resetDemo` | dev-only | mutation; demo-store reset; no audit |
| `deals.buaf` | mock | mutation; in-memory demo store; BUAF gate + audit |
| `deals.verifyEmail` | mock | mutation; in-memory demo store; writes audit |
| `deals.voiceCheck` | mock | mutation; in-memory demo store; writes audit |
| `deals.transition` | mock | mutation; in-memory demo store; gate transition (transition()) w/ audit |
| `deals.close` | mock | mutation; in-memory demo store; gate transition w/ audit |
| `deals.quote` | mock | mutation; in-memory demo store; margin/discount gates + audit |
| `deals.discount` | mock | mutation; in-memory demo store; no audit |
| `deals.handoverPack` | mock | mutation; in-memory demo store; writes audit |

### `digitalCards` — 10 procedures · `digital-cards-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `digitalCards.publicBySlug` | real | query; DB (drizzle); public endpoint |
| `digitalCards.templates` | real | query; DB required (throws w/o DATABASE_URL) |
| `digitalCards.me.get` | real | query; DB required (throws w/o DATABASE_URL) |
| `digitalCards.me.upsert` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `digitalCards.me.revoke` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `digitalCards.admin.cards` | real | query; DB required (throws w/o DATABASE_URL) |
| `digitalCards.admin.setCardActive` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `digitalCards.admin.templates` | real | query; DB required (throws w/o DATABASE_URL) |
| `digitalCards.admin.upsertTemplate` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `digitalCards.admin.setTemplateActive` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |

### `employees` — 9 procedures · `m2-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `employees.list` | mock | query; in-memory demo store (M2) |
| `employees.get` | mock | query; in-memory demo store |
| `employees.acceptOffer` | mock | mutation; in-memory demo store; writes audit |
| `employees.lifecycle.transition` | mock | mutation; in-memory demo store; lifecycle gate transition w/ audit |
| `employees.runEscalationJob` | mock | mutation; in-memory demo store; writes audit |
| `employees.escalations` | mock | query; in-memory demo store |
| `employees.importBayzatCsv` | mock | mutation; in-memory demo store; writes audit |
| `employees.bayzatMirror` | mock | query; in-memory demo store |
| `employees.performanceReview` | mock | mutation; in-memory demo store; writes audit |

### `featureRequests` — 5 procedures · `feature-requests-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `featureRequests.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `featureRequests.create` | partial | mutation; DB+mem fallback; writes audit |
| `featureRequests.updatePrd` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `featureRequests.transition` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `featureRequests.voiceUrl` | partial | query; DB+mem fallback |

### `hrOperations` — 14 procedures · `hr-operations-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `hrOperations.policies.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `hrOperations.policies.save` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `hrOperations.balances.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `hrOperations.balances.set` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `hrOperations.requests.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `hrOperations.requests.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `hrOperations.requests.decide` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `hrOperations.requests.cancel` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `hrOperations.attendance.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `hrOperations.attendance.clockIn` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `hrOperations.attendance.clockOut` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `hrOperations.attendance.corrections.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `hrOperations.attendance.corrections.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `hrOperations.attendance.corrections.decide` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |

### `invoices` — 11 procedures · `m2-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `invoices.list` | mock | query; in-memory demo store (M2) |
| `invoices.proposals` | mock | query; in-memory demo store |
| `invoices.intake` | mock | mutation; in-memory demo store; writes audit |
| `invoices.intakeDecide` | mock | mutation; in-memory demo store; writes audit |
| `invoices.draft` | mock | mutation; in-memory demo store; writes audit |
| `invoices.draftRetainersForMonth` | mock | mutation; in-memory demo store; writes audit |
| `invoices.markPaidFromWebhook` | mock | mutation; in-memory demo store; writes audit |
| `invoices.approve` | mock | mutation; in-memory demo store; approve-before-issue gate w/ audit |
| `invoices.issue` | mock | mutation; in-memory demo store; TRN-hold gate w/ audit |
| `invoices.transition` | mock | mutation; in-memory demo store; gate transition w/ audit |
| `invoices.resetDemo` | dev-only | mutation; demo-store reset; no audit |

### `leadgen` — 9 procedures · `leadgen-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `leadgen.outreach.list` | mock | query; in-memory leadgen/store.ts (mock-first, no persistence) |
| `leadgen.outreach.get` | mock | query; in-memory leadgen/store.ts |
| `leadgen.outreach.draft` | mock | mutation; in-memory leadgen/store.ts; no audit |
| `leadgen.outreach.approve` | mock | mutation; in-memory leadgen/store.ts; gate transition (transition()) writes audit |
| `leadgen.outreach.send` | partial | mutation; in-memory store + external send adapter; gate transition writes audit |
| `leadgen.applyReplyIntent` | partial | mutation; Postgres-or-memory CRM update via reply-intent; no audit |
| `leadgen.competitor.scan` | mock | mutation; in-memory leadgen/store.ts; no audit |
| `leadgen.competitor.list` | mock | query; in-memory leadgen/store.ts |
| `leadgen.runDailyPipeline` | partial | mutation; Postgres-or-memory CRM via leadgen/pipeline; no audit |

### `leads` — 5 procedures · `m3-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `leads.inbound.create` | mock | mutation; in-memory demo store; no audit |
| `leads.apollo.import` | mock | mutation; in-memory demo store; no audit |
| `leads.tejari.scan` | mock | mutation; computed/hardcoded scan stub; no audit |
| `leads.nurture.enqueue` | mock | mutation; in-memory demo store; writes audit |
| `leads.ping` | mock | query; hardcoded ping |

### `m4` — 2 procedures · `m4-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `m4.reset` | dev-only | mutation; publicProcedure demo-store reset (M4); no audit |
| `m4.seedIds` | dev-only | query; publicProcedure demo seed-id lookup (M4) |

### `m5` — 1 procedures · `m5-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `m5.reset` | dev-only | mutation; publicProcedure demo-store reset (M5); no audit |

### `ops` — 2 procedures · `ops-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `ops.buildStatus` | mock | query; computed from build-status module, no persistence |
| `ops.overview` | partial | query; DB+mem fallback |

### `outreach` — 7 procedures · `m3-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `outreach.queue.list` | mock | query; in-memory demo store (M3) |
| `outreach.queue.draft` | mock | mutation; in-memory demo store; writes audit |
| `outreach.queue.approve` | mock | mutation; in-memory demo store; approve-before-send gate w/ audit |
| `outreach.queue.reject` | mock | mutation; in-memory demo store; writes audit |
| `outreach.killSwitch.set` | mock | mutation; in-memory demo store; no audit |
| `outreach.killSwitch.get` | mock | query; in-memory demo store |
| `outreach.replies.classify` | mock | mutation; computed/hardcoded classification; no audit |

### `payroll` — 6 procedures · `m2-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `payroll.runs.list` | mock | query; in-memory demo store (M2) |
| `payroll.runs.draft` | mock | mutation; in-memory demo store; writes audit |
| `payroll.runs.get` | mock | query; in-memory demo store |
| `payroll.runs.confirm` | mock | mutation; in-memory demo store; SoD gate w/ audit |
| `payroll.runs.approve` | mock | mutation; in-memory demo store; SoD gate w/ audit |
| `payroll.runs.post` | mock | mutation; in-memory demo store; gate transition w/ audit |

### `portal` — 19 procedures · `m6-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `portal.auth.magicLink` | mock | mutation; in-memory store; writes audit |
| `portal.auth.verify` | mock | mutation; in-memory store; writes audit |
| `portal.auth.session` | partial | query; DB+mem fallback via portal-data |
| `portal.work.projects.list` | partial | query; DB+mem fallback; portal actor scoped |
| `portal.work.projects.get` | partial | query; DB+mem fallback |
| `portal.work.comments.list` | partial | query; DB+mem fallback |
| `portal.work.comments.create` | partial | mutation; DB+mem fallback; writes audit |
| `portal.briefs.list` | partial | query; DB+mem fallback |
| `portal.tasks.list` | partial | query; DB+mem fallback |
| `portal.assets.list` | partial | query; DB+mem fallback |
| `portal.assets.signedUrl` | partial | mutation; DB+mem fallback; audit via helper (portal-data) |
| `portal.deliveries.list` | partial | query; DB+mem fallback |
| `portal.approvals.list` | partial | query; DB+mem fallback |
| `portal.approvals.act` | partial | mutation; DB+mem fallback; client-approver gate; audit via helper |
| `portal.reports.get` | partial | query; DB+mem fallback |
| `portal.financeProbe` | mock | query; hardcoded probe proving portal actors cannot see finance |
| `portal.campaignApprovals.list` | partial | query; Postgres-or-memory via campaigns/repository |
| `portal.campaignApprovals.approve` | partial | mutation; Postgres-or-memory; gate transition + audit via campaigns/repository |
| `portal.campaignApprovals.reject` | partial | mutation; Postgres-or-memory; gate transition + audit via campaigns/repository |

### `requisitions` — 3 procedures · `m2-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `requisitions.list` | mock | query; in-memory demo store (M2) |
| `requisitions.create` | mock | mutation; in-memory demo store; no audit |
| `requisitions.approve` | mock | mutation; in-memory demo store; writes audit |

### `scopes` — 4 procedures · `m3-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `scopes.create` | mock | mutation; in-memory demo store; no audit |
| `scopes.get` | mock | query; in-memory demo store |
| `scopes.update` | mock | mutation; in-memory demo store; no audit |
| `scopes.listByClient` | mock | query; in-memory demo store |

### `seams` — 2 procedures · `m6-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `seams.list` | mock | query; in-memory demo store (seams) |
| `seams.drive` | mock | mutation; in-memory demo store; audit via helper (seams) |

### `shiftsTimesheets` — 19 procedures · `shifts-timesheets-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `shiftsTimesheets.templates.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `shiftsTimesheets.templates.save` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.shifts.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `shiftsTimesheets.shifts.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.shifts.transition` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.assignments.assign` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.assignments.respond` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.changes.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `shiftsTimesheets.changes.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.changes.decide` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.projects.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `shiftsTimesheets.projects.save` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.entries.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `shiftsTimesheets.entries.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.entries.update` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.entries.remove` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.entries.submit` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.entries.decide` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `shiftsTimesheets.entries.summary` | real | query; DB required (throws w/o DATABASE_URL) |

### `talent` — 27 procedures · `talent-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `talent.requisitions.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `talent.requisitions.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.requisitions.transition` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.candidates.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `talent.candidates.history` | real | query; DB required (throws w/o DATABASE_URL) |
| `talent.candidates.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.candidates.move` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.interviews.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `talent.interviews.schedule` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.interviews.recordOutcome` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.offers.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `talent.offers.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.offers.transition` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.performance.cycles.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `talent.performance.cycles.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.performance.cycles.transition` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.performance.goals.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `talent.performance.goals.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.performance.goals.update` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.performance.reviews.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `talent.performance.reviews.upsert` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.performance.reviews.acknowledge` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.surveys.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `talent.surveys.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.surveys.transition` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.surveys.respond` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `talent.surveys.results` | real | query; DB required (throws w/o DATABASE_URL) |

### `tasks` — 7 procedures · `m4-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `tasks.list` | mock | query; in-memory demo store (M4) |
| `tasks.get` | mock | query; in-memory demo store |
| `tasks.create` | mock | mutation; in-memory demo store; writes audit |
| `tasks.assign` | mock | mutation; in-memory demo store; writes audit |
| `tasks.transition` | mock | mutation; in-memory demo store; task gate transition w/ audit |
| `tasks.setSituational` | mock | mutation; in-memory demo store; no audit |
| `tasks.qc` | mock | mutation; in-memory demo store; QC gate w/ audit |

### `tickets` — 9 procedures · `tickets-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `tickets.health` | mock | query; module-level Map store (memory stub until 0004_tickets) |
| `tickets.list` | mock | query; module-level Map store |
| `tickets.get` | mock | query; module-level Map store |
| `tickets.create` | mock | mutation; module-level Map store; no audit |
| `tickets.update` | mock | mutation; module-level Map store; no audit |
| `tickets.addComment` | mock | mutation; module-level Map store; no audit |
| `tickets.aiTriage` | mock | mutation; module-level Map store; no audit |
| `tickets.aiDraftReply` | mock | mutation; module-level Map store; no audit |
| `tickets.approveAiDraft` | mock | mutation; module-level Map store; no audit |

### `vat` — 5 procedures · `m5-routers.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `vat.docs.list` | mock | query; in-memory demo store (M5) |
| `vat.docs.markRead` | mock | mutation; in-memory demo store; writes audit |
| `vat.close` | mock | mutation; in-memory demo store; unread-docs gate w/ audit |
| `vat.return.prepare` | mock | mutation; in-memory demo store; gate transition w/ audit |
| `vat.return.sign` | mock | mutation; in-memory demo store; gate transition w/ audit |

### `work` — 154 procedures · `work-management-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `work.projects.list` | partial | query; DB+mem fallback (getDemoWork) |
| `work.projects.get` | partial | query; DB+mem fallback |
| `work.projects.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.projects.archive` | partial | mutation; DB+mem fallback; writes audit |
| `work.sections.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.sections.update` | partial | mutation; DB+mem fallback; writes audit |
| `work.tasks.get` | partial | query; DB+mem fallback |
| `work.tasks.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.tasks.update` | partial | mutation; DB+mem fallback; writes audit |
| `work.tasks.archive` | partial | mutation; DB+mem fallback; writes audit |
| `work.tasks.complete` | partial | mutation; DB+mem fallback; writes audit |
| `work.tasks.move` | partial | mutation; DB+mem fallback; writes audit |
| `work.tasks.addToProject` | partial | mutation; DB+mem fallback; writes audit |
| `work.comments.list` | partial | query; DB+mem fallback |
| `work.comments.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.dependencies.add` | partial | mutation; DB+mem fallback; writes audit |
| `work.dependencies.remove` | partial | mutation; DB+mem fallback; writes audit |
| `work.followers.list` | partial | query; DB+mem fallback |
| `work.followers.follow` | partial | mutation; DB+mem fallback; writes audit |
| `work.followers.unfollow` | partial | mutation; DB+mem fallback; writes audit |
| `work.messages.teams` | real | query; DB (drizzle) |
| `work.messages.list` | partial | query; DB+mem fallback |
| `work.messages.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.messages.comments` | partial | query; DB+mem fallback |
| `work.messages.comment` | partial | mutation; DB+mem fallback; writes audit |
| `work.messages.setFollowing` | partial | mutation; DB+mem fallback; no audit |
| `work.likes.summary` | partial | query; DB+mem fallback |
| `work.likes.set` | partial | mutation; DB+mem fallback; writes audit |
| `work.tags.list` | partial | query; DB+mem fallback |
| `work.tags.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.tags.setForTask` | partial | mutation; DB+mem fallback; writes audit |
| `work.tags.forTask` | partial | query; DB+mem fallback |
| `work.customTaskTypes.list` | partial | query; DB+mem fallback |
| `work.customTaskTypes.access` | partial | query; DB+mem fallback |
| `work.customTaskTypes.setDefaultAccess` | partial | mutation; DB+mem fallback; writes audit |
| `work.customTaskTypes.setMemberAccess` | partial | mutation; DB+mem fallback; writes audit |
| `work.customTaskTypes.assignments` | partial | query; DB+mem fallback |
| `work.customTaskTypes.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.customTaskTypes.update` | partial | mutation; DB+mem fallback; writes audit |
| `work.customTaskTypes.share` | partial | mutation; DB+mem fallback; writes audit |
| `work.customTaskTypes.removeFromProject` | partial | mutation; DB+mem fallback; writes audit |
| `work.customTaskTypes.setDefault` | partial | mutation; DB+mem fallback; writes audit |
| `work.customTaskTypes.setForTask` | partial | mutation; DB+mem fallback; writes audit |
| `work.customFields.list` | partial | query; DB+mem fallback |
| `work.customFields.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.customFields.values` | partial | query; DB+mem fallback |
| `work.customFields.setValue` | partial | mutation; DB+mem fallback; writes audit |
| `work.attachments.list` | partial | query; DB+mem fallback |
| `work.attachments.listProject` | partial | query; DB+mem fallback |
| `work.attachments.addLink` | partial | mutation; DB+mem fallback; writes audit |
| `work.attachments.upload` | partial | mutation; DB+mem fallback; writes audit |
| `work.attachments.open` | partial | mutation; DB+mem fallback; no audit |
| `work.attachments.remove` | partial | mutation; DB+mem fallback; writes audit |
| `work.proofing.list` | partial | query; DB+mem fallback |
| `work.proofing.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.recurrence.set` | partial | mutation; DB+mem fallback; writes audit |
| `work.personal.quickAdd` | partial | mutation; DB+mem fallback; writes audit |
| `work.personal.focus.get` | partial | query; DB+mem fallback |
| `work.personal.focus.save` | partial | mutation; DB+mem fallback; writes audit |
| `work.personal.myTaskSections.list` | partial | query; DB+mem fallback |
| `work.personal.myTaskSections.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.personal.myTaskSections.rename` | partial | mutation; DB+mem fallback; writes audit |
| `work.personal.myTaskSections.remove` | partial | mutation; DB+mem fallback; writes audit |
| `work.personal.myTaskSections.reorder` | partial | mutation; DB+mem fallback; writes audit |
| `work.personal.myTaskSections.moveTask` | partial | mutation; DB+mem fallback; writes audit |
| `work.personal.myTasks` | partial | query; DB+mem fallback |
| `work.personal.inbox` | partial | query; DB+mem fallback |
| `work.personal.markNotification` | partial | mutation; DB+mem fallback; no audit |
| `work.personal.search` | partial | query; DB+mem fallback |
| `work.personal.savedSearches` | partial | query; DB+mem fallback |
| `work.personal.saveSearch` | partial | mutation; DB+mem fallback; writes audit |
| `work.personal.deleteSearch` | partial | mutation; DB+mem fallback; no audit |
| `work.forms.list` | partial | query; DB+mem fallback |
| `work.forms.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.forms.setAccess` | partial | mutation; DB+mem fallback; writes audit |
| `work.forms.setActive` | partial | mutation; DB+mem fallback; writes audit |
| `work.forms.submit` | partial | mutation; DB+mem fallback; writes audit |
| `work.forms.publicView` | partial | query; DB+mem fallback; public endpoint |
| `work.forms.publicSubmit` | partial | mutation; DB+mem fallback; writes audit; public endpoint |
| `work.rules.list` | partial | query; DB+mem fallback |
| `work.rules.owners` | partial | query; DB+mem fallback |
| `work.rules.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.rules.transferOwnership` | partial | mutation; DB+mem fallback; writes audit |
| `work.rules.setEnabled` | partial | mutation; DB+mem fallback; writes audit |
| `work.rules.runs` | partial | query; DB+mem fallback |
| `work.templates.list` | partial | query; DB+mem fallback |
| `work.templates.createTask` | partial | mutation; DB+mem fallback; writes audit |
| `work.templates.captureProject` | partial | mutation; DB+mem fallback; writes audit |
| `work.templates.instantiateTask` | partial | mutation; DB+mem fallback; writes audit |
| `work.templates.instantiateProject` | partial | mutation; DB+mem fallback; writes audit |
| `work.bundles.list` | partial | query; DB+mem fallback |
| `work.bundles.capture` | partial | mutation; DB+mem fallback; writes audit |
| `work.bundles.publish` | partial | mutation; DB+mem fallback; writes audit |
| `work.bundles.applyToProject` | partial | mutation; DB+mem fallback; writes audit |
| `work.approvals.list` | partial | query; DB+mem fallback |
| `work.approvals.convert` | partial | mutation; DB+mem fallback; writes audit |
| `work.approvals.decide` | partial | mutation; DB+mem fallback; writes audit |
| `work.approvals.reopen` | partial | mutation; DB+mem fallback; writes audit |
| `work.goals.list` | partial | query; DB+mem fallback |
| `work.goals.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.goals.update` | partial | mutation; DB+mem fallback; writes audit |
| `work.goals.links` | partial | query; DB+mem fallback |
| `work.goals.link` | partial | mutation; DB+mem fallback; writes audit |
| `work.goals.unlink` | partial | mutation; DB+mem fallback; no audit |
| `work.goals.archive` | partial | mutation; DB+mem fallback; writes audit |
| `work.portfolios.list` | partial | query; DB+mem fallback |
| `work.portfolios.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.portfolios.addProject` | partial | mutation; DB+mem fallback; writes audit |
| `work.portfolios.removeProject` | partial | mutation; DB+mem fallback; no audit |
| `work.portfolios.archive` | partial | mutation; DB+mem fallback; writes audit |
| `work.statusTemplates.list` | partial | query; DB+mem fallback |
| `work.statusTemplates.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.statusTemplates.update` | partial | mutation; DB+mem fallback; writes audit |
| `work.statusTemplates.archive` | partial | mutation; DB+mem fallback; writes audit |
| `work.statusUpdates.list` | partial | query; DB+mem fallback |
| `work.statusUpdates.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.reporting.summary` | partial | query; DB+mem fallback |
| `work.reporting.numericFields` | partial | query; DB+mem fallback |
| `work.reporting.chart` | partial | query; DB+mem fallback |
| `work.reporting.portfolioChart` | partial | query; DB+mem fallback |
| `work.reporting.allProjectsChart` | partial | query; DB+mem fallback |
| `work.reporting.dashboards` | partial | query; DB+mem fallback |
| `work.reporting.combineDashboards` | partial | mutation; delegates via caller to reporting.saveDashboard (DB+mem fallback); no direct audit |
| `work.reporting.renderDashboard` | partial | query; delegates via caller to reporting.dashboards (DB+mem fallback) |
| `work.reporting.saveDashboard` | partial | mutation; DB+mem fallback; writes audit |
| `work.reporting.shareDashboard` | partial | mutation; DB+mem fallback; writes audit |
| `work.reporting.deleteDashboard` | partial | mutation; DB+mem fallback; no audit |
| `work.reporting.exportProject` | partial | query; DB+mem fallback |
| `work.workload.list` | partial | query; DB+mem fallback |
| `work.workload.portfolio` | partial | query; DB+mem fallback |
| `work.workload.upsert` | partial | mutation; DB+mem fallback; writes audit |
| `work.budgets.summary` | partial | query; DB+mem fallback |
| `work.budgets.rates` | partial | query; DB+mem fallback |
| `work.budgets.setRate` | partial | mutation; DB+mem fallback; writes audit |
| `work.budgets.update` | partial | mutation; DB+mem fallback; writes audit |
| `work.time.list` | partial | query; DB+mem fallback |
| `work.time.log` | partial | mutation; DB+mem fallback; writes audit |
| `work.time.update` | partial | mutation; DB+mem fallback; writes audit |
| `work.time.remove` | partial | mutation; DB+mem fallback; writes audit |
| `work.time.activeTimer` | partial | query; DB+mem fallback |
| `work.time.startTimer` | partial | mutation; DB+mem fallback; no audit |
| `work.time.stopTimer` | partial | mutation; DB+mem fallback; writes audit |
| `work.time.discardTimer` | partial | mutation; DB+mem fallback; writes audit |
| `work.gantt.get` | partial | query; DB+mem fallback |
| `work.gantt.captureBaseline` | partial | mutation; DB+mem fallback; writes audit |
| `work.accessibility.get` | partial | query; DB+mem fallback |
| `work.accessibility.update` | partial | mutation; DB+mem fallback; writes audit |
| `work.outOfOffice.list` | partial | query; DB+mem fallback |
| `work.outOfOffice.create` | partial | mutation; DB+mem fallback; writes audit |
| `work.outOfOffice.update` | partial | mutation; DB+mem fallback; writes audit |
| `work.outOfOffice.remove` | partial | mutation; DB+mem fallback; writes audit |
| `work.members.listTeams` | real | query; DB (drizzle) |
| `work.members.listEmployees` | partial | query; DB+mem fallback |
| `work.members.upsert` | partial | mutation; DB+mem fallback; writes audit |

### `workAdmin` — 38 procedures · `work-admin-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `workAdmin.directory` | partial | query; DB+mem fallback (demoTeams/demoRoles Maps) |
| `workAdmin.policy.get` | partial | query; DB+mem fallback |
| `workAdmin.policy.save` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.teams.list` | partial | query; DB+mem fallback |
| `workAdmin.teams.create` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.teams.setMessagePermission` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.teams.update` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.teams.archive` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.teams.setMember` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.teams.setProject` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.guests.list` | partial | query; DB+mem fallback |
| `workAdmin.guests.invite` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.guests.setAccess` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.guests.revoke` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.members.list` | partial | query; DB+mem fallback |
| `workAdmin.members.setLicense` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.rbac.list` | partial | query; DB+mem fallback |
| `workAdmin.rbac.createRole` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.rbac.updateRole` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.rbac.setPermission` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.rbac.setMember` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.identity.get` | partial | query; DB+mem fallback |
| `workAdmin.identity.saveSso` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.identity.issueScimToken` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.identity.revokeScimToken` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.apiWebhooks.get` | partial | query; DB+mem fallback |
| `workAdmin.apiWebhooks.issueToken` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.apiWebhooks.revokeToken` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.apiWebhooks.createWebhook` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.apiWebhooks.deleteWebhook` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.aiGovernance.get` | partial | query; DB+mem fallback |
| `workAdmin.aiGovernance.save` | partial | mutation; DB+mem fallback; writes audit |
| `workAdmin.sandboxes.get` | real | query; DB (drizzle) via work-sandbox |
| `workAdmin.sandboxes.activate` | real | mutation; DB (drizzle); writes audit |
| `workAdmin.sandboxes.verify` | real | mutation; DB (drizzle); writes audit |
| `workAdmin.sandboxes.delete` | real | mutation; DB (drizzle); writes audit |
| `workAdmin.export.audit` | partial | query; DB+mem fallback |
| `workAdmin.export.organization` | partial | query; DB+mem fallback |

### `workAi` — 4 procedures · `work-ai-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `workAi.history` | partial | query; DB+mem fallback via work-ai module |
| `workAi.generate` | partial | mutation; DB+mem fallback; audit via helper (work-ai) |
| `workAi.reject` | partial | mutation; DB+mem fallback; writes audit |
| `workAi.applyAction` | partial | mutation; DB+mem fallback; writes audit |

### `workAiStudio` — 7 procedures · `work-ai-studio-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `workAiStudio.list` | partial | query; DB+mem fallback via work-ai-studio module |
| `workAiStudio.create` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiStudio.update` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiStudio.setStatus` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiStudio.archive` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiStudio.draft` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiStudio.run` | partial | mutation; DB+mem fallback; audit via helper |

### `workAiTeammates` — 20 procedures · `work-ai-teammates-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `workAiTeammates.list` | partial | query; DB+mem fallback via work-ai-teammates module |
| `workAiTeammates.directory` | partial | query; DB+mem fallback |
| `workAiTeammates.create` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.update` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.setStatus` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.archive` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.run` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.members.list` | partial | query; DB+mem fallback |
| `workAiTeammates.members.set` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.members.remove` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.projects.list` | partial | query; DB+mem fallback |
| `workAiTeammates.projects.set` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.projects.remove` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.skills.list` | partial | query; DB+mem fallback |
| `workAiTeammates.skills.save` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.skills.delete` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.memory.list` | partial | query; DB+mem fallback |
| `workAiTeammates.memory.forget` | partial | mutation; DB+mem fallback; audit via helper |
| `workAiTeammates.activity.list` | partial | query; DB+mem fallback |
| `workAiTeammates.activity.interrupt` | partial | mutation; DB+mem fallback; audit via helper |

### `workforcePayroll` — 15 procedures · `payroll-v2-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `workforcePayroll.salary.current` | real | query; DB required (throws w/o DATABASE_URL) |
| `workforcePayroll.salary.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.expenses.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `workforcePayroll.expenses.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.expenses.decide` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.loans.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `workforcePayroll.loans.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.loans.decide` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.runs.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `workforcePayroll.runs.draft` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.runs.confirm` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.runs.approve` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.runs.markPosted` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.runs.recordWpsValidation` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workforcePayroll.payslips.list` | real | query; DB required (throws w/o DATABASE_URL) |

### `workplace` — 21 procedures · `workplace-router.ts`

| Procedure | Status | Note |
|-----------|--------|------|
| `workplace.announcements.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `workplace.announcements.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.announcements.setStatus` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.announcements.acknowledge` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.knowledge.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `workplace.knowledge.get` | real | query; DB required (throws w/o DATABASE_URL) |
| `workplace.knowledge.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.knowledge.addVersion` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.knowledge.publish` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.knowledge.acknowledge` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.workflows.definitions` | real | query; DB required (throws w/o DATABASE_URL) |
| `workplace.workflows.createDefinition` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.workflows.runs` | real | query; DB required (throws w/o DATABASE_URL) |
| `workplace.workflows.start` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.workflows.steps` | real | query; DB required (throws w/o DATABASE_URL) |
| `workplace.workflows.updateStep` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.serviceRequests.types` | real | query; DB required (throws w/o DATABASE_URL) |
| `workplace.serviceRequests.createType` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.serviceRequests.list` | real | query; DB required (throws w/o DATABASE_URL) |
| `workplace.serviceRequests.create` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |
| `workplace.serviceRequests.updateStatus` | real | mutation; DB required (throws w/o DATABASE_URL); writes audit |

### `m6` — empty router (dead)

- `m6-demo-empty-router` — dead — m6DemoRouter registered at appRouter.m6 but is router({}) with zero procedures; no unregistered router files exist on disk — all 34 router files are wired into appRouter
