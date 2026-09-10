import { beforeEach, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { resolveActiveStaffById } from "../auth/session";
import { resolveEmployeeGoogleIdentity } from "./google-identity";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../auth/session", () => ({ resolveActiveStaffById: vi.fn() }));

const execute = vi.fn();
const input = {
  action: "resolve_identity" as const,
  proof: "oidc" as const,
  principal: "developer@hrmny.co",
  googleIssuer: "https://accounts.google.com" as const,
  googleSubject: "123",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockReturnValue({ execute } as never);
  execute.mockResolvedValue([
    {
      employee_id: "11111111-1111-4111-8111-111111111111",
      qm_principal: input.principal,
    },
  ]);
  vi.mocked(resolveActiveStaffById).mockResolvedValue({
    employeeId: "11111111-1111-4111-8111-111111111111",
    email: input.principal,
    displayName: "Developer",
    roles: [],
    permissions: [],
    actorType: "staff",
    clientId: null,
  });
});

it.each([
  { ...input, googleIssuer: "https://other.example" },
  { ...input, googleIssuer: undefined },
  { ...input, googleSubject: "1e2" },
  { ...input, principal: "Developer@hrmny.co" },
  { action: "resolve_identity", proof: "chat", googleChatUser: "other/123" },
  { action: "resolve_identity", proof: "chat", googleChatUser: "users/123/" },
  { action: "resolve_identity", proof: "chat", googleChatUser: "users/+123" },
  null,
])(
  "rejects invalid direct-call proofs before database access: %j",
  async (proof) => {
    await expect(resolveEmployeeGoogleIdentity(proof)).rejects.toThrow();
    expect(getDb).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  },
);

it("returns only an exact active staff binding for OIDC and Chat proofs", async () => {
  await expect(resolveEmployeeGoogleIdentity(input)).resolves.toEqual({
    employeeId: "11111111-1111-4111-8111-111111111111",
    principal: input.principal,
  });
  await expect(
    resolveEmployeeGoogleIdentity({
      action: "resolve_identity",
      proof: "chat",
      googleChatUser: "users/123",
    }),
  ).resolves.toEqual({
    employeeId: "11111111-1111-4111-8111-111111111111",
    principal: input.principal,
  });

  execute.mockResolvedValueOnce([]);
  await expect(resolveEmployeeGoogleIdentity(input)).resolves.toBeNull();
  vi.mocked(resolveActiveStaffById).mockResolvedValueOnce(null);
  await expect(resolveEmployeeGoogleIdentity(input)).resolves.toBeNull();
  vi.mocked(resolveActiveStaffById).mockResolvedValueOnce({
    employeeId: "11111111-1111-4111-8111-111111111111",
    email: "changed@hrmny.co",
    displayName: "Developer",
    roles: [],
    permissions: [],
    actorType: "staff",
    clientId: null,
  });
  await expect(resolveEmployeeGoogleIdentity(input)).resolves.toBeNull();
});
