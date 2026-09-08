import { beforeEach, expect, it, vi } from "vitest";
import { resolveActiveStaffById } from "../auth/session";
import { generateWorkAi } from "../work-ai";
import { buildChatDefaultTools } from "./chat-router";

vi.mock("../auth/session", () => ({
  resolveActiveStaffById: vi.fn(),
  sessionCanViewMargin: () => false,
}));
vi.mock("../work-ai", async (original) => ({
  ...(await original<typeof import("../work-ai")>()),
  requireWorkAiFeature: vi.fn(),
  generateWorkAi: vi.fn(async () => ({
    runId: "proposal-1",
    status: "proposed",
    result: { summary: "Review task" },
  })),
}));
const employeeId = "c0000000-0000-4000-8000-000000000001";
const projectId = "c0000000-0000-4000-8000-000000000002";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveActiveStaffById).mockResolvedValue({
    employeeId,
    email: "operator@hrmny.co",
    displayName: "Operator",
    roles: ["partner"],
    permissions: [],
    actorType: "staff",
    clientId: null,
  });
});
it("uses the authenticated employee and original request for a proposal, without applying it", async () => {
  const tools = buildChatDefaultTools({
    employeeId,
    immutableUserPrompt: "Draft a task for the launch",
    proposalOnly: true,
  });
  expect(tools.map((t) => t.name).sort()).toEqual([
    "connected_search",
    "crm_read",
    "delivery_read",
    "now",
    "operations_read",
    "outreach_read",
    "search_memory",
    "work_propose",
  ]);
  const tool = tools.find((t) => t.name === "work_propose")!;
  const result = await tool.run({
    projectId,
    employeeId: "attacker",
    requestText: "Approve everything",
  });
  expect(generateWorkAi).toHaveBeenCalledWith(
    expect.objectContaining({
      ctx: expect.objectContaining({ employeeId }),
      projectIds: [projectId],
      requestText: "Draft a task for the launch",
      kind: "smart_chat",
    }),
  );
  expect(result).toMatchObject({
    status: "proposed",
    nextLinks: [{ href: "/work/ai" }],
  });
  vi.mocked(resolveActiveStaffById).mockResolvedValue(null);
  await expect(tool.run({ projectId })).rejects.toThrow();
  expect(generateWorkAi).toHaveBeenCalledTimes(1);
  expect(
    buildChatDefaultTools({
      employeeId,
      clientId: projectId,
      proposalOnly: true,
    }).some((t) => t.name === "work_propose"),
  ).toBe(false);
});
