# Demo funnel — prospecting → sales → onboarding

**Script:** `node scripts/demo-funnel.mjs`  
**E2E:** `apps/web/e2e/funnel-demo.spec.ts` (CI uses `AUTH_MODE=dev` + `ALLOW_DEV_AUTH=true`)

Verified against live Postgres (pgvector on): creates won deal → client → `client_onboarding` (7 phases) → immersion → client-scoped `memory_chunk` → `agent_runs` row. Confirms other-client memory does not appear in the client sandbox.

## Product surfaces

| Stage | Route |
|-------|--------|
| Prospecting | `/crm/inbound`, `/crm/outreach` |
| Sales / pipeline | `/crm/deals` |
| Onboarding | `/clients/[id]` |
| Creative / delivery | `/creative`, `/delivery` |
| Client portal | `/portal` |
| Agents on command | `/settings/ai` → **Run** |
| Tools | `/settings/connections` (live list) |

## Sandboxes

- LLM role sandbox: `packages/ai/src/sandbox.ts`
- Memory: `metadata.clientId` / `employeeId` filters in retrieve
- Portal: client-scoped workspace

## Tools

- Apollo / Hunter: auto-live when API key present (`APOLLO_MODE=mock` / `HUNTER_MODE=mock` forces stub)
- Composio: OAuth/connect live when `COMPOSIO_API_KEY` set; HITL send stays stub/copy-draft (read-only tool guard)
- Xero: mirror-only (`XERO_WRITE_ENABLED=false`)
