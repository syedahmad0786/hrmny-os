import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readValidatedGoogleChatSpace } from "./google-chat-space-proof";

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

function mockProvider(...responses: Response[]) {
  vi.stubEnv(
    "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON",
    JSON.stringify({
      client_email: "hrmny-chat@example.iam.gserviceaccount.com",
      private_key: privateKey.export({ format: "pem", type: "pkcs8" }),
    }),
  );
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(Response.json({ access_token: "proof-token" }));
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function signedScope(fetchMock: ReturnType<typeof vi.fn>) {
  const body = String(fetchMock.mock.calls[0]?.[1]?.body);
  const assertion = new URLSearchParams(body).get("assertion");
  const claims = JSON.parse(
    Buffer.from(assertion!.split(".")[1]!, "base64url").toString("utf8"),
  );
  return claims.scope;
}

describe("Google Chat Space provider proof", () => {
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
      Response.json({ memberships: [member("100")], nextPageToken: "page-2" }),
      Response.json({ memberships: [member("200")] }),
    );

    await expect(readValidatedGoogleChatSpace(spaceName)).resolves.toEqual({
      spaceName,
      directHumanCount: 2,
      joinedGroupCount: 0,
      members: [
        { membershipName: `${spaceName}/members/member-100`, userName: "users/100" },
        { membershipName: `${spaceName}/members/member-200`, userName: "users/200" },
      ],
    });
    expect(signedScope(fetchMock)).toBe(
      "https://www.googleapis.com/auth/chat.app.spaces https://www.googleapis.com/auth/chat.app.memberships",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://chat.googleapis.com/v1/spaces/AAAA",
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("showGroups=true");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("pageToken=page-2");
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
    const unavailable = mockProvider(Response.json(space()));
    unavailable.mockRejectedValueOnce(new Error("timed out"));
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
    ["nonhuman member", space(), { memberships: [member("100", { member: { name: "users/100", type: "BOT" } })] }, "GOOGLE_CHAT_SPACE_MEMBER_INVALID"],
    ["wrong membership parent", space(), { memberships: [{ ...member("100"), name: "spaces/BBBB/members/member-100" }] }, "GOOGLE_CHAT_SPACE_MEMBER_INVALID"],
  ])("rejects %s", async (_name, metadata, memberships, code) => {
    mockProvider(Response.json(metadata), Response.json(memberships));
    await expect(readValidatedGoogleChatSpace(spaceName)).rejects.toThrow(code);
  });
});
