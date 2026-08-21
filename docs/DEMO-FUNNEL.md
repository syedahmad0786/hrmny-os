# Demo funnel — prospecting → sales → onboarding

**Script:** `node scripts/demo-funnel.mjs`  
**Staff one-click:** `/crm/hunt` → **Run demo closed loop** (`crm.runDemoClosedLoop`) or **Closed loop via Apollo** (`viaApollo: true`)  
**Apollo prospecting:** Hunt → **Prospect with Apollo** → `crm.prospect.apolloImport` (durable CRM deals, not demo-store)  
**E2E:** `apps/web/e2e/funnel-demo.spec.ts` (CI uses `AUTH_MODE=dev` + `ALLOW_DEV_AUTH=true`)  
**Tools:** `node scripts/tools-smoke.mjs`

Verified against live Postgres (pgvector on): Apollo mock/live → durable discover deals → closed loop won → client → `client_onboarding` (7 phases) → immersion → client-scoped `memory_chunk` → creative QC task → portal deliveries (tasks + assets) → `agent_runs` with optional task sandbox.

## Product surfaces

| Stage | Route | Durable path |
|-------|--------|--------------|
| Prospecting | `/crm/hunt`, `/crm/inbound`, `/crm/outreach` | `crm.prospect.apolloImport` + leadgen; demo loop without Apollo/Hunter keys |
| Sales / pipeline | `/crm/deals/[id]` | Same CRM store as Apollo imports; stage moves → **Mark won** → **Handover pack** |
| Onboarding | `/clients/[id]`, `/portal/onboarding` | Seeded by handover; portal can acknowledge active phase |
| Creative / delivery | `/creative`, `/delivery` | Durable `tasks.create`/`list` on Postgres; generate → portal; **Run agent on task** on delivery board |
| Client portal | `/portal`, `/portal/deliveries`, `/portal/onboarding` | Same Postgres tasks/assets + onboarding phases |
| Agents on command | `/settings/ai` | Built-in `runAgent` + **customAgents.run** with client/user/task sandbox |
| Chat harness | `/chat` | Loads `custom_agent.system_prompt` when thread has `agentSlug` |
| Tools | `/settings/connections` | Live list; Apollo/Hunter/Xero/n8n mock until keys |

## Sandboxes

- LLM role sandbox: `packages/ai/src/sandbox.ts` (privileged finance/HR workspace)
- Memory: `metadata.clientId` / `employeeId` / `dealId` / `taskId` filters on retrieve; embeddings via OpenRouter when key present (else local hash → pgvector)
- Work sandbox: separate Work deployment control plane (`work_sandbox`)
- Portal: client-scoped workspace (no finance fields)

## Tools

- Apollo / Hunter: auto-live when API key present (`APOLLO_MODE=mock` / `HUNTER_MODE=mock` forces stub)
- Composio: OAuth/connect live when `COMPOSIO_API_KEY` set; HITL Gmail send uses live Composio→Gmail proxy when the staff user has an ACTIVE Gmail connection (else stub); LinkedIn stays copy-draft
- Xero: mirror-only (`XERO_WRITE_ENABLED=false`)
- OpenRouter: configured for chat/agents/images; mock fallback without credits
