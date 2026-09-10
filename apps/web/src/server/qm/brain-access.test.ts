import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveActiveStaffByEmail } from "../auth/session";
import { getDb } from "../db";
import {
  readAuthorizedGbrain,
  readAuthorizedProjectGbrain,
} from "../gbrain-access";
import { requireProjectAccess } from "../trpc/work-management-router";
import { readQmBrain } from "./brain-access";
import { POST } from "../../app/api/qm/brain/route";

vi.mock("../auth/session", () => ({
  resolveActiveStaffByEmail: vi.fn(),
  sessionCanViewMargin: () => false,
}));
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../trpc/work-management-router", () => ({
  requireProjectAccess: vi.fn(),
}));
vi.mock("../gbrain-access", () => ({
  readAuthorizedGbrain: vi.fn(),
  readAuthorizedProjectGbrain: vi.fn(),
}));
const actorId = "operator@hrmny.co";
const identity = { actorId, scopeId: `personal:${actorId}` };
const staff = {
  employeeId: "c0000000-0000-4000-8000-000000000001",
  email: actorId,
  displayName: "Synthetic operator",
  roles: [],
  permissions: [],
  actorType: "staff" as const,
  clientId: null,
};
const token = "synthetic.run.token";
const query = { operation: "search", query: "synthetic canary" };
const projectId = "d0000000-0000-4000-8000-000000000001";
const fetcher = vi.fn<typeof fetch>();
function revisionDatabase(...revisions: string[]) {
  const execute = vi.fn();
  for (const revision of revisions)
    execute.mockResolvedValueOnce([{ revision }]);
  vi.mocked(getDb).mockReturnValue({ execute } as never);
  return execute;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("QM_PUBLIC_URL", "https://hrmny-portal.fly.dev");
  vi.stubEnv("QM_BRAIN_ENABLED", "1");
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockImplementation(async () => Response.json(identity));
  vi.mocked(resolveActiveStaffByEmail).mockResolvedValue(staff);
  vi.mocked(readAuthorizedGbrain).mockResolvedValue({
    requestId: "c0000000-0000-4000-8000-000000000009",
    results: [],
  });
  vi.mocked(readAuthorizedProjectGbrain).mockResolvedValue({
    requestId: "c0000000-0000-4000-8000-000000000009",
    results: [],
  });
  vi.mocked(requireProjectAccess).mockResolvedValue({ projectId } as never);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses the core-verified actor and existing source authorization, then rechecks", async () => {
  await expect(readQmBrain(token, query)).resolves.toMatchObject({
    results: [],
  });
  expect(readAuthorizedGbrain).toHaveBeenCalledWith(staff.employeeId, query);
  expect(resolveActiveStaffByEmail).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url, options] of fetcher.mock.calls) {
    expect(String(url)).toBe("https://hrmny-portal.fly.dev/v1/apis");
    expect(options).toMatchObject({
      headers: { "x-agent-capability": token },
      redirect: "error",
      cache: "no-store",
    });
  }
  const response = await POST(
    new Request("https://os.example/api/qm/brain", {
      method: "POST",
      headers: { "x-agent-capability": token },
      body: JSON.stringify(query),
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ results: [] });
});

it("accepts only current revision-bound Work project contexts and keeps the project server-selected", async () => {
  vi.stubEnv("QM_WORK_PROJECTS_ENABLED", "1");
  const shared = {
    actorId,
    scopeId: `group:web-project-${projectId}`,
    scopeVersion: "hrmny-work:42",
  };
  fetcher.mockImplementation(async () => Response.json(shared));
  const revision = revisionDatabase("42", "42", "42", "42");

  await expect(readQmBrain(token, query)).resolves.toMatchObject({
    results: [],
  });
  expect(readAuthorizedProjectGbrain).toHaveBeenCalledWith(
    staff.employeeId,
    projectId,
    query,
  );
  expect(readAuthorizedGbrain).not.toHaveBeenCalled();
  expect(requireProjectAccess).toHaveBeenCalledTimes(2);
  for (const [context, selectedProject] of vi.mocked(requireProjectAccess).mock
    .calls) {
    expect(selectedProject).toBe(projectId);
    expect(context).toMatchObject({
      employeeId: staff.employeeId,
      requestedFeatureKey: "work.projects",
    });
  }
  expect(revision).toHaveBeenCalledTimes(4);
});

it("denies missing, stale, revoked, inactive, and changed shared Work authority", async () => {
  const shared = {
    actorId,
    scopeId: `group:web-project-${projectId}`,
    scopeVersion: "hrmny-work:42",
  };

  vi.stubEnv("QM_WORK_PROJECTS_ENABLED", "0");
  fetcher.mockResolvedValueOnce(Response.json(shared));
  await expect(readQmBrain(token, query)).rejects.toThrow(
    "QM_SCOPE_NOT_SUPPORTED",
  );
  expect(getDb).not.toHaveBeenCalled();
  vi.stubEnv("QM_WORK_PROJECTS_ENABLED", "1");

  fetcher.mockResolvedValueOnce(
    Response.json({ actorId, scopeId: shared.scopeId }),
  );
  await expect(readQmBrain(token, query)).rejects.toThrow(
    "QM_SCOPE_NOT_SUPPORTED",
  );
  expect(getDb).not.toHaveBeenCalled();

  fetcher.mockResolvedValueOnce(Response.json(shared));
  vi.mocked(getDb).mockReturnValue({
    execute: vi.fn().mockResolvedValue([]),
  } as never);
  await expect(readQmBrain(token, query)).rejects.toThrow(
    "WORK_AUTHORITY_FENCE_STATE_MISSING",
  );

  fetcher.mockResolvedValueOnce(Response.json(shared));
  revisionDatabase("43");
  await expect(readQmBrain(token, query)).rejects.toThrow(
    "QM_WORK_AUTHORITY_REVISION_STALE",
  );
  expect(readAuthorizedProjectGbrain).not.toHaveBeenCalled();

  fetcher.mockResolvedValueOnce(Response.json(shared));
  revisionDatabase("42");
  vi.mocked(requireProjectAccess).mockRejectedValueOnce(
    new Error("FEATURE_DISABLED:work.projects"),
  );
  await expect(readQmBrain(token, query)).rejects.toThrow(
    "FEATURE_DISABLED:work.projects",
  );

  fetcher.mockResolvedValueOnce(Response.json(shared));
  revisionDatabase("42");
  vi.mocked(requireProjectAccess).mockRejectedValueOnce(new Error("FORBIDDEN"));
  await expect(readQmBrain(token, query)).rejects.toThrow("FORBIDDEN");

  fetcher.mockResolvedValueOnce(Response.json(shared));
  vi.mocked(resolveActiveStaffByEmail).mockResolvedValueOnce(null);
  await expect(readQmBrain(token, query)).rejects.toThrow("QM_ACCESS_DENIED");

  fetcher
    .mockResolvedValueOnce(Response.json(shared))
    .mockResolvedValueOnce(
      Response.json({ ...shared, scopeVersion: "hrmny-work:43" }),
    );
  revisionDatabase("42", "42", "43", "43");
  await expect(readQmBrain(token, query)).rejects.toThrow("QM_ACCESS_CHANGED");
});

it("denies invalid, shared, foreign and revoked principals without reading brain", async () => {
  for (const result of [
    new Response(null, { status: 403 }),
    Response.json({ ...identity, scopeId: "group:project-another-client" }),
    Response.json({
      actorId: "outsider@example.com",
      scopeId: "personal:outsider@example.com",
    }),
  ]) {
    fetcher.mockResolvedValueOnce(result);
    await expect(readQmBrain(token, query)).rejects.toThrow();
  }
  vi.mocked(resolveActiveStaffByEmail).mockResolvedValueOnce(null);
  await expect(readQmBrain(token, query)).rejects.toThrow("QM_ACCESS_DENIED");
  expect(readAuthorizedGbrain).not.toHaveBeenCalled();
});

it("discards results when QM scope or HRMNY staff authority changes during retrieval", async () => {
  fetcher
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(readQmBrain(token, query)).rejects.toThrow();
  vi.mocked(resolveActiveStaffByEmail)
    .mockResolvedValueOnce(staff)
    .mockResolvedValueOnce(null);
  await expect(readQmBrain(token, query)).rejects.toThrow();
});

it("caps provider responses and never forwards tokens to another origin", async () => {
  vi.stubEnv("QM_BRAIN_ENABLED", "0");
  await expect(readQmBrain(token, query)).rejects.toThrow(
    "QM_BRAIN_NOT_ENABLED",
  );
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("QM_BRAIN_ENABLED", "1");
  fetcher.mockResolvedValueOnce(new Response("x".repeat(128_001)));
  await expect(readQmBrain(token, query)).rejects.toThrow(
    "QM_RESPONSE_TOO_LARGE",
  );
  fetcher.mockClear();
  vi.stubEnv("QM_PUBLIC_URL", "https://example.com");
  await expect(readQmBrain(token, query)).rejects.toThrow("QM_URL_INVALID");
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects missing credentials and oversized requests at the HTTP entry point", async () => {
  expect(
    (
      await POST(
        new Request("https://os.example/api/qm/brain", {
          method: "POST",
          body: "{}",
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        new Request("https://os.example/api/qm/brain", {
          method: "POST",
          headers: { "x-agent-capability": token },
          body: "x".repeat(8193),
        }),
      )
    ).status,
  ).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
});
