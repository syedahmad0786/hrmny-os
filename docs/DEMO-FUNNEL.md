# Demo funnel — prospecting → sales → onboarding

**Script:** `node scripts/demo-funnel.mjs`  
**Staff one-click:** `/crm/hunt` → **Run demo closed loop** (`crm.runDemoClosedLoop`)  
**E2E:** `apps/web/e2e/funnel-demo.spec.ts` (CI uses `AUTH_MODE=dev` + `ALLOW_DEV_AUTH=true`)  
**Tools:** `node scripts/tools-smoke.mjs`

Verified against live Postgres (pgvector on): creates won deal → client → `client_onboarding` (7 phases) → immersion → client-scoped `memory_chunk` → creative QC task → `agent_runs` row. Confirms other-client memory does not appear in the client sandbox.

## Product surfaces

| Stage | Route | Durable path |
|-------|--------|--------------|
| Prospecting | `/crm/hunt`, `/crm/inbound`, `/crm/outreach` | CRM + leadgen; demo loop without Apollo/Hunter keys |
| Sales / pipeline | `/crm/deals/[id]` | `crm.deals.moveStage` → **Mark won** → **Handover pack** |
| Onboarding | `/clients/[id]` | Seeded by handover; immersion writes client memory |
| Creative / delivery | `/creative`, `/delivery` | Generate → **Attach & send to portal** → asset `client_review` |
| Client portal | `/portal`, `/portal/deliveries` | Same Postgres tasks/assets in `client_review` |
| Agents on command | `/settings/ai` | Built-in `runAgent` + **customAgents.run** with client/user sandbox |
| Chat harness | `/chat` | Loads `custom_agent.system_prompt` when thread has `agentSlug` |
| Tools | `/settings/connections` | Live list; Apollo/Hunter/Xero/n8n mock until keys |

## Sandboxes

- LLM role sandbox: `packages/ai/src/sandbox.ts` (privileged finance/HR workspace)
- Memory: `metadata.clientId` / `employeeId` filters on retrieve; embeddings via OpenRouter when key present (else local hash → pgvector)
- Work sandbox: separate Work deployment control plane (`work_sandbox`)
- Portal: client-scoped workspace (no finance fields)

## Tools

- Apollo / Hunter: auto-live when API key present (`APOLLO_MODE=mock` / `HUNTER_MODE=mock` forces stub)
- Composio: OAuth/connect live when `COMPOSIO_API_KEY` set; HITL send stays stub/copy-draft (read-only tool guard)
- Xero: mirror-only (`XERO_WRITE_ENABLED=false`)
- OpenRouter: configured for chat/agents/images; mock fallback without credits
