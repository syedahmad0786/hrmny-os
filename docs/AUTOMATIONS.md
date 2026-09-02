# hrmny OS — Automation Inventory

Rule (MASTER-PLAN-V2 cross-cutting): every operational automation is built and **tested** in one of the engines below, listed here, and its failure path alerts Google Chat. No untested automation reaches prod.

## GitHub Actions (repo-native schedules)

| Workflow                    | Trigger                   | What it does                                                                                                                    | Tested via                                         | Status           |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------- |
| `ci.yml`                    | push/PR                   | typecheck → test → build (merge arbiter)                                                                                        | every PR                                           | ✅ live          |
| `scheduler.yml`             | cron */5 min + dispatch   | curls `/api/cron/jobs` with `HRMNY_CRON_SECRET` (durable jobs)                                                                  | dispatch + prod alert evidence                     | ✅ live          |
| `nightly-eval.yml`          | cron 01:30 UTC + dispatch | deterministic agent eval harness (`@hrmny/ai` golden cases); always mock and live-network denied                                | workflow_dispatch run                              | ✅ tested (mock) |
| `openrouter-live-smoke.yml` | manual dispatch only      | separately approved one-call free-route provider canary                                                                         | provider readback + workflow receipt               | ⛔ human gate    |
| `demo-os-live-proof.yml`    | manual dispatch only      | proves legacy bulk/demo Sales effects remain disabled on one allowlisted disposable Supabase target; production ref hard-denied | target guard + zero-provider containment assertion | ⛔ human gate    |

## Inngest (long-running AI pipelines — code-owned)

| Job                                       | Milestone | Status                                                                                                                                 |
| ----------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Daily Sales policy gate                   | M8        | scheduled entrypoint records a local refusal when policy denies; an allowlisted policy still stops with `proposal_runtime_unavailable` |
| Legacy daily lead-gen (`runDailyLeadGen`) | M8        | synthetic-only compatibility fixture; direct service, router, and agent entrypoints fail closed elsewhere                              |
| Competitor scan                           | M8        | built mock-first; same                                                                                                                 |
| Weekly agency report                      | M10       | assembly built; scheduling blocked on `INNGEST_*` keys                                                                                 |

## n8n (`hrmny.app.n8n.cloud` — external-event glue)

Blocked on the hrmny n8n Cloud API key (CREDENTIALS-NEEDED.md Tier 3 #11). Because the tenant has no API key yet, the first two workflows were authored and validated in a **staging** tenant (personal `ahmadbukhari.app.n8n.cloud`, named `hrmny-STAGING — …`, left inactive) and exported to `docs/automations/n8n/`. All target URLs/secrets are `$env` expressions so the exports import cleanly into the real tenant. Import per `docs/automations/n8n/README.md`, pin-test in-tenant, then activate (and flip `N8N_ALLOW_PRODUCTION_TRIGGER`).

| #   | Workflow                                                                    | Export                                                    | Status                                                      |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Lead-source webhook ingestion → OS inbound endpoint                         | `docs/automations/n8n/lead-source-webhook-ingestion.json` | built + validated in staging; tenant import pending API key |
| 2   | Google Chat notification fan-out (job failures, cap alerts)                 | `docs/automations/n8n/ops-alert-fanout.json`              | built + validated in staging; tenant import pending API key |
| 3   | Client-facing nurture sequence trigger (consumes M8 send infra, HITL-gated) | —                                                         | planned                                                     |

Do not build hrmny workflows in any personal n8n tenant as production. The staging drafts above are inactive, `hrmny-STAGING —` prefixed, and exist only to validate node logic and produce the importable JSON — they are never activated in the personal tenant.
