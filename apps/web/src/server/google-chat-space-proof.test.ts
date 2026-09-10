import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readGoogleChatUserMembershipSnapshot,
  readValidatedGoogleChatSpace,
} from "./google-chat-space-proof";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 });
const spaceName = "spaces/AAAA";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function member(id: string, overrides: Record<string, unknown> = {}) {
  return {
    name: `${spaceName}/members/member-${id}`,
    state: "JOINED",
    role: "ROLE_MEMBER",
    affiliation: "INTERNAL",
    member: { name: `users/${id}`, type: "HUMAN" },
    ...overrides,
  };
}

function space(overrides: Record<string, unknown> = {}) {
  return {
    name: spaceName,
    spaceType: "SPACE",
    displayName: "Private project space",
    externalUserAllowed: false,
    membershipCount: {
      joinedDirectHumanUserCount: 1,
      joinedGroupCount: 0,
    },
    accessSettings: { accessState: "PRIVATE" },
    ...overrides,
  };
}

function mockProvider(...responses: (Response | Error)[]) {
  vi.stubEnv(
    "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON",
    JSON.stringify({
      client_email: "hrmny-chat@example.iam.gserviceaccount.com",
      private_key: privateKey.export({ format: "pem", type: "pkcs8" }),
    }),
  );
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "proof-token" });
    }
    const response = responses.shift();
    if (!response) throw new Error("Unexpected provider request");
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function signedScopes(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([url]) => url === "https://oauth2.googleapis.com/token")
    .map(([, init]) => {
      const body = String(init?.body);
      const assertion = new URLSearchParams(body).get("assertion");
      return JSON.parse(
        Buffer.from(assertion!.split(".")[1]!, "base64url").toString("utf8"),
      ).scope;
    });
}

describe("Google Chat Space provider proof", () => {
  it("reads user-authenticated humans and bots but never marks the unbound app ready", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        memberships: [
          member("100"),
          member("200", { member: { name: "users/200", type: "BOT" } }),
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      readGoogleChatUserMembershipSnapshot({ spaceName, accessToken: "u".repeat(20) }),
    ).resolves.toEqual({
      spaceName,
      bindingReady: false,
      members: [
        { membershipName: `${spaceName}/members/member-100`, userName: "users/100", kind: "HUMAN", role: "ROLE_MEMBER" },
        { membershipName: `${spaceName}/members/member-200`, userName: "users/200", kind: "BOT", role: "ROLE_MEMBER" },
      ],
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("showGroups=true");
  });
  it("reads all joined human memberships with the fixed app proof scope", async () => {
    const fetchMock = mockProvider(
      Response.json(
        space({
          membershipCount: {
            joinedDirectHumanUserCount: 2,
            joinedGroupCount: 0,
          },
        }),
      ),
      Response.json({
        memberships: [member("100", { role: "ROLE_MANAGER" })],
        nextPageToken: "page-2",
      }),
      Response.json({ memberships: [member("200", { role: "ROLE_ASSISTANT_MANAGER" })] }),
    );

    await expect(readValidatedGoogleChatSpace(spaceName)).resolves.toEqual({
      spaceName,
      directHumanCount: 2,
      joinedGroupCount: 0,
      membershipCoverage: "APP_AUTH_HUMANS_ONLY_INCOMPLETE",
      members: [
        { membershipName: `${spaceName}/members/member-100`, userName: "users/100", role: "ROLE_MANAGER" },
        { membershipName: `${spaceName}/members/member-200`, userName: "users/200", role: "ROLE_ASSISTANT_MANAGER" },
      ],
    });
    expect(signedScopes(fetchMock)).toEqual([
      "https://www.googleapis.com/auth/chat.app.spaces",
      "https://www.googleapis.com/auth/chat.bot",
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://chat.googleapis.com/v1/spaces/AAAA",
    );
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("showGroups=true");
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain("pageToken=page-2");
  });

  it("fails closed for a repeated membership page token", async () => {
    mockProvider(
      Response.json(space()),
      Response.json({ memberships: [member("100")], nextPageToken: "again" }),
      Response.json({ memberships: [], nextPageToken: "again" }),
    );
    await expect(readValidatedGoogleChatSpace(spaceName)).rejects.toThrow(
      "GOOGLE_CHAT_SPACE_PAGE_TOKEN_REPEATED",
    );
  });

  it("fails closed when provider reads time out or exceed the page cap", async () => {
    mockProvider(Response.json(space()), new Error("timed out"));
    await expect(readValidatedGoogleChatSpace(spaceName)).rejects.toThrow(
      "GOOGLE_CHAT_SPACE_PROVIDER_UNAVAILABLE",
    );

    const pages = Array.from({ length: 20 }, (_, index) =>
      Response.json({ memberships: [], nextPageToken: `next-${index}` }),
    );
    mockProvider(Response.json(space({ membershipCount: { joinedDirectHumanUserCount: 0, joinedGroupCount: 0 } })), ...pages);
    await expect(readValidatedGoogleChatSpace(spaceName)).rejects.toThrow(
      "GOOGLE_CHAT_SPACE_PAGE_LIMIT",
    );
  });

  it.each([
    ["missing access settings", space({ accessSettings: undefined }), { memberships: [member("100")] }, "GOOGLE_CHAT_SPACE_METADATA_INVALID"],
    ["unnamed space", space({ displayName: "" }), { memberships: [member("100")] }, "GOOGLE_CHAT_SPACE_METADATA_INVALID"],
    ["external space", space({ externalUserAllowed: true }), { memberships: [member("100")] }, "GOOGLE_CHAT_SPACE_METADATA_INVALID"],
    ["group count", space({ membershipCount: { joinedDirectHumanUserCount: 1, joinedGroupCount: 1 } }), { memberships: [member("100")] }, "GOOGLE_CHAT_SPACE_GROUP_MEMBERSHIP"],
    ["external member", space(), { memberships: [member("100", { affiliation: "EXTERNAL" })] }, "GOOGLE_CHAT_SPACE_MEMBER_INVALID"],
    ["unknown affiliation", space(), { memberships: [member("100", { affiliation: "UNKNOWN" })] }, "GOOGLE_CHAT_SPACE_MEMBER_INVALID"],
    ["missing role", space(), { memberships: [member("100", { role: undefined })] }, "GOOGLE_CHAT_SPACE_MEMBER_INVALID"],
    ["nonhuman member", space(), { memberships: [member("100", { member: { name: "users/100", type: "BOT" } })] }, "GOOGLE_CHAT_SPACE_MEMBER_INVALID"],
    ["wrong membership parent", space(), { memberships: [{ ...member("100"), name: "spaces/BBBB/members/member-100" }] }, "GOOGLE_CHAT_SPACE_MEMBER_INVALID"],
  ])("rejects %s", async (_name, metadata, memberships, code) => {
    mockProvider(Response.json(metadata), Response.json(memberships));
    await expect(readValidatedGoogleChatSpace(spaceName)).rejects.toThrow(code);
  });

  it("accepts protobuf JSON's omitted false and zero defaults", async () => {
    mockProvider(
      Response.json(
        space({
          externalUserAllowed: undefined,
          membershipCount: { joinedDirectHumanUserCount: 1 },
        }),
      ),
      Response.json({ memberships: [member("100")] }),
    );
    await expect(readValidatedGoogleChatSpace(spaceName)).resolves.toMatchObject({
      directHumanCount: 1,
      joinedGroupCount: 0,
      membershipCoverage: "APP_AUTH_HUMANS_ONLY_INCOMPLETE",
    });
  });
});
