# SSO role smoke checklist (invite-only launch)

Run after Tier-1 secrets are filled (`AUTH_MODE=supabase`, Google SSO, `DATABASE_URL`).

| Role | Login | Must see | Must not see / must fail |
|------|-------|----------|--------------------------|
| partner | `@hrmny.co` SSO | Home, CRM, Work, Delivery, Finance, Dashboards, People, Margin | Demo reset buttons (unless `FEATURE_SHOW_DEMO_RESETS`) |
| finance | SSO | Finance mirror, Billing, Margin, Payroll finalize | Xero write/post controls; salaries via default LLM |
| hr | SSO | People headcount, Leave log/attendance, Payroll confirm | ESS benefits/workplace/digital card (default off) |
| am | SSO | CRM, Clients, Delivery | Margin payload (`canViewMargin=false`) |
| creative | SSO | Delivery, Creative QC, Work | Privileged salary queries; Finance write |

## Smoke steps

1. Sign in via `/login` (Google Workspace).
2. Confirm primary nav includes **Dashboards** and Finance links to Billing / Payroll / Margin (role-gated).
3. `/finance` shows “Synced from Xero” and **Mark issued (OS only)** — no Post to Xero.
4. `/time` as staff shows remaining leave only; as HR shows log/approve controls.
5. `/clients` shows retainer vs project delivery rhythm labels.
6. `/delivery` shows contract → rhythm panel.
7. Attempt privileged AI domain as creative → sandbox deny; as partner/finance/hr → privileged workspace.

Document pass/fail in Keeper ops log before inviting the 10–20 user cohort.
