export type StaffNavId =
  | "home"
  | "sales"
  | "clients"
  | "work"
  | "delivery"
  | "chat"
  | "support"
  | "finance"
  | "insights"
  | "people"
  | "settings";

export type StaffWorkspacePath = {
  href: string;
  feature: string;
  index: string;
  title: string;
  description: string;
  placement?: "more";
};

export function dependencyBlockerLabel(count: number | null): string {
  if (count === null) return "Dependency visibility unavailable";
  if (count === 0) return "No unresolved dependency";
  return `${count} unresolved ${count === 1 ? "dependency" : "dependencies"}`;
}

type StaffWorkspaceProfile = {
  key:
    | "partner"
    | "director"
    | "am"
    | "finance"
    | "hr"
    | "traffic"
    | "creative"
    | "developer"
    | "staff";
  label: string;
  headline: string;
  emphasis: string;
  description: string;
  primaryNav: readonly StaffNavId[];
  paths: readonly StaffWorkspacePath[];
};

const path = (
  href: string,
  feature: string,
  index: string,
  title: string,
  description: string,
  placement?: "more",
): StaffWorkspacePath => ({
  href,
  feature,
  index,
  title,
  description,
  placement,
});

const PATHS = {
  approvals: path(
    "/approvals",
    "support.tickets",
    "Decision",
    "Review decisions",
    "Inspect approval evidence before any controlled action.",
    "more",
  ),
  sales: path(
    "/crm/hunt",
    "crm.workspace",
    "Growth",
    "Find new clients",
    "Search, review, and move the right prospect into outreach.",
  ),
  clients: path(
    "/clients",
    "crm.workspace",
    "Clients",
    "Open client work",
    "See each relationship, current milestone, and next action.",
  ),
  tasks: path(
    "/work/my-tasks",
    "work.my_tasks",
    "Owned work",
    "Open my work",
    "See assigned work, due dates, blockers, and the next action.",
  ),
  delivery: path(
    "/delivery",
    "delivery.workspace",
    "Delivery",
    "Move client work",
    "Coordinate briefs, creative review, approvals, and delivery.",
  ),
  traffic: path(
    "/traffic",
    "delivery.workspace",
    "Traffic",
    "Clear the delivery path",
    "Resolve readiness gaps, ownership, and production handoffs.",
  ),
  creative: path(
    "/creative",
    "delivery.workspace",
    "Creative",
    "Review creative work",
    "Move evidence-backed work through QC and client handoff.",
  ),
  finance: path(
    "/finance",
    "finance.workspace",
    "Finance",
    "Protect cash and margin",
    "Review invoices, collections, controls, and financial handoffs.",
  ),
  people: path(
    "/people",
    "people.core_hr",
    "People",
    "Support the team",
    "Handle employee work, decisions, and required follow-through.",
  ),
  time: path(
    "/time",
    "people.leave_attendance",
    "Attendance",
    "Review time decisions",
    "Resolve leave, attendance, and correction requests.",
  ),
  insights: path(
    "/dashboards",
    "analytics.dashboards",
    "Evidence",
    "Read operating signals",
    "Inspect current delivery, growth, and operating evidence.",
  ),
  inbox: path(
    "/work/inbox",
    "work.inbox",
    "Handoffs",
    "Review my inbox",
    "Triage permission-filtered task, message, and status updates.",
  ),
  chat: path(
    "/chat",
    "ai.os_chat",
    "Assist",
    "Ask Hrmny",
    "Review scoped operating context without bypassing approvals.",
  ),
} as const;

const PROFILES: Record<StaffWorkspaceProfile["key"], StaffWorkspaceProfile> = {
  partner: {
    key: "partner",
    label: "Partner",
    headline: "Decide clearly.",
    emphasis: "Keep work moving.",
    description:
      "Start with decisions and owned work, then follow the evidence into growth or delivery.",
    primaryNav: ["home", "sales", "clients", "delivery", "insights"],
    paths: [
      PATHS.sales,
      PATHS.tasks,
      PATHS.delivery,
      PATHS.clients,
      PATHS.insights,
      PATHS.approvals,
      PATHS.finance,
      PATHS.inbox,
    ],
  },
  director: {
    key: "director",
    label: "Director",
    headline: "Unblock the system.",
    emphasis: "Protect the outcome.",
    description:
      "Review decisions, delivery pressure, and the evidence behind the next handoff.",
    primaryNav: ["home", "work", "delivery", "insights", "finance"],
    paths: [
      PATHS.tasks,
      PATHS.delivery,
      PATHS.insights,
      PATHS.approvals,
      PATHS.finance,
      PATHS.inbox,
    ],
  },
  am: {
    key: "am",
    label: "Account management",
    headline: "Move the relationship.",
    emphasis: "Make the next handoff obvious.",
    description:
      "Work from client and pipeline evidence into an owned follow-up or delivery action.",
    primaryNav: ["home", "sales", "work", "delivery", "support"],
    paths: [
      PATHS.tasks,
      PATHS.sales,
      PATHS.delivery,
      PATHS.approvals,
      PATHS.inbox,
    ],
  },
  finance: {
    key: "finance",
    label: "Finance",
    headline: "Protect cash.",
    emphasis: "Keep every effect controlled.",
    description:
      "Start with finance work and reconcile each decision to its evidence and owner.",
    primaryNav: ["home", "finance", "work", "insights"],
    paths: [
      PATHS.tasks,
      PATHS.finance,
      PATHS.insights,
      PATHS.approvals,
      PATHS.inbox,
    ],
  },
  hr: {
    key: "hr",
    label: "People operations",
    headline: "Support the team.",
    emphasis: "Preserve the boundary.",
    description:
      "Move employee work through the correct owner, decision, evidence, and follow-up.",
    primaryNav: ["home", "people", "work", "support"],
    paths: [
      PATHS.tasks,
      PATHS.people,
      PATHS.time,
      PATHS.approvals,
      PATHS.inbox,
    ],
  },
  traffic: {
    key: "traffic",
    label: "Traffic",
    headline: "Clear the path.",
    emphasis: "Move the next handoff.",
    description:
      "Start with readiness and assigned work, then resolve what is holding delivery back.",
    primaryNav: ["home", "work", "delivery", "support"],
    paths: [
      PATHS.tasks,
      PATHS.traffic,
      PATHS.delivery,
      PATHS.approvals,
      PATHS.inbox,
    ],
  },
  creative: {
    key: "creative",
    label: "Creative",
    headline: "Make the work clear.",
    emphasis: "Prove it is ready.",
    description:
      "Start with creative QC and assigned work, then hand off evidence instead of assumptions.",
    primaryNav: ["home", "work", "delivery", "support"],
    paths: [
      PATHS.tasks,
      PATHS.creative,
      PATHS.delivery,
      PATHS.approvals,
      PATHS.inbox,
    ],
  },
  developer: {
    key: "developer",
    label: "Systems",
    headline: "Fix the pathway.",
    emphasis: "Leave proof behind.",
    description:
      "Start with owned work and keep configuration, execution, and evidence boundaries explicit.",
    primaryNav: ["home", "work", "chat", "settings"],
    paths: [PATHS.tasks, PATHS.chat, PATHS.inbox],
  },
  staff: {
    key: "staff",
    label: "My work",
    headline: "See the work.",
    emphasis: "Take the next action.",
    description:
      "Start with work assigned to you and follow the permission-filtered handoff trail.",
    primaryNav: ["home", "work", "support"],
    paths: [PATHS.tasks, PATHS.inbox, PATHS.chat, PATHS.approvals],
  },
};

const ROLE_ALIASES: Readonly<Record<string, StaffWorkspaceProfile["key"]>> = {
  partner: "partner",
  director: "director",
  account_manager: "am",
  am: "am",
  finance: "finance",
  hr: "hr",
  traffic: "traffic",
  creative_director: "creative",
  creative: "creative",
  developer: "developer",
  staff: "staff",
};

const ROLE_PRECEDENCE: readonly StaffWorkspaceProfile["key"][] = [
  "partner",
  "director",
  "am",
  "finance",
  "hr",
  "traffic",
  "creative",
  "developer",
  "staff",
];

export function staffWorkspaceProfile(roles: readonly string[]) {
  const normalized = new Set(
    roles
      .map((role) => ROLE_ALIASES[role.trim().toLowerCase()])
      .filter((role): role is StaffWorkspaceProfile["key"] => Boolean(role)),
  );
  const key = ROLE_PRECEDENCE.find((role) => normalized.has(role)) ?? "staff";
  return PROFILES[key];
}

export function staffWorkspaceFor(
  roles: readonly string[],
  enabledFeatureKeys: ReadonlySet<string>,
) {
  const profile = staffWorkspaceProfile(roles);
  const paths = profile.paths.filter((item) =>
    enabledFeatureKeys.has(item.feature),
  );
  const primaryPaths = paths.filter((item) => item.placement !== "more");
  const fixedMorePaths = paths.filter((item) => item.placement === "more");
  return {
    ...profile,
    primaryAction: primaryPaths[0] ?? null,
    supportingActions: primaryPaths.slice(1, 3),
    moreActions: [...primaryPaths.slice(3), ...fixedMorePaths],
  };
}

export function rankStaffNavigation<T extends { id: StaffNavId }>(
  roles: readonly string[],
  availableItems: readonly T[],
) {
  const priority = staffWorkspaceProfile(roles).primaryNav;
  const byId = new Map(availableItems.map((item) => [item.id, item]));
  const primary = priority.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const primaryIds = new Set(primary.map((item) => item.id));
  return {
    primary,
    more: availableItems.filter((item) => !primaryIds.has(item.id)),
  };
}
