# Phase 1 — Baseline route-and-action acceptance inventory

This folder is the **Phase 1 deliverable** for hrmny-os: a complete, evidence-backed catalogue of every route, API procedure, job, integration, table, mock surface, dead control, and known defect in the codebase. It is the acceptance baseline the later phases (2–8) are measured against — in particular it **is** the Phase 7 hardening work-list.

## Baseline

- **Commit:** `be160d3` — the state adopted as the governing production baseline in PR #18 (`docs: adopt PLAN-PRODUCTION as governing production plan`).
- **Method:** 9 parallel inventory agents ran 8 structured sweeps over `apps/web`, `packages/*`, migrations, and docs, plus a critique pass that hunted for surfaces the sweeps missed. Raw structured result: `sweeps[] of {key, items[]}` + `critique[]`.
- **Scope note:** the `api` sweep counts **tRPC procedures only** (637 verified `.query`/`.mutation`). Non-tRPC handlers (SCIM, MCP, Work REST, webhooks, cron) are catalogued via the critique pass in [INTEGRATIONS.md](./INTEGRATIONS.md) and [DEFECTS.md](./DEFECTS.md).

## Headline counts

| Dimension | Total | Breakdown |
|-----------|------:|-----------|
| Routes | 69 | real 61 · mock 2 · dev-only 1 · dead 5 · **9 orphaned** real routes |
| tRPC procedures | 637 | partial 316 · real 192 · mock 123 · dev-only 6 · dead 1 (+1 empty router) across 48 namespaces |
| Unregistered routers | 5 | scorecards, ai-policy, people-recon (on disk, dark) + reports, portal-feedback (planned) |
| Integrations | 20 | real 3 · partial 8 · mock 8 · dead 1 |
| Jobs / automations | 20 | real 11 · partial 4 · dev-only 3 · dead 1 · mock 1 |
| Data (tables + stores) | 32 | real 14 · partial 7 · mock 6 · dead 4 · dev-only 1 |
| Mock surfaces | 48 | mock 32 · dev-only 16 |
| Dead controls | 13 | dead 4 · mock 3 · real 3 · dev-only 2 · partial 1 |
| **Kill-list (Phase 7)** | **61** | mock-surfaces + dead-controls; 59 action items |
| Defects | 42 | **P0 0 · P1 22 · P2 15 · P3 5** (41 from the `be160d3` sweep + 1 post-baseline crawler finding) |
| Critique findings | 19 | inventory gaps + latent security/trust-boundary defects |

## Files

| File | What it is |
|------|-----------|
| [ROUTES.md](./ROUTES.md) | All 69 routes (path, status, backing, nav-reachability) + orphaned-routes and dead/legacy sections. |
| [API-SURFACE.md](./API-SURFACE.md) | 637 tRPC procedures grouped by router + the unregistered router modules + non-tRPC handlers. |
| [KILL-LIST.md](./KILL-LIST.md) | The Phase 7 work-list: every mock/dev/dead surface with a proposed disposition (wire-to-real / hide-behind-flag / delete). |
| [DEFECTS.md](./DEFECTS.md) | Known defects & risks P0–P3 + the critique pass (latent security/coverage items). |
| [INTEGRATIONS.md](./INTEGRATIONS.md) | Integration live-readiness table + jobs/crons/automations + non-tRPC HTTP handlers. |
| [DATA.md](./DATA.md) | Tables, migrations, and the in-memory stores that back production routers. |

## How to use this

- **Phase 7 hardening:** work [KILL-LIST.md](./KILL-LIST.md) top to bottom; each row has a disposition. Cross-reference [ROUTES.md](./ROUTES.md) orphans and [DATA.md](./DATA.md) stores.
- **Launch readiness:** [DEFECTS.md](./DEFECTS.md) P1s are the controlled-launch blockers; P0 is empty in the sweep but triage the critique latent-defects list.
- **Wiring the dark routers:** [API-SURFACE.md](./API-SURFACE.md) → "Unregistered router modules" is the batched-wiring-PR checklist.
- **Re-baselining:** after each phase, re-run the sweeps and diff against these tables; the route/action crawler (PR #22) gates the manifest.

## Delta since baseline (`be160d3`)

This inventory was captured at `be160d3`. **PRs #19–#25 merged to `main` after the baseline snapshot** and are therefore **not** reflected in the tables above (except where explicitly called out, e.g. the unregistered routers and the one post-baseline crawler defect). Re-run the sweeps to fold them in.

| PR | Title |
|----|-------|
| #18 | docs: adopt PLAN-PRODUCTION as governing production plan (baseline `be160d3`) |
| #19 | feat(scorecards): explainable ratings vertical slice (migration 0062) — adds unregistered `scorecardsRouter` |
| #20 | feat(people): parallel-payroll reconciliation + Bayzat retirement gates — adds unregistered `peopleReconRouter` |
| #21 | feat(ai): autonomy governance layer (manual default + scheduled_research) — adds unregistered `aiPolicyRouter` |
| #22 | test(web): route-and-action acceptance crawler + manifest gate — surfaced defect `portal-staff-soft-boundary` (see DEFECTS.md) |
| #23 | feat(portal): consolidated proofing feedback threads on campaign approvals (migration 0063) — portal-feedback surface |
| #24 | feat(reports): scheduled reporting engine (schedules, registry, runner, Resend) — realises the planned `reports` surface |
| #25 | feat(portal): invite-only magic-link client access (feature-flagged) — moves portal auth toward the `gap-live-auth-rls` fix |

> These add new surfaces (scorecards, reconciliation, AI-policy, portal feedback, scheduled reports, magic-link portal auth) and a crawler/manifest gate; the unregistered routers from #19–#21 are documented in [API-SURFACE.md](./API-SURFACE.md), and the crawler finding from #22 is filed as P1 `portal-staff-soft-boundary` in [DEFECTS.md](./DEFECTS.md). All other tables reflect `be160d3` exactly.

## Current-state re-audit (2026-08-27)

The tables above remain the `be160d3` baseline. A full current-HEAD audit — official-docs verification, two-sided bridges, human gates, and delivery scores — lives in [docs/audits/2026-08-27-os-completion/](../audits/2026-08-27-os-completion/README.md).

Material deltas since this inventory (do not treat the baseline tables as current):

- Scorecards, AI policy, people recon, and reports routers **are registered** on `appRouter`.
- `/api/inbound/lead` exists; n8n HMAC verification is constant-time.
- Connection health reads `connections.list` (no hardcoded `MOCK_PROVIDERS`).
- Portal actors are redirected out of staff chrome in `StaffShell`.
- Xero + Composio webhook receivers and recon cron sweepers landed in the 2026-08-27 completion PR.
