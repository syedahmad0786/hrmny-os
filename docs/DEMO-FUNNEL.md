# Demo funnel — prospecting → sales → onboarding

**Script:** `node scripts/demo-funnel.mjs`  
**Staff one-click:** `/crm/hunt` → **Run demo closed loop** (`crm.runDemoClosedLoop`) or **Closed loop via Apollo** (`viaApollo: true`)  
**Apollo prospecting:** Hunt → **Prospect with Apollo** → `crm.prospect.apolloImport` (durable CRM deals, not demo-store)  
**E2E:** `apps/web/e2e/funnel-demo.spec.ts` (CI uses `AUTH_MODE=dev` + `ALLOW_DEV_AUTH=true`)  
**Tools:** `node scripts/tools-smoke.mjs`

Verified against live Postgres (pgvector on): Apollo mock/live → durable discover deals → closed loop won → client → `client_onboarding` (7 phases) → immersion → client-scoped `memory_chunk` → creative QC task → portal deliveries (tasks + assets) → portal approval act → `briefs.lock` + `creative_spawn` → `agent_runs` with optional task sandbox.

## Product surfaces

| Stage | Route | Durable path |
|-------|--------|--------------|
| Prospecting | `/crm/hunt`, `/crm/inbound`, `/crm/outreach` | `crm.prospect.apolloImport` + leadgen; demo loop without Apollo/Hunter keys |
| Sales / pipeline | `/crm/deals/[id]` | Same CRM store as Apollo imports; stage moves → **Mark won** → **Handover pack** |
| Onboarding | `/clients/[id]`, `/portal/onboarding` | Seeded by handover; portal can acknowledge active phase |
| Creative / delivery | `/creative`, `/delivery`, `/traffic` | Durable `tasks.create`/`list`; **briefs.lock** + **seam_outbox**; generate → portal (http/data URLs resolve without memory DAM); **Run agent on task** |
| Inbound prospecting | `/crm/inbound` | `leads.inbound.create` → durable company/contact/discover deal |
| Client portal | `/portal`, `/portal/deliveries`, `/portal/onboarding` | Same Postgres tasks/assets + onboarding phases; approvals act on `client_review` |
| Agents on command | `/settings/ai` | Built-in `runAgent` + **customAgents.run** with client/user/task sandbox |
| Chat harness | `/chat` | Loads `custom_agent.system_prompt` when thread has `agentSlug` |
| Tools | `/settings/connections` | Live list; Apollo/Hunter/Xero/n8n mock until keys |

## Sandboxes

- LLM role sandbox: `packages/ai/src/sandbox.ts` (privileged finance/HR workspace)
- Memory: `metadata.clientId` / `employeeId` / `dealId` / `taskId` filters on retrieve; embeddings via OpenRouter when key present (else local hash → pgvector)
- Work sandbox: separate Work deployment control plane (`work_sandbox`)
- Portal: client-scoped workspace (no finance fields)

## Tools

- Apollo / Hunter: auto-live when API key present (`APOLLO_MODE=mock` / `HUNTER_MODE=mock` forces stub). Apollo import verifies contact emails via Hunter (mock without key).
- Composio: OAuth/connect live when `COMPOSIO_API_KEY` set; HITL Gmail send uses live Composio→Gmail proxy when the staff user has an ACTIVE Gmail connection (else stub); LinkedIn stays copy-draft
- n8n: `/settings/automations` → **Run n8n smoke** (`automation.smoke`); live when `N8N_API_KEY` + `N8N_MODE=live`
- Xero: mirror-only (`XERO_WRITE_ENABLED=false`)
- OpenRouter: configured for chat/agents/images; mock fallback without credits
