import { describe, expect, it, vi } from "vitest";
import { createComposioLive } from "../composio/live";
import { createAsanaDirect, createAsanaViaComposio } from ".";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Asana integration", () => {
  it("paginates direct Asana API responses", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = new URL(String(request));
      if (
        url.pathname.endsWith("/workspaces") &&
        !url.searchParams.has("offset")
      ) {
        return json({
          data: [{ gid: "w1", name: "Main" }],
          next_page: { offset: "next" },
        });
      }
      return json({ data: [{ gid: "w2", name: "Archive" }], next_page: null });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const asana = createAsanaDirect({ accessToken: "token", fetchImpl });

    await expect(asana.listWorkspaces()).resolves.toEqual([
      { gid: "w1", name: "Main" },
      { gid: "w2", name: "Archive" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("offset=next");
  });

  it("discovers and proxies an Asana connected account through Composio", async () => {
    const fetchImpl = vi.fn(
      async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        if (url.includes("connected_accounts")) {
          return json({
            items: [
              {
                id: "ca_asana",
                status: "ACTIVE",
                toolkit: { slug: "asana" },
                user_id: "developer@hrmny.co",
              },
            ],
            next_cursor: null,
          });
        }
        expect(JSON.parse(String(init?.body))).toMatchObject({
          connected_account_id: "ca_asana",
          endpoint: "/api/1.0/users/me",
        });
        return json({
          status: 200,
          data: {
            data: { gid: "u1", name: "Developer", email: "developer@hrmny.co" },
          },
          headers: {},
        });
      },
    ) as typeof fetch;
    const composio = createComposioLive({ apiKey: "key", fetchImpl });
    const accounts = await composio.listConnectedAccounts({ toolkit: "asana" });
    const asana = createAsanaViaComposio({
      client: composio,
      connectedAccountId: accounts[0]!.id,
    });

    expect(accounts[0]?.status).toBe("ACTIVE");
    await expect(asana.me()).resolves.toMatchObject({
      gid: "u1",
      email: "developer@hrmny.co",
    });
  });

  it("uses live Composio auth configs for connect and revoke", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(
      async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        requests.push({ url, init });
        if (url.includes("/auth_configs"))
          return json({
            items: [
              {
                id: "ac_slack",
                toolkit: { slug: "slack" },
                name: "Slack managed auth",
                auth_scheme: "OAUTH2",
                is_composio_managed: true,
                status: "ENABLED",
              },
            ],
            next_cursor: null,
          });
        if (url.endsWith("/connected_accounts/link"))
          return json(
            {
              redirect_url: "https://backend.composio.dev/link/token",
              connected_account_id: "ca_slack",
              expires_at: "2026-07-24T12:00:00Z",
            },
            201,
          );
        return json({ success: true });
      },
    ) as typeof fetch;
    const composio = createComposioLive({ apiKey: "key", fetchImpl });

    const configs = await composio.listAuthConfigs({ toolkits: ["slack"] });
    const link = await composio.createConnectLink({
      authConfigId: configs[0]!.id,
      userId: "employee-1",
      callbackUrl: "https://portal.hrmny.co/settings/connections",
    });
    await composio.deleteConnectedAccount({
      connectedAccountId: link.connected_account_id,
    });

    expect(requests[0]!.url).toContain("toolkit_slug=slack");
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      auth_config_id: "ac_slack",
      user_id: "employee-1",
      callback_url: "https://portal.hrmny.co/settings/connections",
    });
    expect(requests[2]).toMatchObject({
      url: expect.stringContaining(
        "/connected_accounts/ca_slack?revoke_on_delete=true",
      ),
      init: { method: "DELETE" },
    });
  });

  it("discovers active and archived projects and requests completed tasks", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      requests.push(url);
      if (url.includes("/projects?")) {
        return json({
          data: [
            {
              gid: url.includes("archived=true") ? "archived" : "active",
              name: "Project",
            },
          ],
        });
      }
      return json({ data: [] });
    }) as unknown as typeof fetch;
    const asana = createAsanaDirect({ accessToken: "token", fetchImpl });

    await expect(asana.listProjects("w1")).resolves.toHaveLength(2);
    await asana.listProjectTasks("p1");

    const projectRequests = requests.filter((url) =>
      url.includes("/projects?"),
    );
    expect(projectRequests).toHaveLength(2);
    const projectFields = new URL(projectRequests[0]!).searchParams.get(
      "opt_fields",
    );
    expect(projectFields).toContain(
      "custom_field_settings.custom_field.enum_options.name",
    );
    expect(projectFields).toContain("custom_fields.display_value");
    expect(requests.at(-1)).toContain(
      "completed_since=1970-01-01T00%3A00%3A00.000Z",
    );
  });

  it("uses the current Asana endpoints for migration fidelity objects", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (request: RequestInfo | URL) => {
      requests.push(String(request));
      return json({ data: [] });
    }) as unknown as typeof fetch;
    const asana = createAsanaDirect({ accessToken: "token", fetchImpl });

    await Promise.all([
      asana.listTeams("w1"),
      asana.listTeamMemberships("team1"),
      asana.listProjectMemberships("p1"),
      asana.listCustomTypeMemberships!("ct1"),
      asana.listCustomTypes("p1"),
      asana.getCustomType("ct1"),
      asana.listGoals("w1"),
      asana.listGoalRelationships("g1"),
      asana.listPortfolios("w1"),
      asana.listPortfolioItems("pf1"),
      asana.listProjectTemplates("w1"),
      asana.listTaskTemplates("p1"),
      asana.listStatusUpdates("p1"),
      asana.listTimeTrackingEntries("t1"),
    ]);

    expect(requests).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/workspaces/w1/teams?"),
        expect.stringContaining("/teams/team1/team_memberships?"),
        expect.stringContaining("/memberships?parent=p1"),
        expect.stringContaining("/memberships?parent=ct1"),
        expect.stringContaining("/custom_types?project=p1"),
        expect.stringContaining("/custom_types/ct1?"),
        expect.stringContaining("/goals?workspace=w1"),
        expect.stringContaining("/goal_relationships?supported_goal=g1"),
        expect.stringContaining("/portfolios?workspace=w1"),
        expect.stringContaining("/portfolios/pf1/items?"),
        expect.stringContaining("/project_templates?workspace=w1"),
        expect.stringContaining("/task_templates?project=p1"),
        expect.stringContaining("/status_updates?parent=p1"),
        expect.stringContaining("/tasks/t1/time_tracking_entries?"),
      ]),
    );
    const portfolioFields = new URL(
      requests.find((url) => url.includes("/portfolios?workspace=w1"))!,
    ).searchParams.get("opt_fields");
    expect(portfolioFields).toContain(
      "custom_field_settings.custom_field.enum_options.name",
    );
    expect(portfolioFields).toContain("custom_fields.display_value");
    const goalFields = new URL(
      requests.find((url) => url.includes("/goals?workspace=w1"))!,
    ).searchParams.get("opt_fields");
    expect(goalFields).toContain(
      "custom_field_settings.custom_field.enum_options.name",
    );
    expect(goalFields).toContain("custom_fields.display_value");
  });

  it("reads the connected user's complete My Tasks list", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      requests.push(url);
      if (url.includes("/users/me/user_task_list?"))
        return json({
          data: {
            gid: "utl1",
            name: "My Tasks",
            owner: { gid: "u1", name: "Developer" },
            workspace: { gid: "w1", name: "Main" },
          },
        });
      return json({ data: [] });
    }) as unknown as typeof fetch;
    const asana = createAsanaDirect({ accessToken: "token", fetchImpl });

    await expect(asana.getUserTaskList("me", "w1")).resolves.toMatchObject({
      gid: "utl1",
      owner: { gid: "u1" },
    });
    await asana.listUserTaskListTasks("utl1");

    expect(requests[0]).toContain("/users/me/user_task_list?workspace=w1");
    expect(requests[1]).toContain("/user_task_lists/utl1/tasks?");
    expect(requests[1]).toContain("assignee_section.gid");
    expect(requests[1]).toContain(
      "completed_since=1970-01-01T00%3A00%3A00.000Z",
    );
  });

  it("initializes and advances a workspace event cursor", async () => {
    const fetchImpl = vi.fn(async (request: RequestInfo | URL) => {
      const url = new URL(String(request));
      if (!url.searchParams.has("sync")) return json({ sync: "first" }, 412);
      return json({
        data: [
          {
            resource: { gid: "t1", resource_type: "task" },
            action: "changed",
          },
        ],
        sync: "next",
        has_more: false,
      });
    }) as unknown as typeof fetch;
    const asana = createAsanaDirect({ accessToken: "token", fetchImpl });

    await expect(asana.workspaceEvents("w1")).resolves.toMatchObject({
      events: [],
      sync: "first",
      reset: true,
    });
    await expect(asana.workspaceEvents("w1", "first")).resolves.toMatchObject({
      events: [expect.objectContaining({ action: "changed" })],
      sync: "next",
      reset: false,
    });
  });

  it("registers and removes a signed Asana webhook", async () => {
    const fetchMock = vi.fn(
      async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") return json({ data: {} });
        expect(JSON.parse(String(init?.body))).toEqual({
          data: {
            resource: "w1",
            target: "https://portal.hrmny.com/api/asana/webhooks/token",
            filters: [{ resource_type: "project", action: "added" }],
          },
        });
        return json({
          data: {
            gid: "hook-1",
            active: true,
            target: "https://portal.hrmny.com/api/asana/webhooks/token",
            resource: { gid: "w1", resource_type: "workspace" },
          },
        });
      },
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const asana = createAsanaDirect({ accessToken: "token", fetchImpl });

    await expect(
      asana.createWebhook(
        "w1",
        "https://portal.hrmny.com/api/asana/webhooks/token",
        [{ resource_type: "project", action: "added" }],
      ),
    ).resolves.toMatchObject({ gid: "hook-1", active: true });
    await asana.deleteWebhook("hook-1");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });
});
