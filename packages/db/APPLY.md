# Applying database migrations (Supabase)

## Prerequisites

1. A Supabase project (cloud or `supabase start` local).
2. Connection strings in env (never commit secrets):

```bash
# from hrmny-os/
cp .env.example .env.local
```

| Variable                               | Source in Supabase                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | Project Settings → Database → URI (use **Transaction** pooler for app; port 6543) |
| `DIRECT_URL`                           | Direct connection (port 5432) — preferred for `drizzle-kit migrate`               |
| `NEXT_PUBLIC_SUPABASE_URL`             | Project URL                                                                       |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable public key (preferred)                                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | legacy anon public key (fallback)                                                 |
| `SUPABASE_SECRET_KEY`                  | modern server secret (preferred; server only)                                     |
| `SUPABASE_SERVICE_ROLE_KEY`            | legacy service_role key (fallback; server only)                                   |

For local Supabase CLI defaults:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

## Apply schema (Drizzle)

From monorepo root:

```bash
# Generate (already shipped for M1 — re-run only after schema edits)
pnpm db:generate

# Apply all journaled migrations in packages/db/migrations.
# drizzle.config.ts prefers DIRECT_URL and falls back to DATABASE_URL.
pnpm db:migrate
```

Migrations `0000`–`0005` create the M1 schema, CRM, memory, tickets,
the margin view, and deny-by-default Data API security. Later journaled
files (`0006`–`0069`) add Work, Asana bridge, leadgen, campaigns, invoices
ops fields, delivery ops fields, memory HNSW, and client onboarding.

**Production durability band (must be applied before invite-only launch):**

| File | Purpose |
|------|---------|
| `0066_invoice_ops_fields.sql` | Invoice ops columns + `invoice_proposal` |
| `0067_delivery_ops_fields.sql` | Task/brief/calendar ops columns |
| `0068_memory_chunk_hnsw.sql` | HNSW cosine index for `memory_chunk` |
| `0069_client_onboarding.sql` | `client_onboarding_phase` 7-phase pack |

The browser uses Supabase Auth only; all business data is served by the
authenticated tRPC API.

## Apply seed data (SQL editor or psql)

After Drizzle migrate succeeds:

```bash
# psql example
psql "$DIRECT_URL" -f packages/db/seed/001_m1_seed.sql
psql "$DIRECT_URL" -f packages/db/seed/002_crm_seed.sql
psql "$DIRECT_URL" -f packages/db/seed/003_tickets_seed.sql
```

Seed only non-production demo/staging environments. Production client and staff
records should be imported from approved source data.

### pgvector / memory_chunk

1. Prefer Dashboard → **Database → Extensions → `vector` → Enable** if the SQL role cannot create extensions.
2. Then re-run `pnpm db:migrate` if the first attempt stopped at `0003`.
3. Migration `0068` creates an **HNSW** cosine index (`memory_chunk_embedding_hnsw`). No IVFFlat train step required.
4. Embedding dim default **1536** (`text-embedding-3-small`). Re-migrate + re-embed if switching providers/dims.
5. Set `OPENAI_API_KEY` (and optionally `EMBEDDING_MODEL`) so CRM notes / win-loss / competitor findings embed on write.

## Storage (DAM)

1. Create bucket `hrmny-dam` (or value of `DAM_BUCKET`).
2. Private bucket; signed URLs via service role / ObjectStore adapter.
3. No browser storage policy is required; uploads and signed URLs use the
   server-only service key.

## Auth

- Staff: Google Workspace SSO via Supabase Auth (or `AUTH_MODE=dev` for local demo).
- Portal: magic link (skeleton in M1).
- Map `auth.users.id` → `employee_auth.auth_user_id` after first login.

## Production / staging auth + DB coupling

| Mode | Behaviour |
|------|-----------|
| `AUTH_MODE=dev` + empty `DATABASE_URL` | In-memory / demo-store fallback (local demos & CI) |
| `AUTH_MODE=supabase` | **Requires** `DATABASE_URL` — `getDb()` fails loud (no silent memory). Escape hatch: `ALLOW_MEMORY_STORE=true` (emergency only) |
| `REQUIRE_DATABASE=true` | Force fail-loud even in `AUTH_MODE=dev` |

Also set `AUTH_MODE=supabase` so edge middleware redirects anonymous users to `/login` (cookie session via `@supabase/ssr`).

## Without a live project

Set `AUTH_MODE=dev` and leave `DATABASE_URL` empty. The web app uses an in-memory store so typecheck, unit tests, and the demo UI still run. Persist nothing across restarts.
