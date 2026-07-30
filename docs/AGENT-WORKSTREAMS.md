# hrmny OS — Parallel-Agent Build Architecture (M7–M12)

**Status:** Approved 2026-07-30 · Companion to `MASTER-PLAN-V2.md`.

Multiple AI coding agents (Claude Code, Codex, Grok, Cursor) build workstreams in parallel on separate branches and combine through PRs. The seams already exist in the codebase — tRPC router files and package boundaries are the ownership units; the gate engine is the shared contract every mutation flows through.

## 1. Branch strategy

- One long-lived branch per workstream off `main`:
  `feat/m7-ai-core` · `feat/m8-leadgen` · `feat/m9-content` · `feat/m10-analytics` · `feat/m11-ads` · `feat/ui-surfaces`
- Merge to `main` behind env/feature flags. Mock-first means **merged-but-inert is safe** — the exact pattern M2–M6 already use.
- No `develop` branch. CI on `main` (Vitest + Playwright, `LLM_PROVIDER=mock`) is the merge arbiter.
- Workstream agents rebase on `main` daily. PR when a deliverable's tests pass. Claude Code reviews every PR before merge.
- Weekly integration checkpoint: deploy `main` to a Vercel preview and run the milestone demo script.

## 2. Contract-freeze PR (first build step, before any parallel work)

The orchestrator (Claude Code) lands ONE PR freezing the interfaces everyone builds against:

1. Adapter interfaces — `packages/integrations/src/types.ts`
2. Agent I/O types — `packages/ai/src/index.ts`
3. New gate transitions — `packages/gate/src/registry.ts`
4. Stub tRPC procedure signatures (return mock data) for: `ai-admin`, `campaigns`, `analytics` routers
5. Migration-slot reservations (see rule below)

Downstream agents build against these; live implementations swap in behind env flags.

## 3. File-ownership collision map

| Workstream | Owns | Never touches |
|---|---|---|
| M7 AI core | `packages/ai/*`, `packages/gate` changes, `agent_runs` migration, thin `ai-admin` router | other routers |
| M8 lead-gen | `packages/integrations/{apollo,hunter,composio}`, `m3-routers.ts`, `crm-routers.ts`, Inngest job files | `packages/ai/src/provider.ts` |
| M9 content | `packages/ai/src/agents/*` prompt content, new `campaigns` router + migration, publish adapter | m3/crm routers |
| M10 analytics | new `analytics-router.ts` — **read-only queries** over m3/m5/work data | writes to any domain table |
| M11 ads | `packages/integrations/{meta,google-ads}`, pacing job, nurture sequence in `automation-router.ts` | m3/crm routers |
| n8n automations | n8n workflows (via n8n MCP/API) + `docs/AUTOMATIONS.md` | repo code |
| UI | `apps/web/src/app/*` pages/components only — includes connections manager, HITL inbox, portal approvals | `apps/web/src/server/*` |

## 4. Serialization rules (the two known collision points)

1. **Migrations:** only the orchestrator assigns `00NN` numbers. Workstream agents request a slot in their spec; never self-number.
2. **`appRouter` composition + shared `trpc.ts`:** orchestrator-only edits. Workstreams deliver routers as importable modules.

Also standing repo rules: verify `git branch --show-current` before every commit; push immediately after committing (the local worktree is shared across sessions).

### Migration ledger + ownership rulings (orchestrator, 2026-07-30)

| Slot | Owner | Content |
|---|---|---|
| 0056 | — | latest committed on `main` |
| 0057 | RESERVED — in-flight `ahmadbukhari097/codex/asana-feature-lab` | work_goal_saved_views (uncommitted in local clone) |
| 0058 | M7 | `agent_runs` |
| 0059 | M8 | `outreach_items` |
| 0060 | M8 | `lead_intel` (`contact_edges`, `win_loss_notes`, `competitor_findings`) |
| 0061 | Orchestrator | `campaigns` (lands with the root.ts wiring PR after M7 merges) |

Journal note (M8, 2026-07-30): 0061 was generated + journaled before M8's slots, so `meta/_journal.json` orders them `…0058, 0061, 0059, 0060` (idx 57–60) — numeric filename order diverges from journal order, accepted. `packages/db/src/migration-security.test.ts`'s "journals … in order" check assumes journal order == sorted-filename order and needs a sort-before-compare tweak (orchestrator-owned test) to stay green with this divergence.

Rulings:
- **`m3-routers.ts` is M7/orchestrator-owned exclusively** (BUAF-on-live-LLM edit). M8 does NOT touch it — M8 procedures live in a new `leadgen-router.ts` and consume `crm/repository` exports.
- **Campaigns table + router implementation are orchestrator-owned** (M9/Grok is prompt-content only; the stub router from the contract freeze gets its implementation with slot 0061).
- **Canonical agent-runner seam:** M7 exports `runAgent(input: AgentRunInput): Promise<AgentRunOutput>` from `@hrmny/ai`. M8/M10 accept a `RunAgent` dependency (mock until M7 merges) and bind to the M7 export at wiring time — one seam, no drift.
- **Reply-intent classifier is M7's**; M8 consumes `ReplyIntent` and owns only the intent→deal-stage mapping. No lost/disqualified *stage* exists (lost is a `close_outcome_enum` value), and only `moveDealStage` is in the consumable surface, so `unsubscribe` records no stage move yet — a documented calibration knob in `reply-intent.ts`.
- **Competitor-research findings live in slot 0060** as a third `lead_intel` table (`competitor_findings`), stored via the M8 leadgen store (`competitor-scan.ts`). Mock-first: the outreach/competitor stores are in-memory (merged-but-inert like M2–M6); 0059/0060 are the durable schema-of-record, and the live Postgres path binds when drizzle tables + a `withDb` swap land.

## 5. Model/tool assignment matrix

| Workstream | Tool | Rationale |
|---|---|---|
| Orchestration, contract-freeze PR, gate-engine changes, DB migrations, ALL PR reviews + merges, M7 core | **Claude Code** | Architecture-critical, cross-package, needs full-repo context + MCP/infra access; the only merger |
| Vendor adapters (Composio wiring, ads APIs), Inngest jobs, test-heavy pipeline work (M8 plumbing, M10 model code) | **Codex** (cloud / `codex` CLI) | Isolated, well-specced package work with clear test targets — matches the existing `ahmadbukhari097/codex/*` branch workflow; runs unattended |
| ICP research, outreach/creative prompt content (agent instruction sets), marketing-domain specs for M9/M11, competitor + ads-platform research | **Grok** | Research + copy + ads/X-adjacent domain strength. Deliverable = markdown specs + prompt files on a branch; **Grok never merges code** |
| Dashboards/report UI, HITL approval inbox, campaign calendar, visual polish | **Cursor** | Fast visual iteration on `apps/web` pages; UI-only file ownership makes merge risk near zero |

**Working rule:** Codex and Cursor receive a written spec per task (committed to `docs/specs/` on the workstream branch). Claude Code writes the specs, reviews everything, and is the only agent that merges to `main`.

## 6. Task handoff template (per spec in `docs/specs/`)

```
# Spec: <workstream>/<task>
Branch: feat/<workstream>
Owns files: <exact paths>
Interfaces to build against: <types.ts / registry.ts references — frozen, do not edit>
Migration slot (if any): <00NN, assigned by orchestrator>
Deliverable: <code + tests>
Acceptance: <command(s) that must pass; demo step it enables>
Out of scope: <explicitly>
```

## 7. Sequencing

```
Week 0   Phase 0 activation (ops) + contract-freeze PR
Week 1-3 M7 (Claude Code) ║ UI shells for admin/inbox (Cursor) ║ M8/M9 specs + prompts (Grok)
Week 3-6 M8 (Codex plumbing + Claude Code gates) ║ M9 start (overlap) ║ M10 spec
Week 5-8 M9 finish ║ M10 (Codex model code, read-only)
Week 8-12 M11 (read-only ads) ║ M12 prep
Week 12-14 M12 hardening/UAT/cutover (Claude Code + staff UAT)
```
