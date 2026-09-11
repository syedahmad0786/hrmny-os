import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth/session";
import {
  observeGoogleChatProjectIntersection,
  observeOwnedGoogleChatProject,
} from "./google-chat-project-intersection";

const mocks = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  staff: vi.fn(),
  access: vi.fn(),
  credentials: vi.fn(),
  readSpace: vi.fn(),
}));

vi.mock("./trpc/connections-router", () => ({
  getOwnedGoogleWorkspaceCredentials: mocks.credentials,
}));
vi.mock("./google-chat-space-proof", () => ({
  readGoogleChatOwnedUserMembershipSnapshot: mocks.readSpace,
}));

vi.mock("./qm/google-identity", () => ({
  resolveEmployeeGoogleIdentity: mocks.resolveIdentity,
}));
vi.mock("./auth/session", () => ({
  resolveActiveStaffById: mocks.staff,
  sessionCanViewMargin: () => false,
}));
vi.mock("./trpc/work-management-router", () => ({
  requireProjectAccess: mocks.access,
}));

const projectId = "c0000000-0000-4000-8000-000000000001";
const actor: SessionUser = {
  employeeId: "c0000000-0000-4000-8000-000000000002",
  actorType: "staff",
  clientId: null,
  roles: ["partner"],
  permissions: [],
  email: "manager@hrmny.co",
  displayName: "Manager",
};

function observed(overrides: Record<string, unknown> = {}) {
  return {
    spaceName: "spaces/AAAA",
    audiencePolicy: "PRIVATE_NO_EXTERNAL_OR_GROUPS" as const,
    membershipCoverage: "COMPLETE_USER_AUTH" as const,
    bindingReady: false as const,
    assistantBotUserName: "users/900",
    humans: [
      {
        membershipName: "spaces/AAAA/members/one",
        userName: "users/100",
        role: "ROLE_MANAGER" as const,
      },
    ],
    members: [
      {
        membershipName: "spaces/AAAA/members/one",
        userName: "users/100",
        kind: "HUMAN" as const,
        role: "ROLE_MANAGER" as const,
      },
      {
        membershipName: "spaces/AAAA/members/app",
        userName: "users/900",
        kind: "BOT" as const,
        role: "ROLE_MEMBER" as const,
      },
    ],
    ...overrides,
  };
}

describe("Google Chat project intersection observation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveIdentity.mockResolvedValue({
      employeeId: actor.employeeId,
      principal: actor.email,
    });
    mocks.staff.mockResolvedValue(actor);
    mocks.access.mockResolvedValue({ projectId });
    mocks.credentials.mockResolvedValue({
      accessToken: "synthetic-owned-token",
      grantedScopes: ["synthetic-provider-scope"],
      accountEmail: actor.email,
      connectionAccountId: "c0000000-0000-4000-8000-000000000003",
    });
    mocks.readSpace.mockResolvedValue(observed());
  });

  const ownedRequest = {
    actor,
    projectId,
    spaceName: "spaces/AAAA",
    connectionAccountId: "c0000000-0000-4000-8000-000000000003",
  };

  it("reads only an owned account after current Work management permission, then rechecks the audience", async () => {
    const result = await observeOwnedGoogleChatProject(ownedRequest);
    expect(result).toMatchObject({
      bindingReady: false,
      humanEmployeeIds: [actor.employeeId],
    });
    expect(mocks.access).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ user: actor }),
      projectId,
      "admin",
    );
    expect(mocks.credentials).toHaveBeenCalledWith(
      actor.employeeId,
      ownedRequest.connectionAccountId,
    );
    expect(mocks.readSpace).toHaveBeenCalledWith({
      spaceName: ownedRequest.spaceName,
      ownedAccessToken: "synthetic-owned-token",
      grantedScopes: ["synthetic-provider-scope"],
    });
    expect(mocks.access).toHaveBeenLastCalledWith(
      expect.any(Object),
      projectId,
      "admin",
    );
    expect(JSON.stringify(result)).not.toContain("synthetic-owned-token");
  });

  it("denies inactive or unauthorized staff before reading a credential or calling Google", async () => {
    mocks.staff.mockResolvedValueOnce(null);
    await expect(observeOwnedGoogleChatProject(ownedRequest)).rejects.toThrow(
      "GOOGLE_CHAT_PROJECT_ACTOR_INVALID",
    );
    mocks.access.mockRejectedValueOnce(new Error("work-denied"));
    await expect(observeOwnedGoogleChatProject(ownedRequest)).rejects.toThrow(
      "work-denied",
    );
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.readSpace).not.toHaveBeenCalled();
  });

  it("denies absent or different Google accounts before provider reads", async () => {
    mocks.credentials.mockResolvedValueOnce(null).mockResolvedValueOnce({
      accessToken: "different-account-token",
      grantedScopes: [],
      accountEmail: "another@hrmny.co",
    });
    await expect(observeOwnedGoogleChatProject(ownedRequest)).rejects.toThrow(
      "GOOGLE_CHAT_PROJECT_ACCOUNT_MISMATCH",
    );
    await expect(observeOwnedGoogleChatProject(ownedRequest)).rejects.toThrow(
      "GOOGLE_CHAT_PROJECT_ACCOUNT_MISMATCH",
    );
    expect(mocks.readSpace).not.toHaveBeenCalled();
  });

  it("denies a mismatched Space response and Work revocation during provider reads", async () => {
    mocks.readSpace.mockResolvedValueOnce(
      observed({ spaceName: "spaces/OTHER" }),
    );
    await expect(observeOwnedGoogleChatProject(ownedRequest)).rejects.toThrow(
      "GOOGLE_CHAT_PROJECT_OBSERVATION_INVALID",
    );
    mocks.access.mockImplementation((_ctx, _project, role) => {
      if (role === "viewer") throw new Error("work-revoked");
      return Promise.resolve({ projectId });
    });
    await expect(observeOwnedGoogleChatProject(ownedRequest)).rejects.toThrow(
      "work-revoked",
    );
  });

  it("observes a complete stable roster with canonical Work checks without binding it", async () => {
    await expect(
      observeGoogleChatProjectIntersection({
        projectId,
        actor,
        observedGoogle: observed(),
      }),
    ).resolves.toEqual({
      spaceName: "spaces/AAAA",
      assistantBotUserName: "users/900",
      humanEmployeeIds: [actor.employeeId],
      roles: [{ employeeId: actor.employeeId, googleRole: "ROLE_MANAGER" }],
      bindingReady: false,
    });
    expect(mocks.access).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      projectId,
      "viewer",
    );
    expect(mocks.access).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      projectId,
      "admin",
    );
    expect(mocks.resolveIdentity).toHaveBeenCalledWith({
      action: "resolve_identity",
      proof: "chat",
      googleChatUser: "users/100",
    });
  });

  it.each([
    [
      "incomplete coverage",
      observed({ membershipCoverage: "APP_AUTH_HUMANS_ONLY_INCOMPLETE" }),
      "GOOGLE_CHAT_PROJECT_OBSERVATION_INVALID",
    ],
    [
      "missing private audience evidence",
      observed({ audiencePolicy: undefined }),
      "GOOGLE_CHAT_PROJECT_OBSERVATION_INVALID",
    ],
    [
      "foreign-space membership",
      observed({
        humans: [
          {
            membershipName: "spaces/BBBB/members/one",
            userName: "users/100",
            role: "ROLE_MANAGER",
          },
        ],
      }),
      "GOOGLE_CHAT_PROJECT_OBSERVATION_INVALID",
    ],
    [
      "missing assistant bot",
      observed({
        members: [
          {
            membershipName: "spaces/AAAA/members/one",
            userName: "users/100",
            kind: "HUMAN",
            role: "ROLE_MANAGER",
          },
          {
            membershipName: "spaces/AAAA/members/foreign",
            userName: "users/901",
            kind: "BOT",
            role: "ROLE_MEMBER",
          },
        ],
      }),
      "GOOGLE_CHAT_PROJECT_ASSISTANT_BOT_INVALID",
    ],
    [
      "roster mismatch",
      observed({
        members: [
          {
            membershipName: "spaces/AAAA/members/app",
            userName: "users/900",
            kind: "BOT",
            role: "ROLE_MEMBER",
          },
          {
            membershipName: "spaces/AAAA/members/two",
            userName: "users/101",
            kind: "HUMAN",
            role: "ROLE_MEMBER",
          },
        ],
      }),
      "GOOGLE_CHAT_PROJECT_ROSTER_INCOMPLETE",
    ],
    [
      "parallel role mismatch",
      observed({
        members: [
          {
            membershipName: "spaces/AAAA/members/one",
            userName: "users/100",
            kind: "HUMAN",
            role: "ROLE_MEMBER",
          },
          {
            membershipName: "spaces/AAAA/members/app",
            userName: "users/900",
            kind: "BOT",
            role: "ROLE_MEMBER",
          },
        ],
      }),
      "GOOGLE_CHAT_PROJECT_ROSTER_INCOMPLETE",
    ],
  ])("rejects %s", async (_label, snapshot, code) => {
    await expect(
      observeGoogleChatProjectIntersection({
        projectId,
        actor,
        observedGoogle: snapshot as never,
      }),
    ).rejects.toThrow(code);
  });

  it("rejects unresolved or duplicate stable identities and any Work denial", async () => {
    mocks.resolveIdentity.mockResolvedValueOnce(null);
    await expect(
      observeGoogleChatProjectIntersection({
        projectId,
        actor,
        observedGoogle: observed(),
      }),
    ).rejects.toThrow("GOOGLE_CHAT_PROJECT_IDENTITY_UNRESOLVED");

    mocks.resolveIdentity.mockResolvedValue({
      employeeId: actor.employeeId,
      principal: actor.email,
    });
    mocks.access.mockRejectedValueOnce(new Error("forbidden"));
    await expect(
      observeGoogleChatProjectIntersection({
        projectId,
        actor,
        observedGoogle: observed(),
      }),
    ).rejects.toThrow("forbidden");
  });

  it("requires the exact Work-admin participant to be a Google manager", async () => {
    await expect(
      observeGoogleChatProjectIntersection({
        projectId,
        actor,
        observedGoogle: observed({
          humans: [
            {
              membershipName: "spaces/AAAA/members/one",
              userName: "users/100",
              role: "ROLE_MEMBER",
            },
          ],
          members: [
            {
              membershipName: "spaces/AAAA/members/one",
              userName: "users/100",
              kind: "HUMAN",
              role: "ROLE_MEMBER",
            },
            {
              membershipName: "spaces/AAAA/members/app",
              userName: "users/900",
              kind: "BOT",
              role: "ROLE_MEMBER",
            },
          ],
        }),
      }),
    ).rejects.toThrow("GOOGLE_CHAT_PROJECT_ACTOR_NOT_MANAGER");
  });

  it("uses freshly resolved staff roles for the Work-admin check", async () => {
    const freshActor = { ...actor, roles: ["viewer"] };
    mocks.staff.mockResolvedValue(freshActor);
    mocks.access.mockImplementation((ctx, _projectId, minimum) => {
      if (minimum === "admin" && ctx.roles.includes("viewer"))
        throw new Error("fresh-admin-denied");
      return Promise.resolve({ projectId });
    });
    await expect(
      observeGoogleChatProjectIntersection({
        projectId,
        actor,
        observedGoogle: observed(),
      }),
    ).rejects.toThrow("fresh-admin-denied");
  });
});
