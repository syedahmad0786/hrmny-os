# M1 Completion Audit

Audit date: 2026-07-23

## Executive conclusion

The two documents use “M1” for different deliverables:

1. **Current M1 — Substrate:** the first 15-day milestone in the 90-day build plan.
2. **Old signed Module 1 — Lead-to-Cash:** the complete commercial system from lead discovery through the Won Deal Handover Pack.

Neither definition is 100% complete in real-world production today. The current M1 has a working foundation and passing demos, but several acceptance paths still use the in-memory demo store. The old Module 1 is substantially larger and now maps mostly to the current M3 Commercial Engine, plus migration, reporting, adoption, and sign-off work.

## Production evidence

- Production app: `https://hrmny-os.vercel.app`
- Authentication: Supabase Google SSO is enabled and restricted to approved `@hrmny.co` staff.
- Database: 35 public tables, all 35 with RLS enabled.
- Database region: Supabase `ap-southeast-1` (Singapore).
- Live provisioning: 3 employee records, 6 roles, and 3 role assignments.
- Live acceptance records at audit time: 0 `audit_event`, 0 `asset`, 0 `asset_version`, 0 `health_signal`, and 0 `connection_account` rows.
- Verification: web typecheck passed, production build passed, and 57/57 automated tests passed.

## Current M1 — Substrate

Source: `hrmny_OS_Build_Docs/90-Day-Build-Plan.md`, Sprint 1, and `L7-BACKLOG-epic-story-backlog.md`, E1.

| Requirement                                     | Status              | Evidence / remaining work                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting, environments, CI/CD, secrets           | Partial             | Vercel production, GitHub Actions CI, and Vercel encrypted environment variables are live. Azure and Keeper were replaced by the agreed Vercel + Supabase stack. A separately configured staging environment and infrastructure-as-code equivalent are not complete. |
| UAE-resident PostgreSQL, reconciled model, RLS  | Partial / exception | The expanded 35-table schema, migrations, `v_client_margin`, and RLS are live. Supabase is in Singapore, not the UAE. Supabase hosted projects currently have no UAE region, so this needs a written contract exception or a database move.                          |
| Central state-transition and gate engine        | Partial             | The reusable engine and domain gates exist and are tested. Persistent CRM state transitions work, but transition audit and health emission still write to the in-memory demo store.                                                                                  |
| Google Workspace SSO and sessions               | Done                | Production Google SSO works for approved Harmony staff accounts.                                                                                                                                                                                                     |
| RBAC, margin restrictions, separation of duties | Partial             | Server-side session role loading, AM margin redaction, and gate checks exist. Production has only 3 provisioned demo employees and 6 roles. The required whole-team roster and 25-title mapping are absent; `role.legacy_titles` does not exist.                     |
| Append-only audit                               | Partial             | The table and browser-role lock-down exist. Several real connector/request paths insert audit rows, but core M1 gate, convention, health, and DAM paths still audit in memory. A database-level UPDATE/DELETE prevention trigger is also absent.                     |
| DAM: versioned storage and signed URLs          | Partial             | Supabase Storage and signed-URL code are configured. Asset/version metadata remains in the demo store on the M1 route, so the production database acceptance path has not been proven.                                                                               |
| Durable background jobs and scheduler           | Open                | No persistent worker/timer system is running for SLA, T-48h, renewals, retries, or reconciliation. Current “job” behavior is callable demo logic.                                                                                                                    |
| Five health signals to Google Chat              | Open                | Five signal names are seeded and a webhook stub exists, but `GOOGLE_CHAT_WEBHOOK_URL` is not configured, signals are not persisted by the M1 route, and no durable monitors run.                                                                                     |
| App shell, navigation, design system            | Done                | Implemented and production-built.                                                                                                                                                                                                                                    |
| Versioned conventions-as-data                   | Partial             | Schema/seed and UI exist; current read/write route uses the demo store instead of the database.                                                                                                                                                                      |
| Gate-engine test harness                        | Done                | Automated gate, RBAC, security, and module tests pass.                                                                                                                                                                                                               |
| No-silent-failure / no-double-send scaffold     | Done as scaffold    | The required M1 scaffold and tests exist. End-to-end reconciliation cannot be proven until live external sends and durable jobs are connected.                                                                                                                       |

### Current M1 acceptance demo status

| Acceptance check                                             | Status                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Entity transition → gate → immutable database audit row      | Partial: gate works; audit path is still memory-backed.                            |
| Every real staff role allow/deny, including AM margin denial | Partial: logic works; full roster and title mapping are missing.                   |
| Versioned DAM asset with signed URL                          | Partial: implementation exists; persistent production metadata path is incomplete. |
| Killed integration creates a Google Chat alert               | Not complete.                                                                      |

Therefore, **current M1 should not yet be marked accepted or payment-complete without explicit waivers**.

## Old signed Module 1 — Lead-to-Cash

Source: `hrmny_OS_Module1_LeadToCash_Discovery_Brief`, Definition of Done §15.3.

| Signed definition-of-done item                                                                                                     | Status  | Evidence / remaining work                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eight-stage lead-to-cash arc for retainers and projects                                                                            | Partial | Native CRM stages, BUAF, quote/margin, outreach approval demos, and Won/handover scaffolding exist. The full arc is not operating against live integrations and persistent production data end to end.                                          |
| Proven logic native: BUAF, lanes, Apollo→Hunter, rate cards/margin, voice, intelligence graph, branded proposal + deterministic QC | Partial | BUAF, pricing/margin, lanes, and provider interfaces exist. Live Apollo/Hunter credentials are absent; voice model, intelligence graph, and client-ready proposal generation/QC are not complete.                                               |
| Asana fully replaced, data migrated/reconciled, daily adoption                                                                     | Open    | No live Asana migration, Won-total reconciliation, cutover, or team adoption evidence. The later roadmap changes task operations to an Asana→Airtable cutover, but the old commercial migration obligation still needs an explicit disposition. |
| Whole Dubai team authenticated and provisioned                                                                                     | Partial | SSO works, but only 3 employee records/assignments exist; the real roster is not provisioned.                                                                                                                                                   |
| All commercial guardrails code-enforced                                                                                            | Partial | Several gates and margin redaction exist. Live send kill/reconciliation, AED 500K/AED 250K authority gates, production voice routing, and complete client-output leakage tests are not proven.                                                  |
| No crashes, silent failures, or double sends                                                                                       | Partial | Test scaffolding exists. Live provider reconciliation, durable retries, monitoring, and alerting are not operational.                                                                                                                           |
| Data trustworthy and Won totals reconciled                                                                                         | Open    | No source-system migration/reconciliation has been completed.                                                                                                                                                                                   |
| Measurable learning/self-evolution loop                                                                                            | Open    | No attributable before/after commercial experiment is running.                                                                                                                                                                                  |
| Live commercial KPIs                                                                                                               | Partial | Dashboard/UI scaffolding exists; booked topline, win rate by value, meetings/week, pipeline coverage, and active pipeline are not all fed by reconciled live data.                                                                              |
| Ayham and Molham sign-off                                                                                                          | Open    | No acceptance record supplied.                                                                                                                                                                                                                  |

Result: **0 of the 10 signed Definition-of-Done items are fully evidenced; 6 are partial and 4 are open.**

## Authentication and connection readiness

| Connection            | State                               | Owner action still required                                                                                                                                                                                                 |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase Google SSO   | Live                                | None for `developer@hrmny.co`; each additional staff account must be provisioned to a role.                                                                                                                                 |
| Google Workspace APIs | Backend/UI ready                    | Each user clicks **Connect Google Workspace** once to grant Gmail, Calendar, Drive, and Sheets scopes. Tokens are verified to `@hrmny.co`, stored in Supabase Vault, refreshable, replaceable, and removable from Settings. |
| Apollo                | API-key backend ready               | Paste the key in Settings when available.                                                                                                                                                                                   |
| Hunter                | API-key backend ready               | Paste the key in Settings when available.                                                                                                                                                                                   |
| Bayzat                | API-key backend ready, CSV fallback | Supply API access if available; otherwise use CSV.                                                                                                                                                                          |
| Xero                  | Mock connector only                 | Create/provide the Xero OAuth app credentials and tenant access; frontend connect/disconnect remains to be built.                                                                                                           |
| Canva                 | Disabled placeholder                | Create/provide a Canva OAuth app or approved integration access.                                                                                                                                                            |
| Asana/Airtable        | Not connected                       | Provide source-workspace access and confirm the final migration target/sequence.                                                                                                                                            |
| LinkedIn              | Copy-draft only by design           | No account automation connection recommended for V1.                                                                                                                                                                        |

## Order required to close current M1

1. Replace demo-store writes for gate audit, health, conventions, and DAM metadata with database transactions.
2. Add database-level audit immutability and execute the full production acceptance test.
3. Add a durable scheduler/worker with idempotency, retries, job-lag monitoring, and reconciliation.
4. Configure Google Chat and implement the five real health detectors.
5. Import the real staff roster, map all legacy titles, assign roles, and run allow/deny tests per person.
6. Configure staging/preview secrets and deployment promotion checks.
7. Obtain written approval for Supabase Singapore residency, or move PostgreSQL/storage to a UAE-resident service.
8. Record Ayham/Molham acceptance for the milestone.
