import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveActiveStaffByEmail } from "../auth/session";
import { readAuthorizedGbrain } from "../gbrain-access";
import { readQmBrain } from "./brain-access";
import { POST } from "../../app/api/qm/brain/route";

vi.mock("../auth/session", () => ({ resolveActiveStaffByEmail: vi.fn() }));
vi.mock("../gbrain-access", () => ({ readAuthorizedGbrain: vi.fn() }));
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
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("QM_PUBLIC_URL", "https://hrmny-portal.fly.dev");
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockImplementation(async () => Response.json(identity));
  vi.mocked(resolveActiveStaffByEmail).mockResolvedValue(staff);
  vi.mocked(readAuthorizedGbrain).mockResolvedValue({
    requestId: "c0000000-0000-4000-8000-000000000009",
    results: [],
  });
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
