/** Operational views only. Private mail, chat, credentials and admin settings stay outside preview. */
export const WORKSPACE_PREVIEW_PAGES = new Set([
  "/",
  "/crm/dashboard",
  "/crm/workbook",
  "/crm/leads",
  "/crm/contacts",
  "/crm/companies",
  "/crm/followups",
  "/crm",
  "/dashboards",
  "/work/my-tasks",
  "/work",
  "/delivery",
  "/clients",
]);

// Explicit reads prevent a future query (including one with side effects) becoming impersonatable.
export const WORKSPACE_PREVIEW_QUERIES = new Set([
  "auth.session",
  "auth.devUsers",
  "auth.workspaceUsers",
  "work.accessibility.get",
  "work.personal.myTasks",
  "work.personal.myTaskSections.list",
  "work.personal.focus.get",
  "work.projects.list",
  "work.projects.get",
  "work.members.listTeams",
  "work.members.listEmployees",
  "work.comments.list",
  "work.followers.list",
  "work.tags.list",
  "work.tags.forTask",
  "work.customFields.list",
  "work.customFields.values",
  "work.customTaskTypes.list",
  "work.customTaskTypes.assignments",
  "work.customTaskTypes.access",
  "work.attachments.list",
  "work.attachments.listProject",
  "crm.stages",
  "crm.workbook.snapshot",
  "crm.workbook.views",
  "crm.deals.list",
  "crm.companies.list",
  "crm.contacts.list",
  "crm.tasks.list",
  "crm.activities.list",
  "crm.health",
  "crmForecast.pipeline",
  "crmForecast.forecast",
  "crmForecast.winLoss",
  "crmForecast.stageConversion",
  "salesOs.digest",
  "salesOs.funnel",
  "clients.list",
  "clients.portalUsers.list",
  "dashboards.delivery",
]);

export function canPreviewWorkspace(
  user: { actorType: string; roles: readonly string[] } | null | undefined,
) {
  return (
    user?.actorType === "staff" &&
    user.roles.some((role) => ["partner", "director"].includes(role))
  );
}

export function workspaceBackFallback(pathname: string): string {
  if (pathname === "/crm/dashboard") return "/";
  if (pathname === "/crm" || pathname.startsWith("/crm/"))
    return "/crm/dashboard";
  if (pathname.startsWith("/clients/")) return "/clients";
  if (pathname.startsWith("/work/")) return "/work";
  return "/";
}
