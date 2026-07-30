# PLAN-PRODUCTION — governing production plan

**Adopted:** 2026-07-30 by Ahmad Bukhari (supersedes MASTER-PLAN-V2 scope; M7-M12 history remains valid). **Frozen baseline:** commit `be160d3`. Phase tracking lives in the orchestrator session; inventory deliverables land in `docs/inventory/`.

# HRMNY OS — Production-Ready AI Agency Operating System

## Refined Goal

Build and launch **HRMNY OS** as the secure, production-grade control plane from which HRMNY operates its complete agency lifecycle: research and lead generation, CRM and sales, client onboarding, project management, creative production, client approvals, campaigns, finance, HR, reporting, and continuous improvement.

At launch, 10–20 invited real users must be able to use the internet-hosted application without encountering broken routes, dead buttons, unfinished boards, mock behavior, missing data flows, serious errors, or cross-module inconsistencies. Every visible function must work end to end.

AI will be permission-aware, explainable, and advisory by default. An audited frontend policy can later enable scheduled internal research, scoring, monitoring, and drafting. External communications, client decisions, accounting or payroll posts, spend changes, and money movement always require authorized human approval.

## End-State Capabilities

- **AI CRM and sales:** companies, contacts, activities, deals, pipelines, forecasts, inbound forms, Apollo intent, relationship-led leads, RFP discovery, verified contacts, nurture, approved outreach, reply classification, proposals, DocuSign, win/loss analysis, renewals, and Won-to-delivery handover.
- **Research and intelligence:** scheduled sector scans, company dossiers, competitor monitoring, social/website/campaign benchmarking, decision-maker research, market signals, pre-meeting briefs, cited evidence, freshness tracking, deduplication, and research-to-lead promotion.
- **Explainable ratings:** versioned 0–100 scorecards for leads, opportunities, relationships, clients, briefs, projects, assets, campaigns, vendors, and system health. Every score includes weights, evidence, freshness, confidence, version, and justified overrides. AI does not rate employee performance.
- **Client and delivery operations:** scopes, onboarding, briefs, calendars, projects, tasks, forms, workflows, dependencies, capacity, time, creative states, QC, versioned DAM, proofing, revisions, publishing, campaign delivery, reporting, and support.
- **Transactional client portal:** client-scoped magic-link access for deliveries, calendars, reports, approvals, request-changes decisions, consolidated feedback, proofing comments, and controlled uploads. Finance, margin, salaries, internal costs, and other clients’ data remain inaccessible.
- **Finance and People:** Xero-backed invoice intake, reconciliation, billing, margin, budgets, VAT, and separation-of-duties payroll; native HR, recruitment, onboarding, attendance, leave, reviews, benefits, expenses, workplace services, and payroll preparation.
- **Reporting:** executive cockpit, configurable dashboards, report builder, scheduled reports, drill-downs, exports, forecasts, anomaly alerts, attribution, client health, capacity, creative quality, campaigns, margin, VAT, people, adoption, automation health, AI quality, and platform cost.
- **Administration:** frontend control of users, roles, permissions, features, scorecards, conventions, workflows, integration status, report schedules, AI policies, budgets, and migrations. Secrets and emergency infrastructure controls remain in Keeper and protected operational consoles.

## Complete-Application Quality Requirements

- Every production route, navigation item, button, form, filter, search, table action, menu, link, approval, download, upload, notification, automation, and integration control must connect to its intended backend behavior.
- Every mutation must validate input, enforce authorization, use safe database transactions where required, produce an audit record, refresh the frontend state, and display a clear success or failure result.
- Every screen must have intentional loading, empty, permission-denied, validation, timeout, unavailable-provider, retry, and unexpected-error states.
- Deep links, refreshes, browser back/forward navigation, expired sessions, duplicate submissions, slow connections, simultaneous edits, and interrupted workflows must behave predictably.
- Production navigation may expose only accepted features. Development switchers, demo data, placeholders, mock actions, unfinished boards, orphan routes, duplicate legacy screens, and “coming soon” controls must be removed or completely hidden behind disabled feature flags.
- A route-and-action acceptance inventory must cover every production-visible control. Automated checks must fail if a route returns an unexpected error, a link reaches a missing page, or a visible control has no accepted action.
- All internal module boundaries must be exercised: CRM→proposal, Won→client, client→project, brief→creative, creative→portal, approval→delivery, delivery→reporting, billing→Xero, HR→payroll, and all related dashboards.
- Launch is blocked by any unresolved P0/P1 defect, broken critical journey, security or isolation failure, data-loss risk, silent integration failure, or visible unfinished feature. Lower-severity defects must be documented, non-blocking, and explicitly accepted.

## Platform, Data, and Extensibility

- Make **native HRMNY Work** the work-management system of record. Import and reconcile Asana, run delta synchronization during cutover, then archive or retire Asana. Do not add Airtable as another operational layer.
- Consolidate the Sales & Growth SQLite system, workflows, intelligence, and history into the primary PostgreSQL model with source lineage and reconciliation evidence.
- Complete native People, validate it through parallel HR/payroll cycles, and retire Bayzat only after signed reconciliation and rollback gates pass.
- Keep Xero as the financial ledger. HRMNY OS may prepare, approve, post, and reconcile records but never disburses money.
- Introduce versioned scorecard definitions, snapshots, evidence, and overrides. Score visibility must inherit the permissions of its underlying evidence.
- Keep AI autonomy `manual` by default, with an optional audited `scheduled_research` mode. Scheduled mode may perform internal research and drafting but cannot perform external side effects.
- Use the existing domain modules, central gate engine, feature catalogue, permissions, shared contracts, and integration adapters. Do not introduce a speculative plugin framework.
- New features must be additive and isolated: versioned interfaces, backward-compatible database migrations, explicit permissions, feature flags, audit coverage, dependency checks, and automated regression tests.
- A new feature remains disabled until its migration, frontend, backend, authorization, audit, tests, documentation, and rollback behavior pass acceptance. Turning it off must restore existing behavior without corrupting existing data.
- Each capability is one complete vertical slice: usable frontend, authenticated backend, durable database/object storage, authorization, audit, retries/reconciliation, monitoring, automated tests, and UAT. Partial slices do not count as delivered.

## Delivery Plan

1. **Baseline and inventory:** freeze the accepted code baseline; catalogue every route, feature, button, API, job, integration, database table, mock, beta surface, duplicate screen, and known defect.
2. **Production foundation:** complete environment separation, live providers, ownership, security, monitoring, backups, migrations, incident response, performance controls, and rollback.
3. **Revenue engine:** consolidate Sales & Growth, CRM, research, competitor intelligence, ratings, outreach approvals, quoting, contracting, forecasting, and handover.
4. **Work and client delivery:** production-accept native Work, creative and campaign operations, DAM/proofing, resource planning, and portal approvals.
5. **Finance and People:** complete live Xero workflows, native People, migration reconciliation, parallel payroll validation, and controlled Bayzat retirement.
6. **Reporting and intelligence:** complete executive and functional dashboards, scheduled reporting, AI governance, evaluations, and scorecard administration.
7. **Whole-app hardening:** close every dead control, broken route, rough board, incomplete edge state, accessibility issue, and cross-module inconsistency.
8. **Controlled launch:** deploy publicly over HTTPS but restrict access to the invited 10–20 testers through SSO or client magic links; run production smoke tests, role-based UAT, rollback rehearsal, training, and 30-day hypercare.

## Test Plan and Definition of Done

- Automatically crawl every production route for every applicable role and verify navigation, direct access, refresh, responsive rendering, error boundaries, and permission enforcement.
- Exercise every visible button and form through browser-level tests, confirming the correct API call, stored result, audit event, frontend refresh, and user feedback.
- Prove the complete business thread: researched lead → score → verified contact → approved outreach → deal → proposal → signed agreement → onboarding → project → creative QC → client approval → delivery → report → invoice and margin.
- Verify portal cross-client isolation, financial exclusion, approval idempotency, annotated feedback, signed downloads, uploads, and complete auditing.
- Verify ratings, evidence freshness, restricted-data redaction, rule/model versioning, overrides, recalculation, manual fallback, and role-based explanations.
- Verify manual AI mode prevents unattended activity and scheduled-research mode cannot send, post, approve, spend, or change business records without authorization.
- Test provider outages, token expiry, rate limits, duplicates, concurrency, partial failure, retry exhaustion, restore, rollback, and disaster recovery with no silent failure or double action.
- Reconcile migrated counts, relationships, attachments, histories, financial totals, payroll values, and external identifiers before retiring any system.
- Run regression tests across unaffected modules whenever a feature, schema, connector, permission, or shared component changes.
- Pass RBAC/RLS, separation-of-duties, privacy, vulnerability, penetration, accessibility, mobile/responsive, load, monitoring, backup, and recovery checks.
- Meet the targets: common screens below approximately 2 seconds p95, routine actions below approximately 1 second, 100-user headroom, 99.5% monthly availability, daily backups, and recovery within 24 hours.
- Complete a final manual route-and-control walkthrough using partner, sales, AM/CS, traffic, creative, finance, HR, employee, administrator, and two separate client accounts.
- Deploy the release candidate and run production smoke tests from desktop and mobile networks. The release is accepted only when critical workflows pass and no major defect remains.

## Locked Assumptions

- The target is the complete production end-state, delivered through gated releases.
- Product name remains **HRMNY OS** unless formally renamed.
- Singapore is accepted as the permanent production region, subject to documented cross-border-transfer and privacy approval.
- Native HRMNY Work replaces Asana after controlled migration; native People replaces Bayzat after parallel validation.
- AI does not score individual employee performance.
- LinkedIn remains human-sent, and all external sends remain human-approved.
- Multi-tenant SaaS productization is excluded.
- Public deployment means internet-accessible but authenticated and invite-only—not anonymously open.
- Exact dates and budget are set after ownership, access, migration inventories, and acceptance data are complete.
