import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/qm/os/route";
import { runQmOsTool } from "./os-tools";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  caller: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  task: vi.fn(),
  generate: vi.fn(),
  projectAccess: vi.fn(),
  itemAccess: vi.fn(),
  connection: vi.fn(),
  search: vi.fn(),
  proxy: vi.fn(),
}));
vi.mock("../auth/session", () => ({
  resolveActiveStaffByEmail: mocks.staff,
  sessionCanViewMargin: () => false,
}));
vi.mock("../trpc/root", () => ({ createCaller: mocks.caller }));
vi.mock("../trpc/work-management-router", () => ({
  requireProjectAccess: mocks.projectAccess,
  requireItemAccess: mocks.itemAccess,
}));
vi.mock("../trpc/connections-router", () => ({
  getVerifiedWorkAppConnection: mocks.connection,
}));
vi.mock("../composio-connected-data-ai", () => ({
  searchComposioConnectedData: mocks.search,
}));

const actorId = "operator@hrmny.co";
const staff = {
  employeeId: "c0000000-0000-4000-8000-000000000001",
  email: actorId,
  displayName: "Synthetic operator",
  roles: [],
  permissions: [],
  actorType: "staff",
  clientId: null,
};
const projectId = "c0000000-0000-4000-8000-000000000002";
const token = "synthetic.run.token";
const fetcher = vi.fn<typeof fetch>();
const verified = {
  account: { id: "synthetic-gmail" },
  client: { proxy: mocks.proxy },
};
function request(body: unknown, credential = token) {
  return new Request("https://os.example/api/qm/os", {
    method: "POST",
    headers: { "x-agent-capability": credential },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("QM_PUBLIC_URL", "https://hrmny-portal.fly.dev");
  vi.stubEnv("QM_OS_TOOLS_ENABLED", "1");
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockImplementation(async () =>
    Response.json({ actorId, scopeId: `personal:${actorId}` }),
  );
  mocks.staff.mockResolvedValue(staff);
  mocks.caller.mockReturnValue({
    work: {
      projects: { list: mocks.list, get: mocks.get },
      tasks: { get: mocks.task },
    },
    workAi: { generate: mocks.generate },
  });
  mocks.list.mockResolvedValue([{ projectId }]);
  mocks.get.mockResolvedValue({ projectId, name: "Private work" });
  mocks.connection.mockResolvedValue(verified);
  mocks.proxy.mockResolvedValue({
    status: 200,
    data: { emailAddress: actorId, messagesTotal: 123 },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses the native actor's existing Work caller and rechecks project and task authority", async () => {
  const response = await POST(request({ operation: "get_project", projectId }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ projectId });
  expect(mocks.caller).toHaveBeenCalledWith(
    expect.objectContaining({
      employeeId: staff.employeeId,
      user: staff,
      clientId: null,
    }),
  );
  expect(mocks.projectAccess).toHaveBeenCalledWith(
    expect.objectContaining({
      employeeId: staff.employeeId,
      requestedFeatureKey: "work.projects",
    }),
    projectId,
  );
  await runQmOsTool(token, { operation: "get_task", itemId: projectId });
  expect(mocks.task).toHaveBeenCalledWith({ itemId: projectId });
  expect(mocks.itemAccess).toHaveBeenCalledWith(
    expect.objectContaining({ employeeId: staff.employeeId }),
    projectId,
  );
  mocks.projectAccess.mockRejectedValueOnce(new Error("revoked membership"));
  await expect(
    runQmOsTool(token, { operation: "get_project", projectId }),
  ).rejects.toThrow("revoked membership");
});

it("filters projects whose visibility changed while the read was in flight", async () => {
  mocks.list.mockResolvedValueOnce([
    { projectId },
    { projectId: "now-hidden" },
  ]);
  await expect(
    runQmOsTool(token, { operation: "list_projects" }),
  ).resolves.toEqual([{ projectId }]);
});

it("runs only the selected employee-owned Gmail profile read and revalidates its exact account", async () => {
  await expect(
    runQmOsTool(token, {
      operation: "gmail_profile",
      connectedAccountId: verified.account.id,
    }),
  ).resolves.toEqual({
    app: "gmail",
    connectedAccountId: verified.account.id,
    emailAddress: actorId,
  });
  expect(mocks.proxy).toHaveBeenCalledTimes(1);
  expect(mocks.proxy).toHaveBeenCalledWith({
    connectedAccountId: verified.account.id,
    endpoint:
      "https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress",
    method: "GET",
  });
  expect(mocks.connection).toHaveBeenCalledTimes(2);
  for (const args of mocks.connection.mock.calls)
    expect(args).toEqual([
      staff.employeeId,
      "gmail",
      expect.objectContaining({
        connectedAccountId: verified.account.id,
        clientId: null,
      }),
    ]);
  mocks.connection.mockResolvedValueOnce(verified).mockResolvedValueOnce(null);
  await expect(
    runQmOsTool(token, {
      operation: "gmail_profile",
      connectedAccountId: verified.account.id,
    }),
  ).rejects.toThrow("QM_CONNECTION_CHANGED");
});

it("rejects an unavailable selected account and uses only the existing approved search", async () => {
  mocks.connection.mockResolvedValueOnce(null);
  await expect(
    runQmOsTool(token, {
      operation: "gmail_profile",
      connectedAccountId: "another-owner",
    }),
  ).rejects.toThrow("QM_CONNECTION_UNAVAILABLE");
  expect(mocks.proxy).not.toHaveBeenCalled();
  mocks.search.mockResolvedValueOnce([{ content: "Synthetic result" }]);
  await expect(
    runQmOsTool(token, {
      operation: "connected_search",
      app: "jira",
      connectedAccountId: verified.account.id,
      query: "release tasks",
    }),
  ).resolves.toHaveLength(1);
  expect(mocks.search).toHaveBeenCalledWith({
    client: verified.client,
    connectedAccountId: verified.account.id,
    app: "jira",
    query: "release tasks",
  });
  mocks.connection.mockResolvedValueOnce(null);
  await expect(
    runQmOsTool(token, { operation: "connection", app: "gmail" }),
  ).resolves.toMatchObject({ connected: false });
});

it("generates a scoped Work proposal without calling an apply or provider-write method", async () => {
  mocks.generate.mockResolvedValueOnce({
    runId: "proposal",
    status: "ready",
    result: { actions: [] },
  });
  await expect(
    runQmOsTool(token, {
      operation: "work_propose",
      projectId,
      requestText: "Draft the delivery checklist",
    }),
  ).resolves.toMatchObject({
    runId: "proposal",
    nextLinks: [{ href: "/work/ai" }],
  });
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(mocks.generate).toHaveBeenCalledWith({
    kind: "smart_chat",
    projectIds: [projectId],
    requestText: "Draft the delivery checklist",
  });
  expect(mocks.proxy).not.toHaveBeenCalled();
});

it("rejects actor overrides, arbitrary provider operations, shared scopes, and mid-call revocation", async () => {
  for (const input of [
    { operation: "list_projects", employeeId: "another-owner" },
    { operation: "get_project", projectId, clientId: "another-client" },
    {
      operation: "gmail_profile",
      connectedAccountId: verified.account.id,
      endpoint: "https://example.com",
      method: "POST",
    },
    { operation: "apply_action" },
    {
      operation: "connected_search",
      app: "gmail",
      connectedAccountId: verified.account.id,
      query: "mail",
    },
  ])
    expect((await POST(request(input))).status).toBe(403);
  expect(mocks.caller).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(
    Response.json({ actorId, scopeId: "group:client" }),
  );
  expect((await POST(request({ operation: "list_projects" }))).status).toBe(
    403,
  );
  mocks.staff.mockResolvedValueOnce(staff).mockResolvedValueOnce(null);
  expect((await POST(request({ operation: "list_projects" }))).status).toBe(
    403,
  );
});

it("remains disabled by default and rejects oversized or missing-credential requests", async () => {
  vi.stubEnv("QM_OS_TOOLS_ENABLED", "0");
  expect((await POST(request({ operation: "list_projects" }))).status).toBe(
    403,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect((await POST(request({}, ""))).status).toBe(403);
  expect((await POST(request({ padding: "x".repeat(32_768) }))).status).toBe(
    413,
  );
});
