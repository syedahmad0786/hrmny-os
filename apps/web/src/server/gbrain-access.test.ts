import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { resolveActiveStaffById } from "./auth/session";
import { requireProjectAccess } from "./trpc/work-management-router";
import {
  readAuthorizedGbrain,
  readAuthorizedProjectGbrain,
} from "./gbrain-access";
import { buildChatDefaultTools } from "./trpc/chat-router";
vi.mock("./auth/session", () => ({
  resolveActiveStaffById: vi.fn(),
  sessionCanViewMargin: () => false,
}));
vi.mock("./trpc/work-management-router", () => ({
  requireProjectAccess: vi.fn(),
}));
const employeeId = "c0000000-0000-4000-8000-000000000001";
const projectId = "c0000000-0000-4000-8000-000000000002";
const staff = {
  employeeId,
  email: "staff@example.test",
  displayName: "Synthetic staff",
  roles: [],
  permissions: [],
  actorType: "staff" as const,
  clientId: null,
};
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GBRAIN_RETRIEVAL_URL", "https://brain.example.test/read");
  vi.stubEnv("GBRAIN_REQUEST_SECRET", "synthetic-test-key-".repeat(3));
  vi.stubGlobal("fetch", fetcher);
  vi.mocked(resolveActiveStaffById).mockResolvedValue(staff);
  vi.mocked(requireProjectAccess).mockResolvedValue({ projectId } as Awaited<
    ReturnType<typeof requireProjectAccess>
  >);
  fetcher.mockImplementation(async (_url, options) => {
    const body = String(options?.body);
    expect(options?.headers).toMatchObject({
      "x-hrmny-signature": createHmac(
        "sha256",
        process.env.GBRAIN_REQUEST_SECRET!,
      )
        .update(body)
        .digest("hex"),
    });
    return Response.json({
      requestId: JSON.parse(body).requestId,
      results: [],
    });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("uses current project access and server-selected sources, then rechecks before returning", async () => {
  await readAuthorizedGbrain(employeeId, {
    operation: "search",
    query: "launch",
    projectId,
  });
  expect(requireProjectAccess).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).sources).toEqual([
    "hrmny-company",
    `hrmny-personal-${employeeId}`,
    `hrmny-project-${projectId}`,
  ]);
  await expect(
    readAuthorizedGbrain(employeeId, {
      operation: "search",
      query: "launch",
      sources: ["other"],
    }),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("uses only company and the trusted Work project for a shared-context read", async () => {
  await readAuthorizedProjectGbrain(employeeId, projectId, {
    operation: "search",
    query: "launch",
  });
  expect(requireProjectAccess).toHaveBeenCalledTimes(2);
  for (const [context, selectedProject] of vi.mocked(requireProjectAccess).mock
    .calls) {
    expect(selectedProject).toBe(projectId);
    expect(context).toMatchObject({ requestedFeatureKey: "work.projects" });
  }
  const sources = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).sources;
  expect(sources).toEqual(["hrmny-company", `hrmny-project-${projectId}`]);
  expect(sources).not.toContain(`hrmny-personal-${employeeId}`);

  await expect(
    readAuthorizedProjectGbrain(employeeId, projectId, {
      operation: "search",
      query: "launch",
      projectId: "c0000000-0000-4000-8000-000000000003",
    }),
  ).rejects.toThrow("GBRAIN_PROJECT_SCOPE_MISMATCH");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("blocks unauthorized projects before dispatch and revocation during provider execution", async () => {
  vi.mocked(requireProjectAccess).mockRejectedValueOnce(new Error("FORBIDDEN"));
  await expect(
    readAuthorizedGbrain(employeeId, {
      operation: "search",
      query: "launch",
      projectId,
    }),
  ).rejects.toThrow("FORBIDDEN");
  expect(fetcher).not.toHaveBeenCalled();
  vi.mocked(resolveActiveStaffById)
    .mockResolvedValueOnce(staff)
    .mockResolvedValueOnce(null);
  await expect(
    readAuthorizedGbrain(employeeId, { operation: "search", query: "launch" }),
  ).rejects.toThrow("GBRAIN_ACCESS_DENIED");
});
it("binds web and Google Chat tools to the authenticated employee and excludes client scopes", async () => {
  const tool = buildChatDefaultTools({ employeeId, proposalOnly: true }).find(
    (entry) => entry.name === "brain_read",
  );
  expect(tool).toBeDefined();
  await tool!.run({ operation: "search", query: "launch", projectId });
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).employeeId).toBe(
    employeeId,
  );
  await expect(
    tool!.run({ operation: "search", query: "launch", employeeId: projectId }),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    buildChatDefaultTools({ employeeId, clientId: projectId }).some(
      (entry) => entry.name === "brain_read",
    ),
  ).toBe(false);
  vi.stubEnv("GBRAIN_REQUEST_SECRET", "");
  expect(
    buildChatDefaultTools({ employeeId }).some(
      (entry) => entry.name === "brain_read",
    ),
  ).toBe(false);
});
