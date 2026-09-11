# AGENTS.md

## Cursor Cloud specific instructions

`hrmny OS` is a pnpm + Turborepo monorepo (Node 22 per `.nvmrc`, pnpm `9.15.9` via
Corepack — both already present in the Cloud VM). The startup update script runs
`pnpm install`, so dependencies are ready on boot.

### Services / apps

- `apps/web` (`@hrmny/web`) — the primary product: a Next.js 15 App Router "OS"
  (staff routes + `/portal`). Dev server on **port 3000**.
- `desk-site` (`hrmny-os-desk`) — a small secondary Next.js site. Dev server on
  **port 3001**. Not required to exercise the core product.
- `packages/*` (`db`, `gate`, `integrations`, `ai`, `ui`, `cache`) — libraries
  consumed by `apps/web`.

### Running / testing (standard commands live in root `package.json` + `README.md`)

- `pnpm dev` runs `turbo run dev`, which starts **both** apps as persistent
  processes. To run only the main app, use `pnpm --filter @hrmny/web dev`.
- `pnpm typecheck`, `pnpm test` (Vitest, ~328 tests), `pnpm build` all pass with
  no external services.
- `pnpm e2e` runs Playwright (`apps/web`). Browser binaries are **not** installed
  by the update script; run `pnpm --filter @hrmny/web exec playwright install chromium --with-deps`
  first (see `.github/workflows/ci.yml`).

### Non-obvious gotchas

- **No database or cloud services are needed for local dev/test.** With `AUTH_MODE=dev`
  (the default) and empty `DATABASE_URL`, the app uses an in-memory store, and all
  integrations (Xero, Bayzat, Apollo/Hunter, LLM, Composio, DAM, Redis) default to
  `mock`/memory. Supabase/Postgres/Upstash are only for live/production.
- **Dev auth uses personas via the `x-dev-role` header** — no login for staff routes.
  The staff shell has a role switcher; personas include `partner`, `am`, `finance`,
  `hr`, `director`, `traffic`, `creative_director`, `portal_a`, `portal_b`.
- **`lint` is a stub** — every package's `lint` script is `echo "lint stub"`, so
  `pnpm lint` always passes without running a real linter. Type safety is enforced
  by `pnpm typecheck`.
- `turbo` caches tasks; `test`/`typecheck`/`lint` depend on `^build`, so package
  builds run first on a cold cache.
- Env files are optional for dev (defaults work in-memory). To customize, copy
  `.env.example` → `.env.local` and `apps/web/.env.example` → `apps/web/.env.local`
  (both git-ignored). Live modes (`XERO_MODE=live`, `AUTH_MODE=supabase`, etc.)
  **fail loud** without their keys — keep them on `mock`/`dev` unless testing that path.
- Good end-to-end smoke check of the core "gate" state machine: open `/gate`,
  click "discover → qualify (legal)" (returns an `auditId`), then
  "→ close (illegal — audited block)" (returns `GATE_BLOCKED`).
