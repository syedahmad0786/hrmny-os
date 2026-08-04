# CRM-BUILD-TRACKER — Production AI CRM slice

**Started:** 2026-08-04 · **Orchestrator:** Claude Code (session eaac73b3) · **Governing plan:** PLAN-PRODUCTION.md Phase 3 (revenue engine) · **Baseline:** main @ 3b3c65d, 328/328 tests green.

Tracking mirror: GitHub milestone **"AI CRM Production"** on syedahmad0786/hrmny-os — one issue per workstream below. Status here is updated as PRs merge.

## Scope

Make the CRM surface production-ready per PLAN-PRODUCTION quality bars: every control wired, every mutation validated + authorized + audited, durable storage, HITL on all external sends, AI advisory-only. Single-tenant, ~25 staff.

## Workstreams

| ID | Workstream | Slice | Status |
|----|-----------|-------|--------|
| W1 ([#40](https://github.com/syedahmad0786/hrmny-os/issues/40)) | Durable leadgen/outreach/campaign stores | Bind in-memory `server/leadgen/store.ts` + campaigns store to existing tables 0059/0060/0061 via the proven `withDb` seam (fixes P2 `ledger-inert-leadgen-stores`) | ⬜ pending |
| W2 ([#41](https://github.com/syedahmad0786/hrmny-os/issues/41)) | CRM audit completeness | `writeAudit` on every `crm.*` mutation (companies/contacts/deals/activities/notes/tasks create+update) | ⬜ pending |
| W3 ([#42](https://github.com/syedahmad0786/hrmny-os/issues/42)) | Quote persistence | `crm_quote` table (migration **0066**), save/list/version procedures, wire `/crm/quote`, discount-tier gate | ⬜ pending |
| W4 ([#43](https://github.com/syedahmad0786/hrmny-os/issues/43)) | Merge & dedupe | Duplicate detection (email exact, company domain/name fuzzy) + gated merge procedures + UI on contacts/companies | ⬜ pending |
| W5 ([#44](https://github.com/syedahmad0786/hrmny-os/issues/44)) | Global CRM search | Server-side search across companies/contacts/deals (ILIKE; 25-user scale) + omni-search UI in CRM layout | ⬜ pending |
| W6 ([#45](https://github.com/syedahmad0786/hrmny-os/issues/45)) | CSV import/export | Export for companies/contacts/deals; import with validation + dedupe for companies/contacts | ⬜ pending |
| W7 ([#46](https://github.com/syedahmad0786/hrmny-os/issues/46)) | Retire mock outreach/inbound | Point `/crm/outreach` at gated `leadgen.outreach.*` (real HITL engine); rewrite `/crm/inbound` to create real `crm.*` records; fix market-select bug | ⬜ pending |
| W8 ([#47](https://github.com/syedahmad0786/hrmny-os/issues/47)) | Pipeline board upgrade | Drag-drop kanban calling gated `crm.deals.moveStage`; remove hardcoded demo client | ⬜ pending |
| W9 ([#48](https://github.com/syedahmad0786/hrmny-os/issues/48)) | AI CRM features | `crm-summary` + `next-best-action` agents (registry, HITL drafts-only), `crmAi` router: deal summary, account summary, next-best-action, BUAF re-score, outreach draft surfacing; AI panel on deal detail | ⬜ pending |
| W10 ([#49](https://github.com/syedahmad0786/hrmny-os/issues/49)) | Forecast & CRM reporting | Weighted-pipeline forecast + win/loss + stage-conversion procedures on real CRM data; dashboard widgets on `/crm` | ⬜ pending |
| W11 ([#50](https://github.com/syedahmad0786/hrmny-os/issues/50)) | Reminders & next steps | Due/overdue `crm_task` digest via existing cron route + Google Chat webhook; owner nudges | ⬜ pending |
| W12 ([#51](https://github.com/syedahmad0786/hrmny-os/issues/51)) | Wiring, verification, deploy | Orchestrator: root.ts wiring, migration journal, manifest gate, full local test+build (CI dead on billing), PR merge, prod migration 0066, Vercel API deploy, smoke test | ⬜ pending |

## Rules honored

- Migration slots orchestrator-assigned; **0066 = crm_quote** (journal order == sorted filename order; 0057 stays retired).
- Workstream agents deliver importable modules; only the orchestrator touches `root.ts`, `trpc.ts`, migration numbering, and git.
- No autonomous external sends — outreach remains draft → gate-approved → send (HITL), per MASTER-PLAN-V2 "AI proposes; the gate disposes."
- Margin redaction (`redactDealMargin`) preserved in all new read paths; new tables get RLS + REVOKE boilerplate.
- Portal actors never see `crm.*` (staffProcedure); nothing new merges outside `portal.*` for portal.

## Deferred (documented, non-blocking per PLAN-PRODUCTION §launch)

- Inbound **email → activity logging** (needs mail ingestion infra; Resend has no verified domain yet) — tracked as [#52](https://github.com/syedahmad0786/hrmny-os/issues/52), not in this build.
- Attachments on CRM records (DAM link) — Phase 4 concern.
- DocuSign/proposal e-sign — needs vendor decision + keys.
- Deal-stage admin config UI — stages stay code-defined in `gates/deal.ts` (gate engine is the source of truth; config UI would bypass gate review).
- pg_trgm fuzzy-search index — ILIKE is adequate at 25 users; revisit at >10k contacts.
