import { ComposioApiError, type ComposioLiveClient } from "../composio/live";

export type AsanaWorkspace = {
  gid: string;
  name: string;
  resource_type?: string;
  is_organization?: boolean;
};

export type AsanaUser = {
  gid: string;
  name: string;
  email?: string;
  resource_type?: string;
  workspaces?: AsanaWorkspace[];
};

export type AsanaCustomField = Record<string, unknown> & {
  gid: string;
  name: string;
  resource_subtype?: string;
  type?: string;
  enum_options?: Array<{
    gid: string;
    name: string;
    enabled?: boolean;
    color?: string;
  }>;
};

export type AsanaCustomFieldSetting = {
  gid: string;
  is_important?: boolean;
  custom_field: AsanaCustomField;
};

export type AsanaProject = {
  gid: string;
  name: string;
  notes?: string;
  archived?: boolean;
  color?: string;
  privacy_setting?: string;
  owner?: AsanaUser | null;
  team?: { gid: string; name: string } | null;
  start_on?: string | null;
  due_on?: string | null;
  created_at?: string;
  modified_at?: string;
  custom_field_settings?: AsanaCustomFieldSetting[];
  custom_fields?: AsanaCustomField[];
};

export type AsanaSection = {
  gid: string;
  name: string;
  created_at?: string;
};

export type AsanaUserTaskList = {
  gid: string;
  name: string;
  owner: AsanaUser;
  workspace: AsanaWorkspace;
};

export type AsanaCustomTypeStatusOption = {
  gid: string;
  name: string;
  color?: string;
  completion_state: "incomplete" | "complete";
  enabled?: boolean;
};

export type AsanaCustomType = {
  gid: string;
  name: string;
  status_options: AsanaCustomTypeStatusOption[];
};

export type AsanaTask = {
  gid: string;
  name: string;
  notes?: string;
  completed?: boolean;
  completed_at?: string | null;
  created_at?: string;
  modified_at?: string;
  start_on?: string | null;
  due_on?: string | null;
  due_at?: string | null;
  resource_subtype?: string;
  num_subtasks?: number;
  estimated_minutes?: number | null;
  assignee?: AsanaUser | null;
  assignee_section?: { gid: string; name?: string } | null;
  parent?: { gid: string; name?: string } | null;
  memberships?: Array<{
    project: { gid: string; name?: string };
    section?: { gid: string; name?: string } | null;
  }>;
  dependencies?: Array<{ gid: string; name?: string }>;
  followers?: AsanaUser[];
  tags?: Array<{ gid: string; name: string; color?: string }>;
  custom_fields?: AsanaCustomField[];
  custom_type?: { gid: string; name?: string } | null;
  custom_type_status_option?: { gid: string; name?: string } | null;
};

export type AsanaTeam = {
  gid: string;
  name: string;
  description?: string;
  html_description?: string;
  visibility?: string;
};

export type AsanaTeamMembership = {
  gid: string;
  user: AsanaUser;
  team: { gid: string; name?: string };
  is_admin?: boolean;
  is_guest?: boolean;
  is_limited_access?: boolean;
};

export type AsanaMembership = {
  gid: string;
  resource_subtype?: string;
  parent: { gid: string; name?: string; resource_type?: string };
  member: AsanaUser & { resource_type?: "user" | "team" };
  access_level?: "admin" | "editor" | "user" | "commenter" | "viewer";
};

export type AsanaGoal = {
  gid: string;
  name: string;
  notes?: string;
  html_notes?: string;
  start_on?: string | null;
  due_on?: string | null;
  is_workspace_level?: boolean;
  team?: { gid: string; name?: string } | null;
  owner?: AsanaUser | null;
  status?: string;
  privacy_setting?: string;
  metric?: {
    initial_number_value?: number | null;
    target_number_value?: number | null;
    current_number_value?: number | null;
    current_display_value?: string | null;
    progress_source?: string;
  } | null;
  created_at?: string;
  modified_at?: string;
  custom_field_settings?: AsanaCustomFieldSetting[];
  custom_fields?: AsanaCustomField[];
};

export type AsanaGoalRelationship = {
  gid: string;
  resource_subtype?: "subgoal" | "supporting_work";
  supporting_resource: {
    gid: string;
    name?: string;
    resource_type?: "goal" | "project" | "task" | "portfolio";
  };
  supported_goal?: { gid: string; name?: string };
  contribution_weight?: number;
};

export type AsanaPortfolio = {
  gid: string;
  name: string;
  archived?: boolean;
  color?: string;
  start_on?: string | null;
  due_on?: string | null;
  owner?: AsanaUser | null;
  public?: boolean;
  privacy_setting?: string;
  created_at?: string;
  custom_field_settings?: AsanaCustomFieldSetting[];
  custom_fields?: AsanaCustomField[];
};

export type AsanaProjectTemplate = Record<string, unknown> & {
  gid: string;
  name: string;
};

export type AsanaTaskTemplate = Record<string, unknown> & {
  gid: string;
  name: string;
  project?: { gid: string; name?: string };
};

export type AsanaStatusUpdate = {
  gid: string;
  title: string;
  text?: string;
  html_text?: string;
  status_type?: string;
  created_at?: string;
  author?: AsanaUser | null;
  parent?: { gid: string; name?: string; resource_type?: string };
};

export type AsanaTimeTrackingEntry = {
  gid: string;
  duration_minutes: number;
  entered_on: string;
  attributable_to?: { gid: string; name?: string } | null;
  created_by: AsanaUser;
  categories?: Array<{ gid: string; name: string; color?: string }>;
  task?: { gid: string; name?: string };
  created_at?: string;
  approval_status?: "APPROVED" | "DRAFT" | "REJECTED" | "SUBMITTED";
  billable_status?: "billable" | "nonBillable" | "notApplicable";
  description?: string;
};

export type AsanaStory = {
  gid: string;
  text?: string;
  html_text?: string;
  type?: string;
  resource_subtype?: string;
  created_at?: string;
  created_by?: AsanaUser | null;
};

export type AsanaAttachment = {
  gid: string;
  name: string;
  resource_subtype?: string;
  download_url?: string | null;
  permanent_url?: string | null;
  view_url?: string | null;
  created_at?: string;
};

export type AsanaEvent = {
  resource: { gid: string; resource_type?: string; name?: string };
  parent?: { gid: string; resource_type?: string; name?: string } | null;
  type?: string;
  action: string;
  created_at?: string;
  change?: Record<string, unknown>;
};

export type AsanaEventPage = {
  events: AsanaEvent[];
  sync: string;
  hasMore: boolean;
  reset: boolean;
};

export type AsanaWebhook = {
  gid: string;
  active: boolean;
  target: string;
  resource: { gid: string; resource_type?: string; name?: string };
};

export type AsanaWebhookFilter = {
  resource_type: string;
  action: "added" | "changed" | "deleted" | "removed" | "undeleted";
};

type AsanaPage<T> = {
  data: T[];
  next_page?: { offset?: string | null; uri?: string | null } | null;
};

type AsanaSingle<T> = { data: T };

type AsanaEventsResponse = {
  data?: AsanaEvent[];
  sync?: string;
  has_more?: boolean;
};

class AsanaApiError extends Error {
  constructor(
    readonly status: number,
    readonly data: unknown,
    path?: string,
  ) {
    super(`Asana request failed (${status})${path ? ` for ${path}` : ""}`);
  }
}

export interface AsanaAdapter {
  me(): Promise<AsanaUser>;
  listWorkspaces(): Promise<AsanaWorkspace[]>;
  listUsers(workspaceGid: string): Promise<AsanaUser[]>;
  listProjects(workspaceGid: string): Promise<AsanaProject[]>;
  listTeams(workspaceGid: string): Promise<AsanaTeam[]>;
  listTeamMemberships(teamGid: string): Promise<AsanaTeamMembership[]>;
  listProjectMemberships(projectGid: string): Promise<AsanaMembership[]>;
  listCustomFieldMemberships?(customFieldGid: string): Promise<AsanaMembership[]>;
  listCustomTypeMemberships?(customTypeGid: string): Promise<AsanaMembership[]>;
  listSections(projectGid: string): Promise<AsanaSection[]>;
  listProjectTasks(projectGid: string): Promise<AsanaTask[]>;
  listCustomTypes(projectGid: string): Promise<AsanaCustomType[]>;
  getCustomType(customTypeGid: string): Promise<AsanaCustomType>;
  getUserTaskList(
    userGid: string,
    workspaceGid: string,
  ): Promise<AsanaUserTaskList>;
  listUserTaskListTasks(userTaskListGid: string): Promise<AsanaTask[]>;
  listSubtasks(taskGid: string): Promise<AsanaTask[]>;
  listStories(taskGid: string): Promise<AsanaStory[]>;
  listAttachments(taskGid: string): Promise<AsanaAttachment[]>;
  listGoals(workspaceGid: string): Promise<AsanaGoal[]>;
  listGoalRelationships(goalGid: string): Promise<AsanaGoalRelationship[]>;
  listPortfolios(workspaceGid: string): Promise<AsanaPortfolio[]>;
  listPortfolioItems(portfolioGid: string): Promise<AsanaProject[]>;
  listProjectTemplates(workspaceGid: string): Promise<AsanaProjectTemplate[]>;
  listTaskTemplates(projectGid: string): Promise<AsanaTaskTemplate[]>;
  listStatusUpdates(parentGid: string): Promise<AsanaStatusUpdate[]>;
  listTimeTrackingEntries(taskGid: string): Promise<AsanaTimeTrackingEntry[]>;
  workspaceEvents(workspaceGid: string, sync?: string): Promise<AsanaEventPage>;
  createWebhook(
    resourceGid: string,
    target: string,
    filters?: readonly AsanaWebhookFilter[],
  ): Promise<AsanaWebhook>;
  deleteWebhook(webhookGid: string): Promise<void>;
}

type AsanaTransport = {
  get<T>(path: string, query?: URLSearchParams): Promise<T>;
  post<T>(path: string, body: Record<string, unknown>): Promise<T>;
  delete(path: string): Promise<void>;
};

const CUSTOM_FIELD_FIELDS = [
  "gid",
  "name",
  "resource_subtype",
  "type",
  "representation_type",
  "description",
  "precision",
  "format",
  "currency_code",
  "custom_label",
  "custom_label_position",
  "is_global_to_workspace",
  "is_formula_field",
  "is_value_read_only",
  "privacy_setting",
  "default_access_level",
  "display_value",
  "number_value",
  "text_value",
  "date_value.date",
  "date_value.date_time",
  "enum_options.gid",
  "enum_options.name",
  "enum_options.enabled",
  "enum_options.color",
  "enum_value.gid",
  "enum_value.name",
  "multi_enum_values.gid",
  "multi_enum_values.name",
  "people_value.gid",
  "people_value.name",
  "people_value.email",
  "reference_value.gid",
  "reference_value.name",
  "reference_value.resource_type",
] as const;

const customFieldFields = (prefix: string) =>
  CUSTOM_FIELD_FIELDS.map((field) => `${prefix}.${field}`);

const customFieldSettingFields = (prefix: string) => [
  `${prefix}.gid`,
  `${prefix}.is_important`,
  ...customFieldFields(`${prefix}.custom_field`),
];

const TASK_FIELDS = [
  "gid",
  "name",
  "notes",
  "completed",
  "completed_at",
  "created_at",
  "modified_at",
  "start_on",
  "due_on",
  "due_at",
  "resource_subtype",
  "num_subtasks",
  "estimated_minutes",
  "assignee.gid",
  "assignee.name",
  "assignee.email",
  "assignee_section.gid",
  "assignee_section.name",
  "parent.gid",
  "memberships.project.gid",
  "memberships.project.name",
  "memberships.section.gid",
  "memberships.section.name",
  "dependencies.gid",
  "dependencies.name",
  "followers.gid",
  "followers.name",
  "followers.email",
  "tags.gid",
  "tags.name",
  "tags.color",
  ...customFieldFields("custom_fields"),
  "custom_type.gid",
  "custom_type.name",
  "custom_type_status_option.gid",
  "custom_type_status_option.name",
].join(",");

function directTransport(input: {
  accessToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): AsanaTransport {
  const token = input.accessToken.trim();
  if (!token) throw new Error("Asana access token is required");
  const baseUrl = (input.baseUrl ?? "https://app.asana.com/api/1.0").replace(
    /\/$/,
    "",
  );
  const fetchImpl = input.fetchImpl ?? fetch;
  async function request<T>(
    path: string,
    method: "GET" | "POST" | "DELETE",
    query?: URLSearchParams,
    body?: Record<string, unknown>,
  ) {
    const url = `${baseUrl}${path}${query ? `?${query}` : ""}`;
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new AsanaApiError(response.status, payload, path);
    return payload as T;
  }
  return {
    get: <T>(path: string, query?: URLSearchParams) =>
      request<T>(path, "GET", query),
    post: <T>(path: string, body: Record<string, unknown>) =>
      request<T>(path, "POST", undefined, body),
    delete: (path: string) => request<void>(path, "DELETE"),
  };
}

function composioTransport(input: {
  client: ComposioLiveClient;
  connectedAccountId: string;
}): AsanaTransport {
  return {
    async get<T>(path: string, query?: URLSearchParams) {
      const parameters = [...(query?.entries() ?? [])].map(([name, value]) => ({
        name,
        value,
        in: "query" as const,
      }));
      try {
        const result = await input.client.proxy<T>({
          connectedAccountId: input.connectedAccountId,
          endpoint: `/api/1.0${path}`,
          method: "GET",
          parameters,
        });
        return result.data;
      } catch (error) {
        if (error instanceof ComposioApiError)
          throw new AsanaApiError(error.status, error.data, path);
        throw error;
      }
    },
    async post<T>(path: string, body: Record<string, unknown>) {
      try {
        const result = await input.client.proxy<T>({
          connectedAccountId: input.connectedAccountId,
          endpoint: `/api/1.0${path}`,
          method: "POST",
          body,
        });
        return result.data;
      } catch (error) {
        if (error instanceof ComposioApiError)
          throw new AsanaApiError(error.status, error.data, path);
        throw error;
      }
    },
    async delete(path: string) {
      try {
        await input.client.proxy({
          connectedAccountId: input.connectedAccountId,
          endpoint: `/api/1.0${path}`,
          method: "DELETE",
        });
      } catch (error) {
        if (error instanceof ComposioApiError)
          throw new AsanaApiError(error.status, error.data, path);
        throw error;
      }
    },
  };
}

function createAdapter(transport: AsanaTransport): AsanaAdapter {
  async function list<T>(path: string, query = new URLSearchParams()) {
    const values: T[] = [];
    query.set("limit", "100");
    let offset: string | undefined;
    do {
      if (offset) query.set("offset", offset);
      const page = await transport.get<AsanaPage<T>>(path, query);
      if (!page || !Array.isArray(page.data)) {
        throw new Error("Asana returned an invalid paginated response");
      }
      values.push(...page.data);
      offset = page.next_page?.offset ?? undefined;
    } while (offset);
    return values;
  }

  return {
    async me() {
      const response = await transport.get<AsanaSingle<AsanaUser>>(
        "/users/me",
        new URLSearchParams({
          opt_fields: "gid,name,email,workspaces.gid,workspaces.name",
        }),
      );
      return response.data;
    },
    listWorkspaces: () =>
      list<AsanaWorkspace>(
        "/workspaces",
        new URLSearchParams({ opt_fields: "gid,name,is_organization" }),
      ),
    listUsers: (workspaceGid) =>
      list<AsanaUser>(
        `/workspaces/${encodeURIComponent(workspaceGid)}/users`,
        new URLSearchParams({ opt_fields: "gid,name,email" }),
      ),
    async listProjects(workspaceGid) {
      const projectQuery = (archived: boolean) =>
        new URLSearchParams({
          workspace: workspaceGid,
          archived: String(archived),
          opt_fields: [
            "gid",
            "name",
            "notes",
            "archived",
            "color",
            "privacy_setting",
            "owner.gid",
            "owner.name",
            "owner.email",
            "team.gid",
            "team.name",
            "start_on",
            "due_on",
            "created_at",
            "modified_at",
            ...customFieldSettingFields("custom_field_settings"),
            ...customFieldFields("custom_fields"),
          ].join(","),
        });
      const pages = await Promise.all([
        list<AsanaProject>("/projects", projectQuery(false)),
        list<AsanaProject>("/projects", projectQuery(true)),
      ]);
      return [
        ...new Map(
          pages.flat().map((project) => [project.gid, project]),
        ).values(),
      ];
    },
    listTeams: (workspaceGid) =>
      list<AsanaTeam>(
        `/workspaces/${encodeURIComponent(workspaceGid)}/teams`,
        new URLSearchParams({
          opt_fields: "gid,name,description,html_description,visibility",
        }),
      ),
    listTeamMemberships: (teamGid) =>
      list<AsanaTeamMembership>(
        `/teams/${encodeURIComponent(teamGid)}/team_memberships`,
        new URLSearchParams({
          opt_fields:
            "gid,user.gid,user.name,user.email,team.gid,team.name,is_admin,is_guest,is_limited_access",
        }),
      ),
    listProjectMemberships: (projectGid) =>
      list<AsanaMembership>(
        "/memberships",
        new URLSearchParams({
          parent: projectGid,
          opt_fields:
            "gid,resource_subtype,parent.gid,parent.name,parent.resource_type,member.gid,member.name,member.email,member.resource_type,access_level",
        }),
      ),
    listCustomFieldMemberships: (customFieldGid) =>
      list<AsanaMembership>(
        "/memberships",
        new URLSearchParams({
          parent: customFieldGid,
          opt_fields:
            "gid,resource_subtype,parent.gid,parent.name,parent.resource_type,member.gid,member.name,member.email,member.resource_type,access_level",
        }),
      ),
    listCustomTypeMemberships: (customTypeGid) =>
      list<AsanaMembership>(
        "/memberships",
        new URLSearchParams({
          parent: customTypeGid,
          opt_fields:
            "gid,resource_subtype,parent.gid,parent.name,parent.resource_type,member.gid,member.name,member.email,member.resource_type,access_level",
        }),
      ),
    listSections: (projectGid) =>
      list<AsanaSection>(
        `/projects/${encodeURIComponent(projectGid)}/sections`,
        new URLSearchParams({ opt_fields: "gid,name,created_at" }),
      ),
    listProjectTasks: (projectGid) =>
      list<AsanaTask>(
        `/projects/${encodeURIComponent(projectGid)}/tasks`,
        new URLSearchParams({
          completed_since: "1970-01-01T00:00:00.000Z",
          opt_fields: TASK_FIELDS,
        }),
      ),
    listCustomTypes: (projectGid) =>
      list<AsanaCustomType>(
        "/custom_types",
        new URLSearchParams({
          project: projectGid,
          opt_fields:
            "gid,name,status_options.gid,status_options.name,status_options.color,status_options.completion_state,status_options.enabled",
        }),
      ),
    async getCustomType(customTypeGid) {
      const response = await transport.get<AsanaSingle<AsanaCustomType>>(
        `/custom_types/${encodeURIComponent(customTypeGid)}`,
        new URLSearchParams({
          opt_fields:
            "gid,name,status_options.gid,status_options.name,status_options.color,status_options.completion_state,status_options.enabled",
        }),
      );
      return response.data;
    },
    async getUserTaskList(userGid, workspaceGid) {
      const response = await transport.get<AsanaSingle<AsanaUserTaskList>>(
        `/users/${encodeURIComponent(userGid)}/user_task_list`,
        new URLSearchParams({
          workspace: workspaceGid,
          opt_fields:
            "gid,name,owner.gid,owner.name,owner.email,workspace.gid,workspace.name",
        }),
      );
      return response.data;
    },
    listUserTaskListTasks: (userTaskListGid) =>
      list<AsanaTask>(
        `/user_task_lists/${encodeURIComponent(userTaskListGid)}/tasks`,
        new URLSearchParams({
          completed_since: "1970-01-01T00:00:00.000Z",
          opt_fields: TASK_FIELDS,
        }),
      ),
    listSubtasks: (taskGid) =>
      list<AsanaTask>(
        `/tasks/${encodeURIComponent(taskGid)}/subtasks`,
        new URLSearchParams({ opt_fields: TASK_FIELDS }),
      ),
    listStories: (taskGid) =>
      list<AsanaStory>(
        `/tasks/${encodeURIComponent(taskGid)}/stories`,
        new URLSearchParams({
          opt_fields:
            "gid,text,html_text,type,resource_subtype,created_at,created_by.gid,created_by.name,created_by.email",
        }),
      ),
    listAttachments: (taskGid) =>
      list<AsanaAttachment>(
        `/tasks/${encodeURIComponent(taskGid)}/attachments`,
        new URLSearchParams({
          opt_fields:
            "gid,name,resource_subtype,download_url,permanent_url,view_url,created_at",
        }),
      ),
    listGoals: (workspaceGid) =>
      list<AsanaGoal>(
        "/goals",
        new URLSearchParams({
          workspace: workspaceGid,
          opt_fields: [
            "gid",
            "name",
            "notes",
            "html_notes",
            "start_on",
            "due_on",
            "is_workspace_level",
            "team.gid",
            "team.name",
            "owner.gid",
            "owner.name",
            "owner.email",
            "status",
            "privacy_setting",
            "metric.initial_number_value",
            "metric.target_number_value",
            "metric.current_number_value",
            "metric.current_display_value",
            "metric.progress_source",
            "created_at",
            "modified_at",
            ...customFieldSettingFields("custom_field_settings"),
            ...customFieldFields("custom_fields"),
          ].join(","),
        }),
      ),
    listGoalRelationships: (goalGid) =>
      list<AsanaGoalRelationship>(
        "/goal_relationships",
        new URLSearchParams({
          supported_goal: goalGid,
          opt_fields:
            "gid,resource_subtype,supporting_resource.gid,supporting_resource.name,supporting_resource.resource_type,supported_goal.gid,supported_goal.name,contribution_weight",
        }),
      ),
    listPortfolios: (workspaceGid) =>
      list<AsanaPortfolio>(
        "/portfolios",
        new URLSearchParams({
          workspace: workspaceGid,
          opt_fields: [
            "gid",
            "name",
            "archived",
            "color",
            "start_on",
            "due_on",
            "owner.gid",
            "owner.name",
            "owner.email",
            "public",
            "privacy_setting",
            "created_at",
            ...customFieldSettingFields("custom_field_settings"),
            ...customFieldFields("custom_fields"),
          ].join(","),
        }),
      ),
    listPortfolioItems: (portfolioGid) =>
      list<AsanaProject>(
        `/portfolios/${encodeURIComponent(portfolioGid)}/items`,
        new URLSearchParams({ opt_fields: "gid,name" }),
      ),
    listProjectTemplates: (workspaceGid) =>
      list<AsanaProjectTemplate>(
        "/project_templates",
        new URLSearchParams({
          workspace: workspaceGid,
          opt_fields:
            "gid,name,description,html_description,color,public,team,owner,requested_dates",
        }),
      ),
    listTaskTemplates: (projectGid) =>
      list<AsanaTaskTemplate>(
        "/task_templates",
        new URLSearchParams({
          project: projectGid,
          opt_fields: "gid,name,project,template,created_at,created_by",
        }),
      ),
    listStatusUpdates: (parentGid) =>
      list<AsanaStatusUpdate>(
        "/status_updates",
        new URLSearchParams({
          parent: parentGid,
          opt_fields:
            "gid,title,text,html_text,status_type,created_at,author.gid,author.name,author.email,parent.gid,parent.name,parent.resource_type",
        }),
      ),
    listTimeTrackingEntries: (taskGid) =>
      list<AsanaTimeTrackingEntry>(
        `/tasks/${encodeURIComponent(taskGid)}/time_tracking_entries`,
        new URLSearchParams({
          opt_fields:
            "gid,duration_minutes,entered_on,attributable_to.gid,attributable_to.name,created_by.gid,created_by.name,created_by.email,categories.gid,categories.name,categories.color,task.gid,task.name,created_at,approval_status,billable_status,description",
        }),
      ),
    async workspaceEvents(workspaceGid, sync) {
      const path = `/workspaces/${encodeURIComponent(workspaceGid)}/events`;
      const query = new URLSearchParams();
      if (sync) query.set("sync", sync);
      try {
        const response = await transport.get<AsanaEventsResponse>(path, query);
        if (!response.sync)
          throw new Error("Asana event response has no sync token");
        return {
          events: response.data ?? [],
          sync: response.sync,
          hasMore: Boolean(response.has_more),
          reset: false,
        };
      } catch (error) {
        if (error instanceof AsanaApiError && error.status === 412) {
          const response = error.data as AsanaEventsResponse | null;
          if (!response?.sync)
            throw new Error("Asana did not return a replacement sync token");
          return {
            events: [],
            sync: response.sync,
            hasMore: false,
            reset: true,
          };
        }
        throw error;
      }
    },
    async createWebhook(resourceGid, target, filters = []) {
      const response = await transport.post<AsanaSingle<AsanaWebhook>>(
        "/webhooks",
        {
          data: {
            resource: resourceGid,
            target,
            ...(filters.length ? { filters } : {}),
          },
        },
      );
      return response.data;
    },
    async deleteWebhook(webhookGid) {
      await transport.delete(`/webhooks/${encodeURIComponent(webhookGid)}`);
    },
  };
}

export function createAsanaDirect(input: {
  accessToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): AsanaAdapter {
  return createAdapter(directTransport(input));
}

export function createAsanaViaComposio(input: {
  client: ComposioLiveClient;
  connectedAccountId: string;
}): AsanaAdapter {
  return createAdapter(composioTransport(input));
}
