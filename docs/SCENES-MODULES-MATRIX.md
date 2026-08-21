# hrmny OS — Scenes / Modules Matrix (Phase lock)

**Source:** Blueprint [hrmny-operating-system-blueprint](https://hrmny-operating-system-blueprint.vercel.app/) · Granola [hrmny - OS 14 Aug 2026](https://notes.granola.ai/t/95ef6637-f16f-4de0-be55-548721397604-00demib2) · [`docs/inventory/ROUTES.md`](./inventory/ROUTES.md)

**Rule (client):** Modules not explicitly connected in this phase will **not** be linked later without scoping new work.

| Module / scene | Route(s) | In this phase? | Integrations | Owner | Notes |
|----------------|----------|----------------|--------------|-------|-------|
| Auth / staff shell | `/login`, `/` | **Yes** | Supabase SSO, Google Workspace | Ops | Invite-only `@hrmny.co` |
| CRM pipeline | `/crm/*` | **Yes** | Apollo/Hunter deferred | Sales | Already largely live |
| Clients / onboarding | `/clients`, `/clients/[id]` | **Yes** | — | AM | Engagement type retainer\|project |
| Delivery / traffic / creative | `/delivery`, `/traffic`, `/creative`, `/account` | **Yes** | — | Traffic / CD | Kill demo resets in prod |
| Native Work | `/work/*` | **Yes** | Asana migration optional | Delivery | Hide unfinished AI Studio if mock-only |
| Finance mirror | `/finance`, `/billing` | **Yes** | **Xero read only** | Finance | Never write to Xero |
| Margin | `/margin` | **Yes** | — | Partner / finance | Partner/finance only |
| Dashboards | `/dashboards` | **Yes** | — | Partner | Wire nav (orphan today) |
| People master headcount | `/people` | **Yes** | Bayzat CSV parallel | HR / Partner | Hire/fire first in OS |
| Leave & attendance (admin) | `/time` | **Yes** | — | HR | Admin logs leave/attendance |
| Leave balance (staff) | `/time` (balance panel) | **Yes** | — | All staff | Remaining days only |
| Payroll prep | `/payroll`, `/workforce-payroll` | **Yes** | Xero JE **disabled** | HR + Director | Prep only; no Xero post |
| Approvals HITL | `/approvals` | **Yes** | — | Role owners | Wire off mock-data when possible |
| Connections | `/settings/connections` | **Yes** | Xero OAuth read, Composio deferred | Admin | |
| AI admin | `/settings/ai` | **Partial** | Dual OpenRouter | Admin | Privileged workspace sandboxed |
| Client portal | `/portal/*` | **Yes** | Magic link | Clients | No finance/salaries |
| Talent / performance | `/talent` | **No — deferred** | — | — | Not day-to-day ESS |
| Benefits | `/benefits` | **No — deferred** | — | — | Feature flag off |
| Workplace | `/workplace` | **No — deferred** | — | — | Feature flag off |
| Digital cards | `/my-card`, `/card/[slug]` | **No — deferred** | — | — | Feature flag off |
| Shifts / work-schedule | `/work-schedule` | **No — deferred** | — | — | Keep code; hide from hub |
| Gate demo | `/gate` | **No** | — | Dev only | Orphan / hide in prod |
| Ads analytics | — | **No** | Meta/Google/TikTok | V2 | |
| AEO product | — | **No** | — | Commercial parallel | Not OS |

## Contract types (locked)

| Type | Delivery rhythm | Billing cue |
|------|-----------------|-------------|
| `retainer` | Recurring checkpoints | Recurring cycles |
| `project` | Milestone touchpoints | One-time / progress |

## Integration seams locked this phase

| From → To | Connected? |
|-----------|------------|
| CRM won → client/onboarding | Yes |
| Client engagement type → delivery rhythm | Yes (this phase) |
| Finance ↔ Xero (read/mirror) | Yes |
| Finance → Xero write/post | **No** (client lock) |
| People ↔ Bayzat (CSV mirror) | Parallel only |
| HR leave → payroll calc inputs | Yes (admin logs) |
| HR ↔ full ESS portal | **No** |
| Privileged salaries → default LLM | **No** (separate OpenRouter key) |

## Scenes explicitly not linked later without new scope

Benefits · Workplace · Digital cards · Talent performance suite · Xero write · Ads analytics · AEO inside OS · Full Bayzat replacement (WPS/EOS/loans).
