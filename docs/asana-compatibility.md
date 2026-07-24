# Asana compatibility programme

Verified against Asana's public product, help-centre, release-note, and developer documentation on 24 July 2026.

## What “100% parity” means

A capability is only marked **available** when all of these are true:

1. Users can complete the workflow in hrmny OS.
2. Feature Lab can control it globally and by client, role, and user.
3. Direct page and API access are both denied when the feature is off.
4. Object permissions and tenant boundaries are enforced server-side.
5. Material changes are audited.
6. Asana identifiers and relationships can be imported without losing fidelity.
7. A runnable check covers the highest-risk rule.

Database tables without a usable workflow do not count as parity. The code-owned catalogue at `apps/web/src/features/catalog.ts` is the live status register; **planned** features cannot be switched on.

## Connection finding

The connection audit found one connected account in the hrmny application:

- Google Workspace — `developer@hrmny.co`

The integration audit found no separately stored Asana account and confirmed that Vercel Preview does not yet have the server-only `COMPOSIO_API_KEY`, so the claimed external Asana connection could not be verified. A live Composio transport, Asana identity/workspace verification, read-only scan, confirmed idempotent import, and cursor-based recurring reconciliation are implemented. The server-side key must be configured before the application can observe the external account.

## Compatibility map

### Work graph and task management

| Asana capability                             | hrmny model                                    | Status    |
| -------------------------------------------- | ---------------------------------------------- | --------- |
| Projects                                     | `work_project`                                 | Available |
| Project members and object roles             | `work_project_member`                          | Beta      |
| Sections / board columns                     | `work_section`                                 | Available |
| Tasks, assignee, dates, priority, completion | `work_item`                                    | Available |
| Subtasks                                     | `work_item.parent_work_item_id`                | Available |
| Milestones and approvals                     | `work_item.item_type`                          | Beta      |
| Multi-home tasks                             | `work_project_item`                            | Beta      |
| Dependencies                                 | `work_item_dependency`                         | Available |
| Comments                                     | `work_comment`                                 | Available |
| Followers                                    | `work_item_follower`                           | Beta      |
| Tags                                         | `work_tag`, `work_item_tag`                    | Beta      |
| Custom fields                                | `work_custom_field`, `work_custom_field_value` | Beta      |
| Attachments                                  | `work_attachment`                              | Beta      |
| Recurring tasks                              | `work_item.recurrence`                         | Beta      |
| Likes and proofing                           | Future activity/proof model                    | Planned   |

### Views and personal work

List, board, monthly Calendar, date-range Timeline, Files, and Gantt views use the same project data and are available in beta. Gantt includes dependencies, critical-path calculation, captured baselines, and schedule variance. My Tasks, Inbox, full-text search, and saved searches are also beta. Advanced personal sections/focus controls, weekly Calendar, and offline work mutation remain planned.

### Intake, automation, and standardisation

Forms, conditional form questions, task-creating submissions, event rules with conditions/branches/actions, rule execution history, task/project templates with relative dates, versioned bundles, and approval decisions are available in beta. Forms currently require an authenticated hrmny user; public external form links, attachment questions, template role placeholders, scheduled rule triggers, external rule actions, and automatic bundle rollout remain planned.

### Goals, portfolios, reporting, and resources

Goals, sub-goals, weighted contributing projects/tasks, portfolio progress and health, structured status updates, live and saved reporting dashboards, CSV export, weekly Workload, capacity allocations, project budgets/cost forecasts, task estimates, manual time entries, and single-user timers are available in beta. They operate on the shared work graph and enforce work-object permissions. Portfolio-wide workload, richer report chart/group/filter builders, goal history, and multi-rate cost models remain planned.

### Enterprise administration

Feature Lab and editable hrmny RBAC are available. Project-level admin/editor/commenter/viewer access, teams with privacy/members/projects, explicit guest project sharing, portal viewer/commenter access, workspace view-only licenses, domain and sharing defaults, enforced connected-app policy, session defaults, full Work graph backup, audit CSV export, the organization admin console, scoped Work API tokens/outbound webhooks, the Work MCP server, SAML SSO enforcement, and SCIM 2.0 Users/Groups provisioning are beta. External guest work is served only from the portal API boundary, and workspace view-only licenses deny every Work mutation server-side. Work API and MCP calls reuse the authenticated employee's permission resolver; scopes reduce the exposed operations and Feature Lab can deny both surfaces immediately. The connected-app boundary blocks credential storage, OAuth starts, secret reads, smoke tests, Asana verification, imports, sync, and webhook registration when apps are disabled; approved-only mode fails closed for toolkits outside the curated catalogue. SSO enforcement uses a Supabase-registered SAML provider, governed domains, and explicit break-glass accounts. SCIM uses expiring/revocable bearer tokens stored only as hashes, supports discovery plus create/read/replace/patch/deactivate flows, audits writes, and is denied immediately when Feature Lab disables `work.sso_scim` globally, for the token owner, or for the owner's role. Truly isolated sandbox environments remain planned. The existing append-only audit trail is reused and records guest, API, webhook, AI, and identity-provisioning changes.

### Import, sync, and integrations

The beta importer preserves projects and their dates, sections, tasks, estimates, nested subtasks, multi-home membership, dependencies, comments, followers, tags, attachments, custom fields/values, teams and administrators, user/team project access, time entries, goals and weighted supporting work, sub-goals, portfolios and their project ordering, project/task templates, and complete project/portfolio/goal status history. Source, workspace, and connected-account identifiers make every object and relationship idempotent. A successful full re-run also removes or archives Asana-owned records and relationships that disappeared from that connection while leaving native hrmny rows untouched; this includes memberships, project/task links, dependencies, followers, tags, custom-field values, comments, attachments, goal links, portfolio projects, statuses, and time entries. Source records are retained for fields that do not yet have a first-class hrmny control. The import blocks on unmapped people by default, records a migration run, and writes atomically after explicit confirmation. A regular Asana OAuth/PAT connection can only list portfolios owned by that connected user; importing every workspace portfolio requires an Asana service account. Connections authorized before the added team, membership, goal, portfolio, template, status, and time-entry scopes may need to be reconnected.

Workspace event cursors run on a recurring job; changes or expired cursors trigger the full source-scoped reconciliation, while explicit delete/removal events still provide faster core updates. Signed Asana webhooks can be registered for the workspace and every active project through the live Composio transport. The callback completes Asana's secret handshake, stores the secret in Vault, verifies every raw payload with SHA-256 HMAC, deduplicates receipts, and wakes the same reconciliation job. New and archived projects are reconciled automatically after structural changes. Cursor polling remains active because Asana documents webhook delivery as at-most-once and recommends a polling fallback. Enabling webhooks requires a public HTTPS `NEXT_PUBLIC_APP_URL` and webhook scopes on the connected Asana authorization.

### AI parity

The 2026 Asana AI surface tracked by Feature Lab includes:

- Smart Chat: permission-aware questions, insights, and task creation.
- Smart summaries: tasks, projects, portfolios, Inbox, action items, and risk reports.
- Smart status: draft updates for projects, portfolios, and goals with guidance.
- Smart fields, Smart projects, Smart goals, Smart editor, and Smart rule creator.
- AI Studio: no-code check/classify/route/alert/act/report workflows with human approvals.
- AI Teammates: shareable agents, task/comment triggers, scheduled follow-ups, activity, interruption, approvals, access controls, memories, integrations, and reusable Skills with attachments.
- Asana Dash equivalent: proactive daily brief, blocked work, pending decisions, priorities, recommended next actions, and delegation to the right AI teammate.
- AI connectors/MCP with the same object permissions as human access.

The governed AI foundation is now beta. A configured provider performs structured generation; project/task/comment/section context is permission-filtered before prompting; returned citations are restricted to supplied source identifiers; every proposed write is re-authorized and requires explicit approval; and retention, request/token limits, usage reporting, interruption, idempotency, and audit controls are active. Development without provider credentials intentionally uses a deterministic mock and is not counted as production AI.

AI Teammates now have synthetic employee identities, owner/editor/user sharing, editor/commenter/viewer project grants, reusable Skills, task-bound memory, assignment/@mention/rule/follow-up triggers, activity, interruption, and approval-backed actions for tasks, comments, projects, subtasks, milestones, custom fields, collaborators, sections, bulk updates, dependencies, linked attachments, and follow-up scheduling. Connected-data access is separately governed: Feature Lab must allow AI connectors, a teammate editor must grant Google Workspace, and the running human must have their own valid OAuth connection. Search/export uses only that human's visible Drive files; creating a Google Doc or Sheet is a distinct approval and the resulting file is attached to the source task. Microsoft 365 and other connected-data providers, binary image understanding, externally triggered forms/recurrence, and broader cross-project action context remain gaps.

## Delivery order

1. **Feature Lab foundation** — catalogue, inheritance, client/role/user controls, navigation/API enforcement, audit. Implemented.
2. **Core work graph** — projects, permissions, sections, tasks, subtasks, dates, dependencies, comments, list/board. Implemented at first usable depth.
3. **Asana connection and migration** — live Composio verification, read-only discovery, dry-run report, idempotent core and planning/governance import, workspace event cursors, signed project/workspace webhooks, recurring source-scoped reconciliation, and destructive-event handling implemented in beta.
4. **Workflow depth** — custom fields, tags, files, followers, recurrence, forms, event rules, templates, bundles, and approvals implemented in beta; proofing, richer automation, and public intake remain.
5. **Planning and reporting** — Calendar, Timeline, Files, My Tasks, Inbox, search, Gantt, goals, portfolios, statuses, dashboards, workload, capacity, budgets, and time are implemented in beta; richer cross-portfolio analytics remain.
6. **Enterprise controls and integrations** — teams, guests, view-only licensing, sharing defaults, editable RBAC, admin console, audit export, graph backup, scoped Work API/outbound webhooks, Work MCP, SAML SSO enforcement, SCIM Users/Groups provisioning, and signed Asana webhook ingestion implemented in beta; isolated sandboxes and additional third-party apps remain.
7. **AI** — smart assists, AI Studio, Teammates/Skills, the Dash equivalent, MCP, and permission-aware Google Workspace connected data implemented in beta with the same Feature Lab and permission resolver; the gaps above remain.

## Primary references

- https://help.asana.com/s/article/all-asana-features
- https://asana.com/features
- https://help.asana.com/s/article/release-notes
- https://help.asana.com/s/article/get-started-with-asana-ai
- https://help.asana.com/s/article/smart-summaries
- https://help.asana.com/s/article/smart-status
- https://help.asana.com/s/article/ai-teammates
- https://help.asana.com/s/article/ai-teammate-skills
- https://asana.com/product/ai/ai-studio
- https://asana.com/product/ai/dash
- https://developers.asana.com/reference/rest-api-reference
- https://developers.asana.com/docs/webhooks-guide
- https://developers.asana.com/reference/getworkspaceevents
- https://developers.asana.com/reference/getteamsforworkspace
- https://developers.asana.com/reference/getmemberships
- https://developers.asana.com/reference/getgoals
- https://developers.asana.com/reference/getportfolios
- https://developers.asana.com/reference/getprojecttemplates
- https://developers.asana.com/reference/gettasktemplates
- https://developers.asana.com/reference/getstatusesforobject
- https://developers.asana.com/reference/gettimetrackingentriesfortask
- https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml
- https://www.rfc-editor.org/info/rfc7643/
- https://www.rfc-editor.org/info/rfc7644/
