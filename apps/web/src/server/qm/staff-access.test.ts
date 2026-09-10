import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { qmStaff } from "./staff-access";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../auth/session", () => ({
  resolveActiveStaffByEmail: mocks.resolve,
}));

const actorId = "operator@hrmny.co";
const staff = {
  employeeId: "c0000000-0000-4000-8000-000000000001",
  email: actorId,
  roles: ["partner"],
  actorType: "staff",
  clientId: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("QM_PUBLIC_URL", "https://hrmny-portal.fly.dev");
  mocks.resolve.mockResolvedValue(staff);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("maps only an exact personal HRMNY run identity to current active staff", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ actorId, scopeId: `personal:${actorId}` }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(qmStaff("synthetic.run.token")).resolves.toBe(staff);
  expect(fetcher).toHaveBeenCalledWith(
    new URL("https://hrmny-portal.fly.dev/v1/apis"),
    expect.objectContaining({
      headers: { "x-agent-capability": "synthetic.run.token" },
      redirect: "error",
      cache: "no-store",
    }),
  );
  expect(mocks.resolve).toHaveBeenCalledWith(actorId);
});

it("rejects shared scopes, non-HRMNY actors, and inactive staff", async () => {
  for (const identity of [
    { actorId, scopeId: "group:shared" },
    {
      actorId: "operator@example.com",
      scopeId: "personal:operator@example.com",
    },
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(identity)),
    );
    await expect(qmStaff("synthetic.run.token")).rejects.toThrow();
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ actorId, scopeId: `personal:${actorId}` }),
    ),
  );
  mocks.resolve.mockResolvedValueOnce(null);
  await expect(qmStaff("synthetic.run.token")).rejects.toThrow(
    "QM_ACCESS_DENIED",
  );
});
