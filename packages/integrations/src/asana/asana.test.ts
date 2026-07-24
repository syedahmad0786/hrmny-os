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

    expect(requests.filter((url) => url.includes("/projects?"))).toHaveLength(
      2,
    );
    expect(requests.at(-1)).toContain(
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
});
