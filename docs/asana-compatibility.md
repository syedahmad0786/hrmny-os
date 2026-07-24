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

Current catalogue verdict: all 131 recorded capabilities have a usable surface; 32 are marked available and 99 remain beta. Nothing is still labelled planned, but beta is not a claim of production acceptance. The 100% goal remains open until the live Composio/Asana account is verified, provider auth configs are exercised, and client acceptance confirms the beta workflows at production scale.

## Connection finding

The connection audit found one connected account in the hrmny application:

- Google Workspace — `developer@hrmny.co`

The application database contains no saved Composio or Asana connection for that employee (and no `developer@hrmny.com` employee match). Vercel configuration does contain a sensitive `COMPOSIO_API_KEY`, but only for preview deployments; production has no Composio key. Vercel correctly does not decrypt that sensitive value through the environment API, so the external Asana identity and workspace still cannot be asserted from this audit. The bridge is therefore configured in preview, not connection-verified. A live Composio transport, Asana identity/workspace verification, read-only scan, confirmed idempotent import, and cursor-based recurring reconciliation are implemented. Acceptance now requires an authenticated preview check through Connections, or saving the project key for the signed-in employee (or supplying `COMPOSIO_API_KEY`) before the application can observe and verify the external account.

## Compatibility map

### Work graph and task management

| Asana capability                             | hrmny model                                    | Status    |
| -------------------------------------------- | ---------------------------------------------- | --------- |
| Projects                                     | `work_project`                                 | Available |
| Project members and object roles             | `work_project_member`                          | Beta      |
| Sections / board columns                     | `work_section`                                 | Available |
| Tasks, assignee, dates, priority, completion | `work_item`                                    | Available |
| Subtasks                                     | `work_item.parent_work_item_id`                | Available |
| Subtask hide-completed and sorting controls  | governed task-detail view                      | Beta      |
| Milestones and approvals                     | `work_item.item_type`                          | Beta      |
| Multi-home tasks                             | `work_project_item`                            | Beta      |
| Dependencies                                 | `work_item_dependency`                         | Available |
| Comments                                     | `work_comment`                                 | Available |
| Followers                                    | `work_item_follower`                           | Beta      |
| Tags                                         | `work_tag`, `work_item_tag`                    | Beta      |
| Custom fields                                | `work_custom_field`, `work_custom_field_value` | Beta      |
| Custom task types and statuses               | `work_custom_task_type`, status/project links  | Beta      |
| Attachments                                  | `work_attachment`                              | Beta      |
| Recurring tasks                              | `work_item.recurrence`                         | Beta      |
| Likes                                        | `work_like`                                    | Beta      |
| Proofing pins and actionable feedback        | `work_proof_annotation`                        | Beta      |

### Views and personal work

List, board, monthly Calendar, date-range Timeline, Files, and Gantt views use the same project data and are available in beta. Gantt includes dependencies, critical-path calculation, captured baselines, and schedule variance. My Tasks now has private quick-add tasks that do not require choosing a project, private custom sections, section ordering, list and board organization, sorting, grouping, due-date filters, weekly/monthly personal calendars with weekend and unscheduled-work controls, a persisted weekly focus, and a task-bound 25-minute focus timer. Its quick add, sections, and focus are governed separately by Feature Lab. Personal tasks use one hidden private graph container per employee so the existing task permissions and actions still apply, while project selectors never expose it. Reassignment clears the former assignee's private organization. The importer also preserves the connected Asana identity's empty and populated My Tasks sections, ordering, and tasks that have no project. Asana returns `assignee_section` only when the requester is the assignee, so a single administrator connection cannot recover other users' private section placement; this is a provider access-control boundary rather than an hrmny omission. Inbox, full-text search, and saved searches are also beta. The installable manifest, service worker, and shell cache now follow `work.mobile_pwa`; turning it off removes the manifest, unregisters hrmny's worker, and deletes only hrmny's shell caches. Closed-app server push, focus-timer notification suppression, and offline work mutation remain beta acceptance gaps.

### Intake, automation, and standardisation

Forms support conditional questions, organization-only or unauthenticated public access, task-creating submissions, attachment questions, validated email questions, and confirmation receipts containing a bounded plain-text copy of the submission. Public links can submit into private projects without exposing project data; form, public-access, and email-receipt switches are re-evaluated against the project's client, uploads are limited to 10 files and 25 MB per submission, anonymous intake is rate-limited, and new tasks still run project rules. Receipts use the form owner's Google Workspace connection through the existing retrying job queue, recheck Forms plus Gmail provider controls immediately before delivery, omit attachment bodies, carry a deterministic message identifier, and audit successful delivery. Live Gmail send-scope acceptance remains required. Event and scheduled rules with conditions/branches/actions, collaborator-added triggers, rule execution history, task/project templates with relative dates, versioned bundles, and approval decisions are available in beta. Rules can emit external actions through the existing project webhook outbox: destinations must be public HTTPS, payloads are signed, delivery is retried, rule ownership is retained, and both the external-action and webhook Feature Lab switches are rechecked against the project client before rules are shown, changed, run, bundled, or delivered. Project templates turn source task assignees into named role placeholders, ask for each role's person when the project is created, add those people to the private project, assign their tasks, and leave tasks unassigned when a role is skipped. Feature Lab can hide the role data and block direct role assignment independently from templates. Shared custom task types can be created with multiple incomplete and complete statuses, attached across projects, selected as a project default, assigned per task, and used to filter, sort, or group work. Native definitions support editing the type name/icon plus status names, colors, completion mapping, ordering, disabling, and re-enabling. Removing a type from a project preserves the type and status on existing tasks, while preventing new assignments there; those retained tasks can still move between the type's enabled statuses. Each definition now has Asana-compatible organization defaults (`admin`, `editor`, `user`, or no access) plus explicit user/team memberships (`admin`, `editor`, or `user`), an administrator UI, audit events, server-side enforcement, and last-admin lockout protection. Choosing a complete status completes the task; reopening selects the first enabled incomplete status. Custom-status changes are available as rule triggers and conditions, while rules can set a type/status as an action. The same trigger and governed action are available to AI Studio, and AI Teammates can propose a status action using only permission-filtered type/status identifiers. Turning `work.custom_task_types` off hides these workflows and identifiers and denies direct API or AI execution. Definitions, project availability, task assignments, disabled statuses, My Tasks-only usage, and explicit user/team type memberships are source-reconciled from Asana; Asana-managed definitions remain source-controlled. Bundle versions carry their task-type/status definitions, attach the same organization-level type to target projects, preserve stable status identifiers in rules, and fail closed if the definition, status, permission, or Feature Lab switch is unavailable. Publishing automatically reapplies the latest version to every installed project; each project keeps its previous applied version if its client Feature Lab policy or a bundled component validation blocks the update, and the bundle list exposes the resulting drift.

Rule ownership can be transferred by a project editor only to another active human project editor. The current and incoming owners receive governed Inbox notifications, scheduled jobs immediately adopt the incoming owner's identity, and Feature Lab can remove owner data and controls while denying both the candidate and mutation APIs. Event-triggered rules still execute in the triggering actor's context rather than rehydrating the owner's live permissions; that Asana automation-permission change remains an acceptance gap.

### Goals, portfolios, reporting, and resources

Goals, sub-goals, weighted contributing projects/tasks, portfolio progress and health, structured status updates, client-scoped status-update templates, live and saved reporting dashboards, CSV export, weekly Workload, capacity allocations, project budgets/cost forecasts, task estimates, manual time entries, and single-user timers are available in beta. Status-template owners can create, apply, update, remove, and derive reusable title/body/health/progress structures from an existing project update; the library and every mutation recheck `work.status_update_templates` against the selected project's client. Collaborative template drafts, template attachments/highlight blocks, explicit viewer/editor sharing, and direct AI generation inside the template editor remain acceptance gaps. They operate on the shared work graph and enforce work-object permissions. Goal cards expose a dated progress and health history backed by their governed status updates. Project budgets support a default hourly cost plus per-person overrides; actual time uses the person who logged it, while remaining estimates use the assignee and fall back to the project default. Project dashboards have live bar, donut, and numeric charts; group by completion, assignee, priority, section, task type, or any enabled project custom field; measure task count, estimates, actual time, or a numeric custom field's total or average; filter by completion, due range, assignee, priority, work type, and all/exclude/only subtasks; and can save, reopen, or remove a view. Imported Asana numeric fields with the same external field ID are one measure across projects, while native project fields remain independently selectable. Disabled task, milestone, approval, time, or custom-field features are removed from chart rows per project and client, and inaccessible single-project saved views disappear. The same task charts can span every permitted, Feature Lab-enabled project in a portfolio or across the workspace and group results by project without double-counting multi-homed tasks. The reporting surface can also count every visible project, goal, or portfolio and group projects by health, owner, privacy, or source; goals by status, owner, scope, or quarter; and portfolios by health, owner, or privacy. Project reports can filter by portfolio, specific projects, team, owner, health, privacy, source, created/start/due dates, and imported object custom fields; goal and portfolio reports support the same object custom-field conditions alongside their existing object, ownership, status, privacy, scope, quarter, hierarchy, and date filters. Object custom-field filters support equals, not-equals, contains, empty/non-empty, and numeric/date comparisons. These object reports use the permission-filtered lists already shown to the user, and their filters can be saved and shared through the same governed dashboard controls. Two or more saved task, project, goal, or portfolio views can be combined into one live mixed-object dashboard without a schema migration. Saved dashboards are private by default; their owner can share them read-only with selected people or everyone who retains the required object and Feature Lab access. Every widget is re-authorized and rerun when opened; shared viewers only see live data they remain permitted to access, and the whole dashboard disappears when its reporting, scope, team, custom-field, goal, portfolio, or selected-object access is removed. Workload can aggregate weekly capacity, allocations, scheduled estimates, and actual time across every visible, Feature Lab-enabled project in a portfolio without double-counting multi-homed tasks. Imported private custom fields fail closed unless the current employee has an explicit Asana user or team membership; the same field-level check protects task values, project/goal/portfolio filters, reports, and bundle capture.

Time-based task measures also recheck Time Tracking for each project and client. Portfolio charts retain rows from enabled projects only, while a single-project time dashboard disappears when the client disables Time Tracking. People can correct only their own draft or rejected time entries; submitted or approved entries and another person's entries remain immutable through Work. Feature Lab can remove the edit control and deny the update API independently while leaving logging and reporting available.

### Enterprise administration

Feature Lab and editable hrmny RBAC are available. Every project and task API resolves its route feature again against the bound client, so a client-level off switch remains a hard boundary even for staff or a user-level exception; selected-project screens use the same resolved catalogue to remove disabled basic, workflow, planning, and AI controls. Project discovery also omits projects whose client has disabled Work entirely. Project-level admin/editor/commenter/viewer access, teams with privacy/members/projects, explicit guest project sharing, portal viewer/commenter access, workspace view-only licenses, domain and sharing defaults, enforced connected-app policy, session defaults, full Work graph backup, audit CSV export, the organization admin console, scoped Work API tokens/outbound webhooks, the Work MCP server, SAML SSO enforcement, SCIM 2.0 Users/Groups provisioning, and one isolated Work sandbox are beta. External guest work is served only from the portal API boundary, and workspace view-only licenses deny every Work mutation server-side. Work API and MCP calls reuse the authenticated employee's permission resolver; scopes reduce the exposed operations and Feature Lab can deny both surfaces immediately. The connected-app boundary blocks credential storage, OAuth starts, secret reads, smoke tests, Asana verification, imports, sync, and webhook registration when apps are disabled; approved-only mode fails closed for toolkits outside the curated catalogue. SSO enforcement uses a Supabase-registered SAML provider, governed domains, and explicit break-glass accounts. SCIM uses expiring/revocable bearer tokens stored only as hashes, supports discovery plus create/read/replace/patch/deactivate flows, audits writes, and is denied immediately when Feature Lab disables `work.sso_scim` globally, for the token owner, or for the owner's role. The sandbox is a separate hrmny deployment and PostgreSQL database: activation fails unless the target identifies itself as `sandbox`, carries the current migrations, has a distinct environment ID, and proves a different database identity. Activation copies only global Feature Lab settings, roles/permissions, organization policy, and the activating administrator; production work and connection secrets remain absent. Re-verification detects a replaced target. Deletion re-verifies both identities and is accepted only by a sandbox deployment with reset explicitly enabled, so it cannot clear the production database. The existing append-only audit trail is reused and records guest, API, webhook, AI, identity-provisioning, and sandbox lifecycle changes.

Sandbox infrastructure is intentionally provisioned outside the application so database and deployment credentials never enter browser or application tables. Production sets `WORK_SANDBOX_BASE_URL` and `WORK_SANDBOX_VERIFICATION_TOKEN`; the separate target sets `WORK_ENVIRONMENT_KIND=sandbox`, its own `WORK_ENVIRONMENT_ID`, the matching `WORK_ENVIRONMENT_VERIFICATION_TOKEN`, and `WORK_SANDBOX_ALLOW_RESET=true`. Both deployments run the same release, while the target receives its own `DATABASE_URL`. This matches Asana's empty-environment model; test projects can be moved in through the normal export/import workflow after activation.

### Import, sync, and integrations

The beta importer preserves projects and their dates, sections, tasks, estimates, nested subtasks, multi-home membership, dependencies, comments, followers, tags, attachments, task custom-field settings/values, project/goal/portfolio custom-field definitions and values, custom-field privacy/default access/read-only state and explicit user/team memberships, custom task types/statuses, their explicit user/team access memberships and project sharing, teams and administrators, user/team project access, time entries, goals and weighted supporting work, sub-goals, portfolios and their project ordering, project/task templates, complete project/portfolio/goal status history, and the connected identity's My Tasks-only tasks, personal sections, and ordering. My Tasks-only work is attached to that employee's existing hidden private project so normal task permissions and actions continue to apply without exposing the container in project selectors. Source, workspace, and connected-account identifiers make every object and relationship idempotent. A successful full re-run also removes or archives Asana-owned records and relationships that disappeared from that connection while leaving native hrmny rows untouched; this includes memberships, custom-field memberships, project/task links, custom-type memberships/project links/statuses, personal section placement, dependencies, followers, tags, task and object custom-field values, comments, attachments, goal links, portfolio projects, status updates, and time entries. Source records are retained for fields that do not yet have a first-class hrmny control. Asana's documented `CustomType` response does not expose the organization's default type access; imports therefore preserve every membership returned by `/memberships`, keep the importing administrator as an hrmny admin, and use the non-destructive `user` organization default until a client administrator confirms a stricter setting in the access panel. The import blocks on unmapped people by default, records a migration run, and writes atomically after explicit confirmation. A regular Asana OAuth/PAT connection can only list portfolios owned by that connected user; importing every workspace portfolio requires an Asana service account. Connections authorized before the added team, membership, custom-field membership, custom-type membership, goal, portfolio, template, status, and time-entry scopes may need to be reconnected.

The Connections page now discovers the signed-in employee's real Composio connected accounts and the project's enabled auth configs. It can create official Composio connect links and revoke only accounts owned by that employee. Cloud-file, communication, and enterprise families each have a Feature Lab parent switch, and every provider has its own global/client/role/user switch: Google Drive, OneDrive, Dropbox, Box, Adobe, Gmail, Outlook, Slack, Microsoft Teams, Zoom, Salesforce, Jira, Power BI, and ServiceNow. The organization connected-app policy is an additional hard boundary. Missing auth configs are shown as setup requirements rather than simulated connections; Power BI deliberately depends on a project-defined Composio auth config because no managed toolkit was verified in the public catalogue.

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

The governed AI foundation is now beta. A configured provider performs structured generation; project/task/comment/section and enabled custom-type/status context is permission-filtered before prompting; returned citations are restricted to supplied source identifiers; every proposed write is re-authorized and requires explicit approval; and retention, request/token limits, usage reporting, interruption, idempotency, and audit controls are active. Smart summaries can include a permitted portfolio roll-up, its accessible projects, and the running employee's permission- and Feature Lab-filtered Inbox. Smart status can target a permitted project, portfolio, or goal, includes the target and up to ten selected projects as evidence, restricts the returned target to that supplied context, and applies the draft through the same status-update permission and Feature Lab checks after approval. Custom-status triggers and actions fail closed with `work.custom_task_types`, including removal of the identifiers from AI context. Development without provider credentials intentionally uses a deterministic mock and is not counted as production AI.

AI Teammates now have synthetic employee identities, owner/editor/user sharing, editor/commenter/viewer project grants, reusable Skills, task-bound memory, assignment/@mention/rule/follow-up triggers, activity, interruption, and approval-backed actions for tasks, comments, projects, subtasks, milestones, custom fields, collaborators, sections, bulk updates, dependencies, linked attachments, and follow-up scheduling. Forms can choose an AI Teammate as their default assignee, and both form-created tasks and newly generated recurring tasks enter the same governed assignment queue. Assignment choices and every AI run are rechecked against the task project's client-level Feature Lab policy, including delayed jobs. Connected-data access is separately governed: Feature Lab must allow AI connectors, a teammate editor must grant each source, the provider family and provider switches must remain on, organization connected-app policy must allow it, and the running human must have their own valid connection. Google Workspace search uses only that human's visible Drive files, Gmail message metadata/snippets, and upcoming primary-calendar events; a missing legacy scope fails only that source. Creating a Google Doc or Sheet is a distinct approval and the resulting file is attached to the source task. OneDrive, Outlook, Slack, Microsoft Teams, and Jira use the same user's active Composio account and a fixed read-only search tool; returned context is bounded and source content is not retained in the Work graph. Live provider auth-config, scope, and result-shape acceptance remains required. Smart Chat accepts validated PNG, JPEG, WebP, and GIF context through OpenRouter, Anthropic, or Ollama, requires both Smart Chat and Attachments in Feature Lab, and never stores the image in the Work graph; production acceptance still requires a configured vision-capable model. Smart Chat, Smart summaries, risk reports, and the Dash equivalent rank and aggregate every permission- and Feature Lab-visible project, include the 100 most lexically relevant summaries as a bounded workspace index, and add the ten strongest matches with task-level detail. Actions remain restricted to project sources that reached the prompt. This removes the larger-workspace count and exact name/description retrieval ceiling; synonym-only retrieval without matching project text remains a beta acceptance case for a configured provider.

## Delivery order

1. **Feature Lab foundation** — catalogue, inheritance, client/role/user controls, navigation/API enforcement, audit. Implemented.
2. **Core work graph** — projects, permissions, sections, tasks, subtasks, dates, dependencies, comments, list/board. Implemented at first usable depth.
3. **Asana connection and migration** — live Composio verification, read-only discovery, dry-run report, idempotent core and planning/governance import, workspace event cursors, signed project/workspace webhooks, recurring source-scoped reconciliation, and destructive-event handling implemented in beta.
4. **Workflow depth** — custom fields, custom task types/statuses, per-type user/team access, automatic bundle propagation with drift reporting, tags, files, followers, recurrence, forms, event/scheduled/collaborator/custom-status rules, templates, approvals, likes, messages, and proofing implemented in beta; arbitrary external automation and public intake still need acceptance work.
5. **Planning and reporting** — Calendar, Timeline, Files, My Tasks, Inbox, search, Gantt, goals, portfolios, statuses, task/project/goal/portfolio charts (including all-visible-project task analytics, numeric custom-field totals/averages, and team/specific-object/date/object-custom-field filters), saved/shared multi-widget dashboards, workload, capacity, budgets, and time are implemented in beta.
6. **Enterprise controls and integrations** — teams, guests, view-only licensing, sharing defaults, editable RBAC, admin console, audit export, graph backup, scoped Work API/outbound webhooks, Work MCP, SAML SSO enforcement, SCIM Users/Groups provisioning, a verified separate sandbox environment, signed Asana webhook ingestion, and a governed 14-provider Composio connection hub implemented in beta. Each provider still needs its real project auth config and acceptance test before its downstream workflows count as production parity.
7. **AI** — smart assists, AI Studio, Teammates/Skills, the Dash equivalent, MCP, and permission-aware Google Workspace, Microsoft 365, Slack, and Jira connected data implemented in beta with the same Feature Lab and permission resolver; live provider acceptance and the gaps above remain.

## Primary references

- https://help.asana.com/s/article/all-asana-features
- https://asana.com/features
- https://help.asana.com/s/article/release-notes
- https://help.asana.com/s/article/maximize-productivity-with-my-tasks
- https://help.asana.com/s/article/views-in-my-tasks
- https://help.asana.com/s/article/sections
- https://help.asana.com/s/article/custom-task-types
- https://help.asana.com/s/article/calendar-view
- https://help.asana.com/s/article/sharing-a-form
- https://help.asana.com/s/article/asana-desktop-app
- https://help.asana.com/s/article/asana-sandboxes
- https://help.asana.com/s/article/get-started-with-asana-ai
- https://help.asana.com/s/article/smart-summaries
- https://help.asana.com/s/article/smart-status
- https://help.asana.com/s/article/status-updates-templates
- https://help.asana.com/s/article/time-tracking-in-asana
- https://help.asana.com/s/article/rule-permissions
- https://help.asana.com/s/article/ai-teammates
- https://help.asana.com/s/article/ai-teammate-skills
- https://asana.com/product/ai/ai-studio
- https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
- https://docs.ollama.com/capabilities/vision
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://asana.com/product/ai/dash
- https://developers.asana.com/reference/rest-api-reference
- https://developers.asana.com/reference/custom-types
- https://developers.asana.com/reference/getmemberships
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
- https://developers.asana.com/reference/getusertasklistforuser
- https://developers.asana.com/reference/gettasksforusertasklist
- https://developers.asana.com/reference/tasks
- https://developers.asana.com/reference/custom-types
- https://developers.asana.com/reference/getcustomtypes
- https://docs.composio.dev/reference/api-reference/auth-configs/getAuthConfigs
- https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink
- https://docs.composio.dev/reference/api-reference/connected-accounts/deleteConnectedAccountsByNanoid
- https://docs.composio.dev/reference/v3/api-reference/tools
- https://docs.composio.dev/toolkits/one_drive
- https://docs.composio.dev/toolkits/outlook
- https://docs.composio.dev/toolkits/slack
- https://docs.composio.dev/toolkits/microsoft_teams
- https://docs.composio.dev/tools/jira
- https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml
- https://www.rfc-editor.org/info/rfc7643/
- https://www.rfc-editor.org/info/rfc7644/
