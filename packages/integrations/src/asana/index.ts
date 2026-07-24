import type { ComposioLiveClient } from "../composio/live";

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

export type AsanaProject = {
  gid: string;
  name: string;
  notes?: string;
  archived?: boolean;
  color?: string;
  privacy_setting?: string;
  owner?: AsanaUser | null;
  team?: { gid: string; name: string } | null;
  created_at?: string;
  modified_at?: string;
};

export type AsanaSection = {
  gid: string;
  name: string;
  created_at?: string;
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
  assignee?: AsanaUser | null;
  parent?: { gid: string; name?: string } | null;
  memberships?: Array<{
    project: { gid: string; name?: string };
    section?: { gid: string; name?: string } | null;
  }>;
  dependencies?: Array<{ gid: string; name?: string }>;
  followers?: AsanaUser[];
  tags?: Array<{ gid: string; name: string; color?: string }>;
  custom_fields?: Array<
    Record<string, unknown> & { gid: string; name: string }
  >;
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

type AsanaPage<T> = {
  data: T[];
  next_page?: { offset?: string | null; uri?: string | null } | null;
};

type AsanaSingle<T> = { data: T };

export interface AsanaAdapter {
  me(): Promise<AsanaUser>;
  listWorkspaces(): Promise<AsanaWorkspace[]>;
  listUsers(workspaceGid: string): Promise<AsanaUser[]>;
  listProjects(workspaceGid: string): Promise<AsanaProject[]>;
  listSections(projectGid: string): Promise<AsanaSection[]>;
  listProjectTasks(projectGid: string): Promise<AsanaTask[]>;
  listSubtasks(taskGid: string): Promise<AsanaTask[]>;
  listStories(taskGid: string): Promise<AsanaStory[]>;
  listAttachments(taskGid: string): Promise<AsanaAttachment[]>;
}

type AsanaTransport = {
  get<T>(path: string, query?: URLSearchParams): Promise<T>;
};

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
  "assignee.gid",
  "assignee.name",
  "assignee.email",
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
  "custom_fields",
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
  return {
    async get<T>(path: string, query?: URLSearchParams) {
      const url = `${baseUrl}${path}${query ? `?${query}` : ""}`;
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`Asana request failed (${response.status})`);
      }
      return payload as T;
    },
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
      const result = await input.client.proxy<T>({
        connectedAccountId: input.connectedAccountId,
        endpoint: `/api/1.0${path}`,
        method: "GET",
        parameters,
      });
      return result.data;
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
          opt_fields:
            "gid,name,notes,archived,color,privacy_setting,owner.gid,owner.name,owner.email,team.gid,team.name,created_at,modified_at",
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
