# Sales compatibility fixtures and accepted operating path

The old one-click demo funnel is retained only as a synthetic compatibility
fixture. It is not an approved provider, production, or client workflow.

The accepted Sales Growth contract is:

`Signal → Research → Person → Outreach → Pipeline → Learn`

Each real effect must follow:

`preview → human/policy approval → idempotent action → provider readback → reconciliation → immutable receipt`

## Synthetic fixture boundary

The compatibility controls and services are enabled only when all of these are
true at once: dev authentication is explicitly enabled, storage is in-memory,
the Work environment is a sandbox, AI and every provider are in mock/disabled
mode, every paid-operation flag is false, Xero writes are false, and both
Composio and the Google Chat webhook are absent. The readiness endpoint exposes
this as `syntheticSalesFixtures`; `/crm/hunt` hides the controls otherwise.

Guarded compatibility paths include:

- `crm.runDemoClosedLoop` and the underlying closed-loop service.
- `crm.prospect.apolloImport` and `leads.apollo.import`.
- `deals.verifyEmail`.
- Agent tools `crm.closed_loop` and `crm.prospect`.
- The legacy `runDailyLeadGen` service.

Outside the exact synthetic runtime, these paths refuse before adapter
resolution, network access, CRM writes, or notifications. The manual disposable
Postgres workflow now proves containment only; it does not run the former
monolithic prospect-to-finance mutation.

- **Synthetic E2E:** `apps/web/e2e/funnel-demo.spec.ts`
- **Local script:** `node scripts/demo-funnel.mjs`
- **Tool smoke:** `node scripts/tools-smoke.mjs`

## Product surfaces

| Stage               | Route                                                 | Durable path                                                                                                             |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Prospecting         | `/crm/hunt`, `/crm/inbound`, `/crm/outreach`          | Signal/research/person flow; legacy bulk imports are synthetic-only                                                      |
| Sales / pipeline    | `/crm/deals/[id]`                                     | Same CRM store as Apollo imports; stage moves → **Mark won** → **Handover pack**                                         |
| Onboarding          | `/clients/[id]`, `/portal/onboarding`                 | Seeded by handover; portal can acknowledge active phase                                                                  |
| Creative / delivery | `/creative`, `/delivery`, `/traffic`, `/account`      | Durable tasks/briefs/lock + **calendars** create/slots/refApprove; seam_outbox; generate → portal; **Run agent on task** |
| Inbound prospecting | `/crm/inbound`                                        | `leads.inbound.create` → durable company/contact/discover deal                                                           |
| Client portal       | `/portal`, `/portal/deliveries`, `/portal/onboarding` | Same Postgres tasks/assets + onboarding phases; approvals act on `client_review`                                         |
| Agents on command   | `/settings/ai`                                        | Built-in `runAgent` + **customAgents.run** with client/user/task sandbox                                                 |
| Chat harness        | `/chat`                                               | Loads `custom_agent.system_prompt` when thread has `agentSlug`                                                           |
| Tools               | `/settings/connections`                               | Live list; Apollo/Hunter/Xero/n8n mock until keys                                                                        |

## Sandboxes

- LLM role sandbox: `packages/ai/src/sandbox.ts` (privileged finance/HR workspace)
- Memory: `metadata.clientId` / `employeeId` / `dealId` / `taskId` filters on retrieve; embeddings via OpenRouter when key present (else local hash → pgvector)
- Work sandbox: separate Work deployment control plane (`work_sandbox`)
- Portal: client-scoped workspace (no finance fields)

## Tools

- Apollo: free person discovery precedes one exact-person enrichment. Paid enrichment requires a fresh confirmation for the visible candidate; bulk legacy imports are disabled outside synthetic fixtures.
- Hunter / NeverBounce: verification remains provider-gated. Legacy verification shortcuts are disabled outside synthetic fixtures.
- Composio: OAuth/connect live when `COMPOSIO_API_KEY` set; HITL Gmail send uses live Composio→Gmail proxy when the staff user has an ACTIVE Gmail connection (else stub); LinkedIn stays copy-draft
- n8n: `/settings/automations` → **Run n8n smoke** (`automation.smoke`); live when `N8N_API_KEY` + `N8N_MODE=live`
- Xero: mirror-only (`XERO_WRITE_ENABLED=false`)
- OpenRouter: configured for chat/agents/images; mock fallback without credits
