# M1 Completion Audit

Audit date: 2026-07-24

## Executive conclusion

The two documents use “M1” for different deliverables:

1. **Current M1 — Substrate:** the first 15-day milestone in the 90-day build plan.
2. **Old signed Module 1 — Lead-to-Cash:** the complete commercial system from lead discovery through the Won Deal Handover Pack.

Neither definition is 100% client-accepted today. The current M1 production code and durable acceptance paths are substantially complete; final acceptance is blocked by client-owned inputs (Google Chat, the full staff roster/title map, data-residency disposition, and partner sign-off). The old Module 1 is substantially larger and now maps mostly to the current M3 Commercial Engine, plus migration, reporting, adoption, and sign-off work.

## Production evidence

- Production app: `https://hrmny-os.vercel.app`
- Authentication: Supabase Google SSO is enabled and restricted to approved `@hrmny.co` staff.
- Database: 36 public tables, all 36 with RLS enabled.
- Database region: Supabase `ap-southeast-1` (Singapore).
- Live provisioning: 3 employee records, 6 roles, and 3 role assignments.
- Live acceptance records at audit time: 8 `audit_event`, 1 `asset`, 1 `asset_version`, 3 `health_signal`, 1 `scheduled_job`, and 0 `connection_account` rows.
- Verification: all-package typecheck passed, production build passed, and 106/106 automated tests passed.

## Current M1 — Substrate

Source: `hrmny_OS_Build_Docs/90-Day-Build-Plan.md`, Sprint 1, and `L7-BACKLOG-epic-story-backlog.md`, E1.

| Requirement                                     | Status              | Evidence / remaining work                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting, environments, CI/CD, secrets           | Partial             | Vercel production, GitHub Actions CI, and Vercel encrypted environment variables are live. Azure and Keeper were replaced by the agreed Vercel + Supabase stack. A separately configured staging environment and infrastructure-as-code equivalent are not complete.                   |
| UAE-resident PostgreSQL, reconciled model, RLS  | Partial / exception | The expanded 35-table schema, migrations, `v_client_margin`, and RLS are live. Supabase is in Singapore, not the UAE. Supabase hosted projects currently have no UAE region, so this needs a written contract exception or a database move.                                            |
| Central state-transition and gate engine        | Done for M1         | Durable CRM state transitions, blocked attempts, immutable audit rows, and health emission are database-backed. Both a legal transition and an illegal transition were executed successfully against production.                                                                       |
| Google Workspace SSO and sessions               | Done                | Production Google SSO works for approved Harmony staff accounts.                                                                                                                                                                                                                       |
| RBAC, margin restrictions, separation of duties | Partial / input     | Server-side session role loading, AM margin redaction, and gate checks exist. Production has only 3 provisioned employees and 6 roles. `role.legacy_titles` is ready, but the client has not supplied the whole-team roster and exact 25-title mapping to import.                      |
| Append-only audit                               | Done for M1         | Core gate, convention, scheduler, health, DAM, connector, and request paths persist audit records. Database triggers prohibit UPDATE/DELETE on audit events and asset versions.                                                                                                        |
| DAM: versioned storage and signed URLs          | Done for M1         | Asset/version metadata persists in PostgreSQL, files persist in Supabase Storage, versions are immutable, signed URLs work, and Creative Director/Partner QC is database-backed. The production acceptance asset and version were created successfully.                                |
| Durable background jobs and scheduler           | Done for M1 core    | PostgreSQL-backed jobs use atomic claiming, stale-lock recovery, three-attempt retries, and job-lag monitoring. A secured GitHub Actions runner invokes the Vercel worker every five minutes without requiring Vercel Pro. Domain-specific M2–M6 timers remain later work.             |
| Five health signals to Google Chat              | Partial / input     | Signals persist in PostgreSQL; `gate_blocked`, `auth_denied`, `dam_upload`, and `job_lag` are wired to real paths, and arbitrary health jobs are schedulable. Google Chat cannot deliver until the client supplies a webhook. Real LLM spend metering is still needed for `spend_cap`. |
| App shell, navigation, design system            | Done                | Implemented and production-built.                                                                                                                                                                                                                                                      |
| Versioned conventions-as-data                   | Done for M1         | Active conventions and all new versions persist in PostgreSQL with a one-active-version write transaction, unique version constraint, UI management, and audit history.                                                                                                                |
| Gate-engine test harness                        | Done                | Automated gate, RBAC, security, and module tests pass.                                                                                                                                                                                                                                 |
| No-silent-failure / no-double-send scaffold     | Done as scaffold    | The required M1 scaffold and tests exist. End-to-end reconciliation cannot be proven until live external sends and durable jobs are connected.                                                                                                                                         |

### Current M1 acceptance demo status

| Acceptance check                                             | Status                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Entity transition → gate → immutable database audit row      | Passed in production for legal and blocked transitions.                  |
| Every real staff role allow/deny, including AM margin denial | Partial: logic works; full roster and title mapping are missing.         |
| Versioned DAM asset with signed URL                          | Passed in production; one immutable version and signed URL were created. |
| Killed integration creates a Google Chat alert               | Code path ready; blocked by missing client Google Chat webhook.          |

Therefore, **current M1 engineering is near complete, but should not be marked client-accepted or payment-complete until the remaining client inputs and acceptance test are recorded**.

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

1. Client supplies the Google Chat incoming-webhook URL; configure it and run the killed-integration alert test.
2. Add real LLM usage/cost metering before enabling a paid provider, then prove the `spend_cap` signal.
3. Client supplies the real staff roster and 25-title mapping; import it, assign roles, and run allow/deny tests per person.
4. Configure preview/staging secrets and record a deployment-promotion check if this remains an M1 contractual requirement.
5. Obtain written approval for Supabase Singapore residency, or authorize a move to a UAE-resident database/storage service.
6. Record Ayham/Molham acceptance for the milestone.
