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

It did not contain a Composio project key or a separately stored Asana account, so the claimed external Asana connection could not be verified from the application during the audit. A live Composio transport, Asana identity/workspace verification, read-only scan, and confirmed idempotent import are now implemented. The Composio project key must be saved in Connections (or supplied as `COMPOSIO_API_KEY`) before the application can observe the external account. Incremental sync remains disabled.

## Compatibility map

### Work graph and task management

| Asana capability                             | hrmny model                                    | Status                             |
| -------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Projects                                     | `work_project`                                 | Available                          |
| Project members and object roles             | `work_project_member`                          | Beta                               |
| Sections / board columns                     | `work_section`                                 | Available                          |
| Tasks, assignee, dates, priority, completion | `work_item`                                    | Available                          |
| Subtasks                                     | `work_item.parent_work_item_id`                | Available                          |
| Milestones and approvals                     | `work_item.item_type`                          | Milestones beta; approvals planned |
| Multi-home tasks                             | `work_project_item`                            | Beta                               |
| Dependencies                                 | `work_item_dependency`                         | Available                          |
| Comments                                     | `work_comment`                                 | Available                          |
| Followers                                    | `work_item_follower`                           | Beta                               |
| Tags                                         | `work_tag`, `work_item_tag`                    | Beta                               |
| Custom fields                                | `work_custom_field`, `work_custom_field_value` | Beta                               |
| Attachments                                  | `work_attachment`                              | Beta                               |
| Recurring tasks                              | `work_item.recurrence`                         | Beta                               |
| Likes and proofing                           | Future activity/proof model                    | Planned                            |

### Views and personal work

List, board, monthly Calendar, date-range Timeline, and Files views use the same project data and are available in beta. My Tasks, Inbox, full-text search, and saved searches are also beta. Gantt, advanced personal sections/focus controls, weekly Calendar, and offline work mutation remain planned.

### Intake, automation, and standardisation

Forms, branching rules, task/project templates, bundles, approval workflows, and rule execution history remain planned. Bundles must version and distribute sections, fields, rules, and task templates together, including draft/publish, scoped distribution, and bulk project updates.

### Goals, portfolios, reporting, and resources

Goals, sub-goals, contributing work, portfolios, status updates, reporting dashboards, Workload, capacity planning, budgets, and time tracking remain planned. Existing hrmny operational dashboards are not counted as Asana parity until they operate on the work graph and respect work-object permissions.

### Enterprise administration

Feature Lab and hrmny RBAC are available. Project-level admin/editor/commenter/viewer access is beta. Guest collaboration, view-only licensing, team privacy, domain defaults, SSO/SCIM, sandbox management, graph export, app governance, and a full Asana-style admin console remain planned. The existing append-only audit trail is reused.

### Import, sync, and integrations

The beta importer preserves projects, sections, tasks, nested subtasks, multi-home membership, dependencies, comments, followers, tags, attachments, and custom fields/values. It is idempotent using source/external identifiers, blocks on unmapped people by default, records a migration run, and writes atomically after an explicit confirmation. Teams, project memberships, time entries, goals, portfolios, templates, and status history remain migration gaps. Cutover still requires signed webhooks plus a cursor-based reconciliation job because webhook events are compact and may arrive late.

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

AI features remain planned until the provider performs real generation, sources are permission-filtered before prompting, outputs cite source work, writes require configured approval, and usage/cost/audit controls are active. Stub text is not counted as AI parity.

## Delivery order

1. **Feature Lab foundation** — catalogue, inheritance, client/role/user controls, navigation/API enforcement, audit. Implemented.
2. **Core work graph** — projects, permissions, sections, tasks, subtasks, dates, dependencies, comments, list/board. Implemented at first usable depth.
3. **Asana connection and migration** — live Composio verification, read-only discovery, dry-run report, and idempotent core import implemented in beta; delta sync and cutover remain.
4. **Workflow depth** — custom fields, tags, files, followers, and recurrence implemented in beta; forms, rules, templates, bundles, approvals, and time remain.
5. **Planning and reporting** — Calendar, Timeline, Files, My Tasks, Inbox, and search implemented in beta; Gantt, goals, portfolios, statuses, dashboards, workload, and capacity remain.
6. **Enterprise controls and integrations** — teams, guests, sharing, admin, SSO/SCIM, exports, webhooks, third-party apps.
7. **AI** — smart assists first, then AI Studio, Teammates/Skills, and the Dash equivalent, all using the same Feature Lab and permission resolver.

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
