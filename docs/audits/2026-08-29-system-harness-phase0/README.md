# HRMNY OS system-harness Phase 0 audit

Date: 2026-08-29
Client/project: `client-uae-creative-01/hrmny-os`
Actor signature: host `Bukhari-Laptop`; supervisor `Codex /root`; bounded read-only audit agents; branch `ahmadbukhari097/codex/phase-0-baseline-20260829`; baseline commit `c9b420d9ad3852ea5aef042b3ad21c0399f2f72a`.

## Outcome

Nine bounded, read-only audits reconciled the current repository, Harmony specifications, UI/roles, Sales Growth, QM/Fly, Google Chat, GBrain/memory, client portal, and testing/recovery evidence. The canonical repository was fetched and verified unchanged from current `origin/main`; all implementation work is isolated from the dirty coordination workspace.

The existing system is substantial and should be repaired, not rebuilt. Supabase/PostgreSQL remains operational authority; Vercel remains the accepted application host; the Sales Growth loop remains `Signal -> Research -> Person -> Outreach -> Pipeline -> Learn`. QM, interactive Google Chat, governed GBrain memory, and a secure portal are new controlled capabilities, not current runtime proof.

## Immediate containment order

1. Make `/api/ready` strictly read-only and preserve a disabled connected-app policy.
2. Separate deterministic tests from live-provider/live-database tests; refuse the canonical production database in synthetic proof.
3. Align Node 24 across repository and workflows.
4. Disable synthetic scheduled Sales data and legacy live-capable lead generation until a reviewed source and atomic claim exist.
5. Disable staff/AI impersonation of client approvals and the demo portal-link fallback.
6. Repair the portal identity/publication spine before exposing additional client workflows.

## Highest evidenced state

| Area                          | Highest evidenced state                                  | Not yet evidenced                                                 |
| ----------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| Repository baseline           | documented + locally verified                            | reviewed/merged change                                            |
| Current production app        | older deployed SHA and healthy public readiness response | authenticated current-SHA role journey                            |
| Database migrations 0068-0074 | deployed + destination verified                          | separate-target restore/recovery                                  |
| Apollo                        | zero-credit discovery provider accepted                  | paid exact-person destination/replay acceptance                   |
| Other providers               | mostly code tested/configured                            | provider and destination acceptance                               |
| QM/Fly                        | official upstream audited                                | configured/deployed/isolation accepted                            |
| Google Chat interactive app   | official contract audited                                | configured/deployed/provider accepted                             |
| GBrain                        | stable upstream pin audited                              | organization runtime and isolation accepted                       |
| Portal                        | code + limited deterministic tests                       | identity repair, publication boundary, live RLS, named-client UAT |
| Overall                       | planned/documented/tested in parts                       | recovery, user, and production acceptance                         |

Do not collapse `planned -> documented -> authorized -> configured -> tested -> deployed -> provider accepted -> destination verified -> recovery verified -> user accepted -> production accepted`.

## Package

- [Execution charter](./EXECUTION-CHARTER.md)
- [Source register](./SOURCE-REGISTER.md)
- [Decisions](./DECISIONS.md)
- [Reasons](./REASONS.md)
- [Trade-offs](./TRADEOFFS.md)
- [Gaps](./GAPS.md)
- [Failures](./FAILURES.md)
- [Outcomes](./OUTCOMES.md)
- [Evidence](./EVIDENCE.md)
- [Runbooks](./RUNBOOKS.md)

Harness state is project-local under `.system-harness/`. Its corrected run is `20260829T103408Z`; the generated generic topology is retained as proposal evidence only and is not an accepted HRMNY architecture.
