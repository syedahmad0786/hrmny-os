# hrmny OS — Automation Inventory

Rule (MASTER-PLAN-V2 cross-cutting): every operational automation is built and **tested** in one of the engines below, listed here, and its failure path alerts Google Chat. No untested automation reaches prod.

## GitHub Actions (repo-native schedules)

| Workflow | Trigger | What it does | Tested via | Status |
|---|---|---|---|---|
| `ci.yml` | push/PR | typecheck → test → build (merge arbiter) | every PR | ✅ live |
| `scheduler.yml` | cron */5 min + dispatch | curls `/api/cron/jobs` with `HRMNY_CRON_SECRET` (durable jobs) | dispatch + prod alert evidence | ✅ live |
| `nightly-eval.yml` | cron 01:30 UTC + dispatch | agent eval harness (`@hrmny/ai` golden cases); mock provider now, flips to live automatically when `OPENROUTER_API_KEY` secret is set | workflow_dispatch run | ✅ tested (mock) |

## Inngest (long-running AI pipelines — code-owned)

| Job | Milestone | Status |
|---|---|---|
| Daily lead-gen pipeline (`runDailyLeadGen`) | M8 | built mock-first; activation blocked on `INNGEST_*` keys |
| Competitor scan | M8 | built mock-first; same |
| Weekly agency report | M10 | assembly built; scheduling blocked on `INNGEST_*` keys |

## n8n (`hrmny.app.n8n.cloud` — external-event glue)

Blocked on the hrmny n8n Cloud API key (CREDENTIALS-NEEDED.md Tier 3 #11). Planned first workflows, to be built + tested with pinned executions before `N8N_ALLOW_PRODUCTION_TRIGGER` flips:

1. Lead-source webhook ingestion → OS inbound endpoint
2. Google Chat notification fan-out (job failures, cap alerts)
3. Client-facing nurture sequence trigger (consumes M8 send infra, HITL-gated)

Do not build hrmny workflows in any personal n8n tenant.
