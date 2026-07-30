# Spec: m10-analytics/analytics-router (for Codex)

Branch: `feat/m10-analytics` (off latest `main`; rebase daily). Verify
`git branch --show-current` before every commit; push immediately (shared worktree).

Fill in the frozen `analytics-router.ts` stub with real computation.
**READ-ONLY by contract: every procedure is a query over existing m3/m5/work
data — this router never writes a domain table, runs no migration, and adds no
write method (MASTER-PLAN-V2 M10). Deliberately simple: heuristics / logistic
regression + LLM narrative. No ML infra.**

## Owns files (exact)

Replace mock returns in:
- `apps/web/src/server/trpc/analytics-router.ts` — keep procedure names and
  input/output SHAPES exactly as frozen (the UI shipped in #5 depends on them);
  swap mock literals for computed values.

New service modules (pure functions, unit-testable, no I/O beyond the injected repo reads):
- `apps/web/src/server/analytics/win-rate.ts`
- `apps/web/src/server/analytics/churn.ts`
- `apps/web/src/server/analytics/capacity.ts`
- `apps/web/src/server/analytics/report.ts`
- Co-located `*.test.ts` for each.

## Interfaces to build against (FROZEN — signatures locked, read the rest)

- `apps/web/src/server/trpc/analytics-router.ts` (on `main`): the four
  procedures `winRate`, `churnRisk`, `capacityForecast`, `weeklyReport` — their
  Zod inputs and return shapes are the contract. Do not rename, add, or remove
  fields; only change the values from mock to computed. Keep `staffProcedure`.
- Read-only data sources (consume exports; never edit these files):
  - Deals for win-rate + pipeline: `apps/web/src/server/crm/repository` —
    `listDeals`, `getDeal` (BUAF fields `buafBudget/Urgency/Access/Fit/Temperature`
    are the model features; `verified_email`, reply-intent are cited weights).
  - Client activity for churn: M4/M6 data via their repository/query exports
    (locate under `apps/web/src/server/` — read-only).
  - Capacity: work-planning data — `apps/web/src/server/**/work-planning*`
    (assignments/utilization); read-only.
  - Margin/pipeline value for the weekly report: `m5-routers.ts` /
    `apps/web/src/server/m5*` read paths.
- LLM narrative: `createProvider()` + `generate()` from `@hrmny/ai`
  (`packages/ai/src/provider.ts` — import and CALL, never edit). CI runs
  `LLM_PROVIDER=mock`, so `weeklyReport` must produce a coherent narrative on the
  mock provider (deterministic string is fine).

## Deliverable (behaviour)

1. **`winRate`** — logistic/heuristic over closed deal history: BUAF features →
   close probability; return the frozen shape (`windowMonths`, `dealsClosed`,
   `dealsWon`, `winRate`, `topFactors[{feature,weight}]`) with real counts and
   fitted/heuristic weights. `ponytail:` closed-form logistic or a weighted
   heuristic — no training pipeline; upgrade to a fitted model only if accuracy
   demands it.
2. **`churnRisk`** — score active clients from recency/volume of approved
   deliverables + engagement; return `[{clientId,name,risk,reason}]` sorted desc,
   sliced to `limit`.
3. **`capacityForecast`** — utilization over the next `weeks` from work
   assignments; return `{weeks,utilizationPct,overbookedRoles,note}`.
4. **`weeklyReport`** — assemble pipeline + capacity + churn into the frozen
   shape and generate `narrative` via the LLM provider (mock in CI). Runs
   unattended (no HITL — read-only, no external side effect).

Each service module is a pure function taking already-fetched rows (inject the
repo reads at the router layer) so tests need no DB.

## Migration slot

None. M10 writes nothing and reserves no `00NN`.

## Acceptance (must pass)

- `pnpm --filter @hrmny/web test` — win-rate/churn/capacity/report unit tests
  green; `weeklyReport` returns a non-empty narrative under `LLM_PROVIDER=mock`.
- `pnpm --filter @hrmny/web typecheck` clean.
- Contract guard: procedure input/output shapes byte-compatible with the #5 UI —
  no field renamed/removed (diff the router's Zod I/O against `main`).
- Demo it enables: weekly agency report generated unattended in prod with
  win-rate, churn-risk list, and capacity forecast.

## Out of scope (DO NOT TOUCH)

- Any WRITE to a domain table; any migration; any new tRPC mutation.
- `root.ts`, `trpc.ts` (router already wired by orchestrator at contract-freeze),
  `packages/ai/src/provider.ts`, the frozen contract files, `m3-routers.ts`,
  `crm-routers.ts`, `m5-routers.ts`, `campaigns-router.ts` (read their data via
  repository/query exports only — do not edit them).
- Changing any `analytics-router.ts` procedure signature or Zod shape.
- ML infrastructure (feature stores, training jobs, model servers) — V2.
