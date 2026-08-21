# HRMNY OS full checklist live audit — 2026-08-21T05:35:11Z

Production: https://hrmny-os.vercel.app  
LLM testing: **excluded** per request.  
Total audited rows: **2296** (all checklist sheet items that parse cleanly)

## Verdict: not all complete

Live non-LLM production smoke is green for shipped OS surfaces, but the Excel/Google checklist is **not** fully closed. Large blocks remain `TODO_REMAINS`, `BLOCKED` (SSO/sign-off/payment), `PARTIAL` (mock integrations), or `SKIP_LLM`.

## Overall verdict tallies

| Verdict | Count |
|---------|------:|
| PASS_PRIOR_GREEN | 614 |
| TODO_REMAINS | 537 |
| NOT_RETESTED_DETAIL | 260 |
| PASS_CATALOGUE_BETA | 198 |
| BLOCKED | 155 |
| PARTIAL | 126 |
| PASS | 115 |
| SKIP_LLM | 99 |
| PASS_CATALOGUE | 64 |
| EXTERNAL_HOLD | 56 |
| NOT VERIFIED | 25 |
| GAP_RECORDED | 24 |
| PASS_ROUTE_AUTH_GATED | 6 |
| OUT OF SCOPE | 6 |
| SUPERSEDED | 4 |
| STUB / OUT OF SCOPE | 3 |
| N/A_TEMPLATE | 3 |
| N/A | 1 |

## Live evidence anchors

- `/api/ready`: ok, `database=up`, `pgvector=true`; composio / openrouter / googleOAuth **configured**; apollo / hunter / xero / n8n **mock**
- `tickets.health`: postgres `ticketCount=2`
- `crm.health`: postgres companies=39, deals=65, contacts=32, tasks present
- Route smoke (87 inventory + new pages): **PASS=78**, SUPERSEDED=4 (`/sales*`), N/A_TEMPLATE=3, PARTIAL=2
- Bundle markers present: Hunt clients, Capture inbound, Hrmny, Agent harness, customAgents, creative, Tickets, Notifications, Composio, Reconnect

## Section highlights

- **Routes & APIs**: largely PASS on prod (auth-gated 200 / protected 401)
- **Creative Hub / Task Propagation / UI Controls**: UI routes live; deep control proofs need `@hrmny.co` SSO
- **RAG & Learning**: SKIP_LLM (except pgvector foundation PARTIAL)
- **Role Journeys + Sign-off**: BLOCKED (human / SSO)
- **Implementation Queue (683)**: 537 still TODO_REMAINS; 41 BLOCKED owner gates; 17 mapped PASS from live evidence

## Drive artifacts

| Artifact | URL |
|----------|-----|
| Audit index | https://docs.google.com/spreadsheets/d/1x44fq-qKTTh3PIuj9d3JCsZS4oelHm8-m0WdWAHTya8 |
| Dashboard | https://docs.google.com/spreadsheets/d/19CDN7iPY9RPPJZznHBtJau2NKZIoRRFFHfSjGwWqZbk |
| Summary doc | https://docs.google.com/document/d/1tmex8mqkgfo4VKs-vtsbm3P92S6OEIJ3G9BFTlfr84E |
| Owner actions (slim) | https://docs.google.com/spreadsheets/d/10y6gYcZYQQ9omC-dJi21hWaMtjjb5GXj437kYQHiuUA |
| Part A routes/integrations | https://docs.google.com/spreadsheets/d/1pO2pKmaEitGYQ7EiJss2pCVG2lOowhqeuQiTcBccWUA |
| IQ actionable | https://docs.google.com/spreadsheets/d/1yIzyDzV0R2HreRy2lODJ5XYTvo_f5zdzMF6spehqu9A |
| Full audit CSV (2296 rows) | https://drive.google.com/file/d/1WnKQVeKjpoUwm8TUhVQ52KDtR1-8uthW/view |
| Focus CSV | https://drive.google.com/file/d/1JzTtg_JzucAON16zgW3Adv_Q90psD_Be/view |
| Prior live test | https://docs.google.com/spreadsheets/d/107TARos-8OZ9r_PZNy6AzVZwDWWpQq93mksjHxphWoc |
| Original checklist | https://docs.google.com/spreadsheets/d/118yT7_g0hG57zCkG62PACQIVuhocNkJNbq3fCwiKFf0 |

Repo copies: `docs/audits/*.csv` + `prod_full_smoke.json`.

## Owner next steps (non-LLM)

1. `@hrmny.co` SSO role journeys + UI control click-paths  
2. Paste Apollo / Hunter / Xero / n8n keys (Xero write stays off)  
3. Human sign-off rows  
4. LLM / RAG / creative generation tests (deferred by request)
