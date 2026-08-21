# Demo funnel — prospecting → sales → onboarding

**Script:** `node scripts/demo-funnel.mjs`

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

## Sandboxes

- LLM role sandbox: `packages/ai/src/sandbox.ts`
- Memory: `metadata.clientId` / `employeeId` filters in retrieve
- Portal: client-scoped workspace
