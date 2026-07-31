# hrmny OS — Master Build Plan v2 (AI Activation → M12)

**Status:** Approved by Ahmad Bukhari, 2026-07-30
**Supersedes:** the M1–M6 phase plan in `hrmny-aios` (2026-06-30 snapshot) for everything after M6.
**Companion docs:** `AGENT-WORKSTREAMS.md` (parallel-agent build architecture), `CREDENTIALS-NEEDED.md` (activation keys), `PRODUCTION-OWNERSHIP-ACCESS-REGISTER.md` (ownership sign-off).

## Goal statement (Ahmad, 2026-07-30)

Production-ready CRM + operating system powered by AI, with: reporting, analytics, research, lead generation, outreach, and **competitor research**; production-grade backend, frontend, and storage/database systems; **every external account connectable / disconnectable / changeable from the frontend**; a **client portal where clients see and approve things**; and **all required automations built and tested in both n8n and GitHub Actions**.

## 0. Where we stand (verified 2026-07-30)

| Milestone | Scope | Status |
|---|---|---|
| M1 Substrate | Hosting/CI, Postgres+RLS, gate engine, Google SSO, RBAC, audit, DAM, jobs, health alerts | **RELEASE CANDIDATE** — software-green in CI/preview; target migration `0070`, production promotion/proof and named external holds remain (`M1-COMPLETION-AUDIT.md`) |
| M2 Finance/HR | Xero adapter, Bayzat CSV, invoice/payroll gates | Built, **mock-first demo** |
| M3 Sales/CRM | Deal gates G1–G6, BUAF scoring, Apollo/Hunter ifaces, outreach | Built, **mock-first demo** |
| M4 Delivery/Traffic | Task board, DoR, shoot locks, Canva stub | Built, **mock-first demo** |
| M5 Money | Billing drafts, margin engine, payroll loop (never disburses) | Built, **mock-first demo** |
| M6 Portal/Seams | Client portal, seams outbox, dashboards hub | Built, **mock-first demo** |
| Post-M6 | "Work" (Asana replacement) + Bayzat-replacement HR programme | Active development (migrations 0019–0057) |

**The core problem this plan fixes:** the product is called an AI OS but the AI layer is inert — `LLM_PROVIDER=mock` in production, 13 agent instruction sets with no live model, Composio code with no key, and the lead-gen/marketing differentiator from the June prototype was deferred out of V1. Master Plan v2 activates the AI layer and restores the differentiator as milestones M7–M12.

**Governing principle:** the substrate is done — nothing new needs inventing until the AI layer is live. Phase 0 is almost all configuration. Everything ships behind the existing gate engine (`packages/gate`) and the mock-first adapter pattern, so parallel agents build against interfaces before keys arrive. **AI proposes; the gate disposes. No autonomous external send, post, or spend through M12.**

## Phase 0 — Activation (Week 0–1, mostly ops, not code)

No milestone below starts until its row here is green. Key sources: `CREDENTIALS-NEEDED.md`.

| # | Action | Where | Unblocks |
|---|---|---|---|
| 0.1 | `LLM_PROVIDER=openrouter` + key in Vercel prod env; verify `LLM_MONTHLY_CAP_AED=1500` enforcement in `packages/ai/src/provider.ts` | Vercel env | Everything AI |
| 0.2 | `OPENAI_API_KEY` for embeddings → pgvector memory live (`packages/ai/src/memory`) | Vercel env | M8 graph, M10 |
| 0.3 | `APOLLO_API_KEY`, `APOLLO_MODE=live` | env | M8 sourcing |
| 0.4 | Hunter re-provision + NeverBounce credits (owner decision — keys requested, no vendor swap) | env | M8 + verified-email payment gate |
| 0.5 | Composio workspace + `COMPOSIO_API_KEY`; connect **Gmail only** (LinkedIn at M9, ads at M11 — no speculative connections) | Composio + env | M8 HITL send, M9 publish |
| 0.6 | Inngest account + `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY`; wire workers (env exists, workers don't) — replaces the 5-min cron ceiling for long AI jobs | code + env | M8 daily jobs, M9–M11 |
| 0.7 | Xero developer app + OAuth registration | Xero portal | M5-live (not AI-blocking) |
| 0.8 | Account consolidation: developer@hrmny.co Vercel team + Supabase org confirmed canonical; connect MCP/tokens for them; **archive** (not delete) duplicates `hrmny-os-web`, `hrmny-sales-growth` in personal account after owner OK | ops | Deploy safety |

**Phase 0 acceptance:** one real agent run (outreach-draft) in prod against a live model, with an audit row and cost recorded.

## M7 — AI Core Live (Weeks 1–3, ~2 wk)

**Scope:** convert the mock AI layer to production-grade.

- `packages/ai/src/provider.ts`: OpenRouter live path as default, per-call cost logging, monthly-cap circuit breaker (fail closed, alert to Google Chat).
- New `agent_runs` table + migration (`packages/db`): input, output, model, tokens, cost AED, gate outcome.
- Agent registry gains per-agent `enabled` kill switch (env or DB).
- BUAF G1–G6 scoring (`m3-routers.ts` + `packages/gate/src/gates/deal.ts`) runs on live LLM.
- Reply-intent classifier — first new live task; feeds M8.
- Eval harness: ~10 golden cases per active agent, `LLM_PROVIDER=mock` in CI + nightly live-eval job.
- Connections management UI v2: extend `/settings/connections` (Composio flows already exist in `connections-router.ts`) so **every** external account — Composio apps, Apollo, Hunter, Xero, n8n — can be connected, disconnected, and swapped from the frontend, with health status per connection. No env-only integrations for anything user-facing.

**Acceptance demo:** live BUAF score + outreach draft + reply-intent classification in prod; cost visible in an admin panel; a connection connected + disconnected from the UI; full audit trail.
**Depends:** 0.1, 0.2.

## M8 — Lead-Gen Engine (Weeks 3–6, ~3 wk) — the June-prototype differentiator, restored

**Scope:** autonomous daily pipeline: research → enrich → score → HITL send → reply loop → memory.

- Daily Inngest job: Apollo ICP search → dedupe into CRM (`crm-routers.ts`) → email find+verify (Hunter/NeverBounce with provided keys) → BUAF score → morning digest.
- HITL outreach: `outreach-draft` agent drafts; approval-inbox UI; send via Composio Gmail; **send is a gate transition** — never auto-send in V1.
- Reply-intent classification drives deal-stage transitions through the gate engine.
- Intelligence graph v1: `contact_edges` (who-knows-whom) + `win_loss_notes` tables; retrieval via existing pgvector memory. Postgres tables + embeddings — no graph DB at 25-staff scale.
- Self-evolution v1: weekly job summarizes win/loss memory into updated retrieved agent context (context injection, **not** instruction-set rewriting — that is V2).
- **Competitor research agent**: extends the existing `research` agent instruction set — scheduled competitor scans (site/social/ads-library), structured findings into pgvector memory, weekly competitor digest per active pitch/client.

**Acceptance demo:** morning digest of N scored fresh leads; one approved send delivered; a reply classified and the deal auto-transitioned; win-loss note retrievable.
**Depends:** M7; keys 0.3–0.6.

## M9 — Content & Marketing Engine (Weeks 5–8, overlaps M8, ~2.5 wk)

- `creative` agent live; Canva/Midjourney/Higgsfield adapters activated where keys exist (mock-first stays for the rest).
- One-channel social publish MVP: LinkedIn via Composio, HITL-gated exactly like outreach.
- `campaigns` table + campaign router; content-calendar view; campaign report v1 (posts + engagement pulled back via Composio).
- **Portal approvals v1**: clients approve creative/content and campaign items from `/portal` (approve action is a gate transition with audit; portal stays finance/margin-free). Extends the existing M6 portal read surface into a see-and-approve surface.

**Acceptance demo:** brief → drafted post + visual → client approves it in the portal → published to LinkedIn → engagement appears in campaign report.
**Depends:** M7; Composio LinkedIn connection.

## M10 — Analytics & Scoring v2 (Weeks 7–10, ~2.5 wk)

Deliberately simple: heuristics/logistic regression over existing data + LLM narrative. **No ML infra.**

- Win-rate model over deal history (BUAF features → close probability), surfaced in `m3-routers.ts` scoring.
- Churn signals from client activity (M4/M6 data); capacity forecast from Work data (`work-planning.ts`).
- Unattended weekly agency report (pipeline, capacity, margin from `m5-routers.ts`) — LLM-written, dashboarded + emailed.

**Acceptance demo:** weekly report generated unattended in prod with win-rate, churn-risk list, capacity forecast.
**Depends:** M7 + accumulated M8 data (why it is sequenced fourth).

## M11 — Marketing Automation + Ads Analytics (Weeks 9–12, ~2.5 wk, deliberately cut)

Per the capacity blocker (2026-07-02 review: milestone windows 2–5× over), this milestone is **read-only first**:

- Meta + Google Ads **read-only** ingestion (Composio if supported, else direct adapters in `packages/integrations`); spend/performance dashboard; pacing **alert** job (Inngest). Budget *management* stays V2.
- ONE automated nurture sequence built on M8 send infrastructure (`automation-router.ts`).
- One additional publish channel added to M9's publisher.

**Acceptance demo:** live ad-spend dashboard with a pacing alert firing; nurture sequence advancing a real lead.
**Depends:** M8, M9; ads platform tokens.
**Cut rule:** if capacity still doesn't fit, M11 moves to V2 entirely before M8 loses anything — M8 is the product's differentiator.

## Cross-cutting — Automations in n8n + GitHub Actions (Weeks 1–12)

Every operational automation is built and **tested** in one of two engines, chosen by trigger type, and inventoried in `docs/AUTOMATIONS.md` (created with the first automation):

- **n8n** (`hrmny.app.n8n.cloud`): external-event and integration glue — lead-source ingestion, webhook fan-out, Slack/Chat notifications, client-facing sequences. Each workflow ships with a pinned test execution + a validation run before `N8N_ALLOW_PRODUCTION_TRIGGER` flips true.
- **GitHub Actions**: repo-native schedules — CI (exists), 5-min cron → `api/cron/jobs` (exists), nightly live-eval (M7), weekly report trigger (M10). Each workflow has a `workflow_dispatch` path so it is testable on demand.
- **Inngest**: long-running AI pipelines (M8 daily lead-gen, M9 publish loops, M11 pacing alerts) — these are code-owned, tested in Vitest with mock providers.

Rule: no untested automation reaches prod; every automation's failure path alerts Google Chat.

## M12 — Hardening / UAT / Cutover (Weeks 12–14, ~2 wk)

RLS review on all new tables; cost/load test of AI jobs; per-agent kill-switch drills; staff UAT on M7–M11 flows; `CUTOVER.md` update; remaining payment-milestone demos consolidated; V2 backlog written (auto-send without HITL, instruction self-rewriting, ads budget management, deep automation suite, multi-tenancy).

## Risk register

| Risk | Mitigation |
|---|---|
| Capacity math 2–5× over per-milestone windows (F-1) | M11 cut to read-only; self-evolution = context injection; no graph DB; no ML infra. Next cut is M11→V2, never M8. |
| Hunter dead / NeverBounce 0 credits, verified-email gate is a payment trigger (F-7) | Keys requested from owner (no vendor swap per decision). If re-provisioning fails, escalate to owner before M8 week 1. |
| Bayzat has no public API (F-2) | CSV stays; Bayzat replacement runs as its own programme (`BAYZAT-REPLACEMENT-PLAN.md`), off this critical path. |
| LLM spend runaway | `LLM_MONTHLY_CAP_AED=1500` hard cap + per-agent sub-budgets + cost per run in `agent_runs`. |
| Reputational risk of autonomous outreach | HITL on every external send through M12; removing the human is a V2 decision after ≥4 weeks of measured reply-classification precision. |
| Payment mapping of M7–M12 to remaining milestone payments | Needs Ayham/Molham agreement; track in ownership register §1. |
| Deploying to the wrong Vercel project (duplicate projects exist) | Phase 0.8 consolidation; deploys stay manual from the linked working copy until done. |

## Decisions log (2026-07-30, Ahmad)

1. **Accounts:** developer@hrmny.co canonical for Vercel + Supabase; GitHub commits remain on `syedahmad0786`. Personal-account duplicates archived (deletion requires explicit owner OK).
2. **Email verification vendor:** keep Hunter + NeverBounce; owner supplies keys/credits (see `CREDENTIALS-NEEDED.md`). No vendor replacement.
3. **LLM budget:** AED 1,500/month via OpenRouter + OpenAI embeddings, per-agent sub-budgets; revisit after one month of real usage.
4. **Plan home:** this doc lives in `hrmny-os/docs/` (source of truth) and is mirrored to `hrmny-aios` with a status layer.

## Appendix — Ownership matrix (verified 2026-07-30)

| Platform | Canonical owner | Resource | Notes |
|---|---|---|---|
| GitHub | `syedahmad0786` | `hrmny-os`, `hrmny-aios` (private) | Stays here per decision; `hrmny-AB` has push access |
| Vercel | developer@hrmny.co team (`team_1JFUzpwQIfMIYzFhsmVaBatl`) | project `hrmny-os` (`prj_w1fqlkGdhZcjVquTD5cDTJqxVVbt`), region sin1 | Duplicates `hrmny-os-web`, `hrmny-sales-growth` in personal team → archive |
| Supabase | developer@hrmny.co org | ref `klrugedztqxlvyghyzxs`, Singapore ap-southeast-1 | Region exception accepted for launch; UAE decision in ownership register |
| Google Workspace | `developer@hrmny.co` | SSO restricted to `@hrmny.co` | Live |
| n8n | hrmny | `hrmny.app.n8n.cloud` | API key/ownership unconfirmed |
| Netlify | Ahmad personal | `hrmny-os-docs` docs site | Transfer decision open |
| Composio | — | not provisioned | Phase 0.5 |
| Secrets | Keeper | folder path TBD in ownership register | Never in git/chat/email |

Full ownership sign-off template: `PRODUCTION-OWNERSHIP-ACCESS-REGISTER.md`.
