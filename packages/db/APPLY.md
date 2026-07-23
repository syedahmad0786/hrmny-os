# Applying database migrations (Supabase)

## Prerequisites

1. A Supabase project (cloud or `supabase start` local).
2. Connection strings in env (never commit secrets):

```bash
# from hrmny-os/
cp .env.example .env.local
```

| Variable | Source in Supabase |
|---|---|
| `DATABASE_URL` | Project Settings → Database → URI (use **Transaction** pooler for app; port 6543) |
| `DIRECT_URL` | Direct connection (port 5432) — preferred for `drizzle-kit migrate` |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable public key (preferred) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | legacy anon public key (fallback) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (server only) |

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

# Apply journaled migrations in packages/db/migrations
# Prefer DIRECT_URL so migrate is not blocked by pooler
cd packages/db
DATABASE_URL="${DIRECT_URL:-$DATABASE_URL}" pnpm migrate
```

Or with drizzle-kit from root:

```bash
pnpm db:migrate
```

## Apply view + RLS + seed (SQL editor or psql)

After Drizzle migrate succeeds:

```bash
# psql example
psql "$DIRECT_URL" -f packages/db/migrations/0001_v_client_margin.sql
psql "$DIRECT_URL" -f packages/db/rls/001_m1_rls.sql
psql "$DIRECT_URL" -f packages/db/seed/001_m1_seed.sql
psql "$DIRECT_URL" -f packages/db/migrations/0002_crm_entities.sql
psql "$DIRECT_URL" -f packages/db/seed/002_crm_seed.sql
# Agent memory (pgvector) — enable extension in Dashboard if CREATE EXTENSION fails
psql "$DIRECT_URL" -f packages/db/migrations/0003_pgvector_memory.sql
psql "$DIRECT_URL" -f packages/db/migrations/0004_tickets.sql
psql "$DIRECT_URL" -f packages/db/seed/003_tickets_seed.sql
```

In Supabase Dashboard: **SQL Editor** → paste each file in order.

### pgvector / memory_chunk

1. Prefer Dashboard → **Database → Extensions → `vector` → Enable** if the SQL role cannot create extensions.
2. Then run `0003_pgvector_memory.sql` (table + indexes).
3. IVFFlat index is commented in the migration — add after ~100+ rows.
4. Embedding dim default **1536** (`text-embedding-3-small`). Re-migrate + re-embed if switching providers/dims.


## Storage (DAM)

1. Create bucket `hrmny-dam` (or value of `DAM_BUCKET`).
2. Private bucket; signed URLs via service role / ObjectStore adapter.
3. Optional RLS on `storage.objects` scoped by folder `client_id/…`.

## Auth

- Staff: Google Workspace SSO via Supabase Auth (or `AUTH_MODE=dev` for local demo).
- Portal: magic link (skeleton in M1).
- Map `auth.users.id` → `employee_auth.auth_user_id` after first login.

## Without a live project

Set `AUTH_MODE=dev` and leave `DATABASE_URL` empty. The web app uses an in-memory store so typecheck, unit tests, and the M1 demo UI still run. Persist nothing across restarts.
