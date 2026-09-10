import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/qm/os/route";
import { runQmOsTool } from "./os-tools";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  caller: vi.fn(),
  connection: vi.fn(),
  connectedSearch: vi.fn(),
  proxy: vi.fn(),
  apolloSearch: vi.fn(),
  apolloStatus: vi.fn(),
  apolloLatest: vi.fn(),
  digest: vi.fn(),
  researchList: vi.fn(),
  contactList: vi.fn(),
  dealSummary: vi.fn(),
  accountSummary: vi.fn(),
  nextBestAction: vi.fn(),
  draftOutreach: vi.fn(),
  linkedinDraft: vi.fn(),
  getOutreach: vi.fn(),
  approve: vi.fn(),
  send: vi.fn(),
  featureEnabled: vi.fn(),
  mapsSearch: vi.fn(),
}));

vi.mock("./staff-access", () => ({ qmStaff: mocks.staff }));
vi.mock("../trpc/root", () => ({ createCaller: mocks.caller }));
vi.mock("../trpc/connections-router", () => ({
  getVerifiedWorkAppConnection: mocks.connection,
}));
vi.mock("../composio-connected-data-ai", () => ({
  searchComposioConnectedData: mocks.connectedSearch,
}));
vi.mock("../leadgen/store", () => ({ getOutreach: mocks.getOutreach }));
vi.mock("../features", () => ({ featureEnabled: mocks.featureEnabled }));
vi.mock("../integrations/google-maps-search", () => ({
  searchGoogleMapsDiscovery: mocks.mapsSearch,
}));

const employeeId = "c0000000-0000-4000-8000-000000000001";
const dealId = "c0000000-0000-4000-8000-000000000002";
const searchId = "c0000000-0000-4000-8000-000000000003";
const token = "synthetic.run.token";
const staff = {
  employeeId,
  email: "operator@hrmny.co",
  displayName: "Synthetic operator",
  roles: ["partner"],
  permissions: [],
  actorType: "staff",
  clientId: null,
};
const draft = {
  id: "c0000000-0000-4000-8000-000000000004",
  dealId,
  channel: "linkedin_connect",
  state: "draft",
  recipient: "https://www.linkedin.com/in/synthetic-person",
  subject: "LinkedIn connection",
  body: "A precise draft",
  approvedBy: null,
  sentAt: null,
  externalId: null,
  contactId: null,
  reworkFeedback: null,
  linkedinUrl: "https://www.linkedin.com/in/synthetic-person?trk=source",
  cadenceTouch: 1,
  acceptedAt: null,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
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
  vi.stubEnv("QM_OS_TOOLS_ENABLED", "1");
  mocks.staff.mockResolvedValue(staff);
  mocks.caller.mockReturnValue({
    salesOs: {
      apollo: {
        search: mocks.apolloSearch,
        searchStatus: mocks.apolloStatus,
        latestSearch: mocks.apolloLatest,
      },
      digest: mocks.digest,
      research: { list: mocks.researchList },
      contacts: { list: mocks.contactList },
    },
    crmAi: {
      dealSummary: mocks.dealSummary,
      accountSummary: mocks.accountSummary,
      nextBestAction: mocks.nextBestAction,
      draftOutreach: mocks.draftOutreach,
    },
    leadgen: {
      outreach: {
        draft: mocks.linkedinDraft,
        approve: mocks.approve,
        send: mocks.send,
      },
    },
  });
  mocks.connection.mockResolvedValue({
    account: { id: "employee-gmail" },
    client: { proxy: mocks.proxy },
  });
  mocks.getOutreach.mockResolvedValue(draft);
  mocks.featureEnabled.mockResolvedValue(true);
});

afterEach(() => vi.unstubAllEnvs());

it("runs bounded free Apollo search as the mapped employee and exposes no paid action", async () => {
  mocks.apolloSearch.mockResolvedValue({ status: "completed", candidates: [] });
  await expect(
    runQmOsTool(token, {
      operation: "apollo_search",
      idempotencyKey: searchId,
      titles: ["Marketing Director"],
      locations: ["Dubai"],
      perPage: 5,
    }),
  ).resolves.toMatchObject({ status: "completed" });
  expect(mocks.apolloSearch).toHaveBeenCalledWith({
    idempotencyKey: searchId,
    titles: ["Marketing Director"],
    locations: ["Dubai"],
    perPage: 5,
  });
  expect(mocks.staff).toHaveBeenCalledTimes(2);
  for (const forbidden of [
    { operation: "apollo_enrich", candidate: {}, confirmCreditUse: true },
    { operation: "approve_outreach", id: draft.id },
    { operation: "send_outreach", id: draft.id },
  ])
    await expect(runQmOsTool(token, forbidden)).rejects.toThrow();
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("returns an exact LinkedIn manual draft artifact and a sanitized public profile link", async () => {
  mocks.linkedinDraft.mockResolvedValue(draft);
  const result = await runQmOsTool(token, {
    operation: "linkedin_manual_draft",
    dealId,
    kind: "connect",
  });
  expect(mocks.linkedinDraft).toHaveBeenCalledWith({
    dealId,
    channel: "linkedin_connect",
  });
  expect(result).toMatchObject({
    delivery: "manual",
    provenance: "crm_and_saved_research_only",
    openUrl: "https://www.linkedin.com/in/synthetic-person",
    review: { kind: "hrmny.sales.outreach", id: draft.id },
    artifact: {
      id: draft.id,
      version: draft.updatedAt,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      state: "draft",
      nextLinks: [{ href: `/crm/outreach?id=${draft.id}` }],
    },
  });
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("fails closed when a draft or employee identity changes during the request", async () => {
  mocks.linkedinDraft.mockResolvedValue(draft);
  mocks.getOutreach.mockResolvedValue({ ...draft, body: "changed" });
  await expect(
    runQmOsTool(token, {
      operation: "linkedin_manual_draft",
      dealId,
    }),
  ).rejects.toThrow("QM_DRAFT_CHANGED");
  mocks.getOutreach.mockResolvedValue(draft);
  mocks.staff
    .mockResolvedValueOnce(staff)
    .mockResolvedValueOnce({ ...staff, employeeId: dealId });
  await expect(
    runQmOsTool(token, { operation: "sales_digest" }),
  ).rejects.toThrow("QM_ACCESS_CHANGED");
  mocks.staff
    .mockResolvedValueOnce(staff)
    .mockResolvedValueOnce({ ...staff, roles: ["am"] });
  await expect(
    runQmOsTool(token, { operation: "sales_digest" }),
  ).rejects.toThrow("QM_ACCESS_CHANGED");
});

it("uses and revalidates only the selected employee-owned connection", async () => {
  mocks.proxy.mockResolvedValue({
    status: 200,
    data: { emailAddress: staff.email },
  });
  await expect(
    runQmOsTool(token, {
      operation: "gmail_profile",
      connectedAccountId: "employee-gmail",
    }),
  ).resolves.toMatchObject({ emailAddress: staff.email });
  expect(mocks.connection).toHaveBeenCalledTimes(2);
  for (const args of mocks.connection.mock.calls)
    expect(args).toEqual([
      employeeId,
      "gmail",
      expect.objectContaining({ connectedAccountId: "employee-gmail" }),
    ]);
  mocks.connection.mockResolvedValueOnce(null);
  await expect(
    runQmOsTool(token, {
      operation: "gmail_profile",
      connectedAccountId: "another-owner",
    }),
  ).rejects.toThrow("QM_CONNECTION_UNAVAILABLE");
});

it("runs bounded Maps discovery only for a Sales role with CRM enabled", async () => {
  mocks.mapsSearch.mockResolvedValue([
    {
      title: "Synthetic studio",
      provenance: "composio:COMPOSIO_SEARCH_GOOGLE_MAPS",
    },
  ]);
  await expect(
    runQmOsTool(token, {
      operation: "google_maps_search",
      q: "creative agencies in Dubai",
      ll: "@25.2048,55.2708,12z",
      start: 0,
    }),
  ).resolves.toHaveLength(1);
  expect(mocks.featureEnabled).toHaveBeenCalledWith("crm.workspace", {
    userId: employeeId,
    roles: staff.roles,
  });
  expect(mocks.featureEnabled).toHaveBeenCalledTimes(3);
  mocks.featureEnabled.mockResolvedValueOnce(false);
  await expect(
    runQmOsTool(token, {
      operation: "google_maps_search",
      q: "Dubai agencies",
    }),
  ).rejects.toThrow("QM_SALES_ACCESS_DENIED");
});

it("keeps the route disabled by default and rejects arbitrary or oversized operations", async () => {
  for (const body of [
    {
      operation: "linkedin_manual_draft",
      dealId,
      profileContent: "scraped post",
    },
    {
      operation: "connected_search",
      app: "linkedin",
      connectedAccountId: "x",
      query: "posts",
    },
    {
      operation: "provider_execute",
      endpoint: "https://example.com",
      method: "POST",
    },
  ])
    expect((await POST(request(body))).status).toBe(403);
  vi.stubEnv("QM_OS_TOOLS_ENABLED", "0");
  expect((await POST(request({ operation: "sales_digest" }))).status).toBe(403);
  expect((await POST(request({}, ""))).status).toBe(403);
  expect((await POST(request({ padding: "x".repeat(32_768) }))).status).toBe(
    413,
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(32_769)));
      controller.close();
    },
  });
  const noLength = new Request("https://os.example/api/qm/os", {
    method: "POST",
    headers: { "x-agent-capability": token },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  expect((await POST(noLength)).status).toBe(413);
});
