# M1 Completion Audit

Audit date: 2026-07-24

## Executive conclusion

The documents use “M1” for two different deliverables:

1. **Current M1 — Substrate:** the first 15-day milestone in the active 90-day build plan.
2. **Old signed Module 1 — Lead-to-Cash:** the much larger commercial system from lead discovery through the Won Deal Handover Pack.

The **current M1 engineering scope is complete and live**. The only remaining closeout is client UAT from the Dubai office and Ayham/Molham's acceptance record. Supabase Singapore and manual Vercel deployment are accepted project exceptions for now.

The **old signed Module 1 is not complete**. Its remaining lead-to-cash integrations, migration, reconciliation, reporting, adoption, and sign-off work are scheduled across the later milestones in the active plan.

## Production evidence

- Production app: `https://hrmny-os.vercel.app`
- Release: `36d7b51b869267a370cff6b67346f8ce0c0b4ef0`
- Deployment: `dpl_5RhpAU5T7LVKF4tUg8dS8QGZWA9y`, Ready, functions in `sin1`
- Authentication: Supabase Google SSO restricted to approved active `@hrmny.co` employees
- Google Workspace: connected and tested for `developer@hrmny.co`
- Database: 36 public tables; all 36 have RLS enabled
- Database region: Supabase `ap-southeast-1` (Singapore), accepted for the current project
- Team directory: 21 active employees, 10 roles, and 21 exact role assignments
- Live evidence: 11 immutable audit events, 5 health signals, 2 completed scheduled jobs, 0 failed jobs, and 1 connected account
- Google Chat: production scheduler acceptance alert delivered successfully
- AI setting: active `llm.spend_cap` convention is AED 10/month; authorized admins can publish a higher version from Conventions
- Verification: 107/107 automated tests, all-package typecheck, and the production build pass

## Current M1 — Substrate

Source: `hrmny_OS_Build_Docs/90-Day-Build-Plan.md`, Sprint 1, and `L7-BACKLOG-epic-story-backlog.md`, E1.

| Requirement                                     | Status                       | Evidence / accepted exception                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting, environments, CI/CD, secrets           | Done with exception          | Vercel production, GitHub Actions CI/scheduler, encrypted Vercel variables, and tested manual production deployment are live. Direct Vercel/GitHub linking is unavailable under the current account arrangement, so release deployment is manual for now. A separate staging environment remains optional follow-up work. |
| UAE-resident PostgreSQL, reconciled model, RLS  | Done with accepted exception | The 36-table schema, migrations, margin view, and full-table RLS are live. Supabase is in Singapore; the client accepted this for now and any UAE migration will be a separate project.                                                                                                                                   |
| Central state-transition and gate engine        | Done                         | Durable CRM transitions, blocked attempts, immutable audit rows, and health signals are database-backed. Legal and illegal transitions passed production acceptance.                                                                                                                                                      |
| Google SSO and Workspace connection             | Done                         | SSO is restricted to the active roster. Google Workspace OAuth is connected, tested, replaceable, and removable from the frontend.                                                                                                                                                                                        |
| RBAC, margin restrictions, separation of duties | Done for provisioning        | The 21-person roster was imported from the supplied workbook with title, department, reporting line, and one least-privilege role per employee. Automated RBAC and AM margin-denial tests pass; real-user UAT remains a client acceptance action.                                                                         |
| Append-only audit                               | Done                         | Core gate, convention, scheduler, health, DAM, connector, roster, and request paths persist audit records. Database triggers prohibit updating or deleting audit and asset-version history.                                                                                                                               |
| DAM: versioned storage and signed URLs          | Done                         | Metadata persists in PostgreSQL, files persist in Supabase Storage, versions are immutable, signed URLs work, and QC is database-backed.                                                                                                                                                                                  |
| Durable jobs and scheduler                      | Done                         | PostgreSQL jobs use atomic claims, stale-lock recovery, retries, and lag monitoring. GitHub Actions invokes the secured worker every five minutes.                                                                                                                                                                        |
| Health signals to Google Chat                   | Done for M1                  | Signals persist in PostgreSQL. A production scheduled alert completed on its first attempt and has a non-null notification timestamp. The AED 10 cap is configured; paid-provider cost metering is intentionally deferred until a paid LLM is enabled.                                                                    |
| App shell, navigation, design system            | Done                         | Implemented and production-built.                                                                                                                                                                                                                                                                                         |
| Versioned conventions-as-data                   | Done                         | Active rules and new versions persist with one-active-version behavior, UI management, and audit history.                                                                                                                                                                                                                 |
| Gate/RBAC/security test harness                 | Done                         | 107 automated tests pass.                                                                                                                                                                                                                                                                                                 |
| No-silent-failure / no-double-send substrate    | Done for M1                  | Durable retry, audit, scheduler, alerting, and scaffold checks pass. Provider-specific reconciliation is added with each later live integration.                                                                                                                                                                          |

### Current M1 acceptance status

| Acceptance check                                           | Status                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| Entity transition → gate → immutable database audit        | Passed in production for allowed and blocked transitions.            |
| Real roster and role mapping, including AM margin denial   | Provisioned and automated tests passed; Dubai real-user UAT pending. |
| Versioned DAM asset with signed URL                        | Passed in production; Dubai office upload/open test pending.         |
| Scheduled failure/health event creates a Google Chat alert | Passed in production.                                                |
| Client milestone acceptance                                | Pending Ayham/Molham confirmation after UAT.                         |

## Old signed Module 1 — Lead-to-Cash

Source: `hrmny_OS_Module1_LeadToCash_Discovery_Brief`, Definition of Done §15.3.

| Signed definition-of-done item                                                          | Status  | Remaining work                                                                                                                    |
| --------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Eight-stage lead-to-cash arc for retainers and projects                                 | Partial | Native stages and gates exist; the complete live-integrated journey is later commercial-engine work.                              |
| BUAF, lanes, Apollo→Hunter, rate cards/margin, voice, intelligence graph, proposal + QC | Partial | Core rules/interfaces exist. Apollo/Hunter credentials, production voice, graph, and client-ready proposal generation/QC remain.  |
| Asana replaced and source data reconciled                                               | Open    | Source migration, reconciliation, cutover, and adoption evidence remain.                                                          |
| Whole Dubai team authenticated and provisioned                                          | Partial | All 21 employees are provisioned; each real user still needs to complete first-login UAT.                                         |
| All commercial guardrails enforced                                                      | Partial | Existing gates pass; remaining authority, live-send, reconciliation, and client-output checks ship with the related integrations. |
| No crashes, silent failures, or double sends                                            | Partial | The substrate is live; each external provider still needs its own delivery/reconciliation acceptance test.                        |
| Data trustworthy and Won totals reconciled                                              | Open    | Source-system migration and reconciliation remain.                                                                                |
| Measurable learning/self-evolution loop                                                 | Open    | No attributable commercial experiment is live yet.                                                                                |
| Live commercial KPIs                                                                    | Partial | Dashboard scaffolding exists; KPIs need reconciled live sales and advertising feeds.                                              |
| Ayham and Molham sign-off                                                               | Open    | No acceptance record supplied yet.                                                                                                |

Result: the old signed Module 1 remains a multi-milestone outcome; it should not be represented as completed by the current substrate milestone.

## Connection readiness

| Connection            | State                      | Next action                                                                                                                          |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Supabase Google SSO   | Live                       | Dubai staff perform first-login UAT.                                                                                                 |
| Google Workspace APIs | Live for developer account | Other users connect their own Workspace account only when their role needs it.                                                       |
| Google Chat           | Live                       | Rotate the webhook after acceptance because the original credential was pasted into chat, then update the encrypted Vercel variable. |
| Bayzat                | Workbook import complete   | API access is optional later; CSV/XLSX remains the fallback.                                                                         |
| Apollo                | Backend/UI ready           | Paste a key in Settings when available.                                                                                              |
| Hunter                | Backend/UI ready           | Paste a key in Settings when available.                                                                                              |
| Xero                  | Mock only                  | Provide OAuth app and tenant access when finance integration starts.                                                                 |
| Canva                 | Placeholder                | Provide an approved app/integration when creative automation starts.                                                                 |
| Asana/Airtable        | Not connected              | Provide source access and confirm final cutover sequence.                                                                            |
| LinkedIn              | Draft/copy only            | Keep V1 human-sent unless approved platform access changes the design.                                                               |

## Dubai office acceptance script

1. On Dubai office Wi-Fi, open `https://hrmny-os.vercel.app` in Chrome and sign in with one Account Manager account and one Director/Partner account.
2. Confirm both reach the app; confirm the Account Manager cannot see margin/cost while the Director/Partner can access their authorized views.
3. In Assets, upload one non-sensitive JPG or PDF, create a new version, and open its signed link.
4. In CRM, move a test deal through one legal next stage, then attempt an illegal stage jump and confirm it is blocked.
5. Ask the Director/Partner to open Audit and confirm the upload, legal transition, and blocked attempt are recorded.
6. Repeat login and signed-file opening once on a phone using mobile data.
7. Send back the tester names, timestamps, browser/device, screenshots, and any error text. Do not send client-confidential production material for this test.

## Remaining closeout

1. Dubai office completes the acceptance script.
2. Ayham and Molham confirm current M1 acceptance in writing.
3. Rotate the Google Chat webhook and replace the encrypted production value.

Apollo/Hunter keys, Xero/Canva access, automatic Vercel Git deployment, staging, and any future UAE data migration are later work and do not block current M1 acceptance.
