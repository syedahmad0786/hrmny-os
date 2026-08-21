# Demo funnel — prospecting → sales → onboarding

**Script:** `node scripts/demo-funnel.mjs`  
**E2E:** `apps/web/e2e/funnel-demo.spec.ts` (CI uses `AUTH_MODE=dev` + `ALLOW_DEV_AUTH=true`)  
**Tools:** `node scripts/tools-smoke.mjs`

Verified against live Postgres (pgvector on): creates won deal → client → `client_onboarding` (7 phases) → immersion → client-scoped `memory_chunk` → creative QC task → `agent_runs` row. Confirms other-client memory does not appear in the client sandbox.

## Product surfaces

| Stage | Route | Durable path |
|-------|--------|--------------|
| Prospecting | `/crm/inbound`, `/crm/outreach` | CRM + leadgen Postgres |
| Sales / pipeline | `/crm/deals/[id]` | `crm.deals.moveStage` → **Mark won** → **Handover pack** |
| Onboarding | `/clients/[id]` | Seeded by handover; immersion writes client memory |
| Creative / delivery | `/creative`, `/delivery` | Postgres `task` + brief (QC → `client_review` → portal) |
| Client portal | `/portal` | Same Postgres tasks in `client_review` |
| Agents on command | `/settings/ai` → client sandbox + **Run** | `aiAdmin.runAgent` + pgvector/keyword memory |
| Tools | `/settings/connections` | Live list; Apollo/Hunter/Xero mock until keys |

## Sandboxes

- LLM role sandbox: `packages/ai/src/sandbox.ts`
- Memory: `metadata.clientId` / `employeeId` filters; embeddings via OpenRouter when key present
- Portal: client-scoped workspace

## Tools

- Apollo / Hunter: auto-live when API key present (`APOLLO_MODE=mock` / `HUNTER_MODE=mock` forces stub)
- Composio: OAuth/connect live when `COMPOSIO_API_KEY` set; HITL send stays stub/copy-draft (read-only tool guard)
- Xero: mirror-only (`XERO_WRITE_ENABLED=false`)
