import { z } from "zod";
import { googleChatAccessToken } from "./google-chat";

const GOOGLE_CHAT_API_URL = "https://chat.googleapis.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 1_000;
const MAX_PAGES = 20;
const MAX_MEMBERSHIPS = 1_000;
const OWNED_USER_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
] as const;
const googleSpaceNameSchema = z
  .string()
  .max(500)
  .regex(/^spaces\/[A-Za-z0-9_-]+$/);
const googleMemberNameSchema = z
  .string()
  .max(500)
  .regex(/^spaces\/[A-Za-z0-9_-]+\/members\/[A-Za-z0-9_-]+$/);
const googleUserNameSchema = z
  .string()
  .max(100)
  .regex(/^users\/[0-9]+$/);

const spaceSchema = z
  .object({
    name: googleSpaceNameSchema,
    spaceType: z.literal("SPACE"),
    displayName: z.string().trim().min(1).max(128),
    externalUserAllowed: z.literal(false).default(false),
    membershipCount: z
      .object({
        joinedDirectHumanUserCount: z.number().int().nonnegative().default(0),
        joinedGroupCount: z.number().int().nonnegative().default(0),
      })
      .default({}),
    accessSettings: z.object({
      accessState: z.literal("PRIVATE"),
      audience: z.string().optional(),
    }),
  })
  .passthrough();
const membershipSchema = z
  .object({
    name: googleMemberNameSchema,
    state: z.literal("JOINED"),
    role: z.enum(["ROLE_MEMBER", "ROLE_MANAGER", "ROLE_ASSISTANT_MANAGER"]),
    affiliation: z.literal("INTERNAL"),
    member: z.object({
      name: googleUserNameSchema,
      type: z.literal("HUMAN"),
    }),
    groupMember: z.never().optional(),
  })
  .passthrough();
const membershipPageSchema = z
  .object({
    memberships: z.array(z.unknown()).max(PAGE_SIZE),
    nextPageToken: z.string().max(2_000).optional(),
  })
  .passthrough();

export type GoogleChatSpaceSnapshot = Readonly<{
  spaceName: string;
  directHumanCount: number;
  joinedGroupCount: number;
  membershipCoverage: "APP_AUTH_HUMANS_ONLY_INCOMPLETE";
  members: readonly Readonly<{
    membershipName: string;
    userName: string;
    role: "ROLE_MEMBER" | "ROLE_MANAGER" | "ROLE_ASSISTANT_MANAGER";
  }>[];
}>;

export type GoogleChatUserMembershipSnapshot = Readonly<{
  spaceName: string;
  audiencePolicy: "PRIVATE_NO_EXTERNAL_OR_GROUPS";
  /** Complete user-authenticated roster, distinct from binding authorization. */
  membershipCoverage: "COMPLETE_USER_AUTH";
  bindingReady: false;
  assistantBotUserName: string;
  humans: readonly Readonly<{
    membershipName: string;
    userName: string;
    role: "ROLE_MEMBER" | "ROLE_MANAGER" | "ROLE_ASSISTANT_MANAGER";
  }>[];
  members: readonly Readonly<{
    membershipName: string;
    userName: string;
    kind: "HUMAN" | "BOT";
    role: "ROLE_MEMBER" | "ROLE_MANAGER" | "ROLE_ASSISTANT_MANAGER";
  }>[];
}>;
const userMembershipSchema = z
  .object({
    name: googleMemberNameSchema,
    state: z.literal("JOINED"),
    role: z.enum(["ROLE_MEMBER", "ROLE_MANAGER", "ROLE_ASSISTANT_MANAGER"]),
    affiliation: z.literal("INTERNAL"),
    member: z.object({
      name: googleUserNameSchema,
      type: z.enum(["HUMAN", "BOT"]),
    }),
    groupMember: z.never().optional(),
  })
  .passthrough();

function providerFailure(code: string): never {
  throw new Error(code);
}

function validatePrivateSpace(raw: unknown, expectedSpaceName: string) {
  const space = spaceSchema.safeParse(raw);
  if (!space.success || space.data.name !== expectedSpaceName)
    providerFailure("GOOGLE_CHAT_SPACE_METADATA_INVALID");
  if (space.data.accessSettings.audience !== undefined)
    providerFailure("GOOGLE_CHAT_SPACE_NOT_PRIVATE");
  if (space.data.membershipCount.joinedGroupCount !== 0)
    providerFailure("GOOGLE_CHAT_SPACE_GROUP_MEMBERSHIP");
  return space.data;
}

async function fetchJson(url: string, accessToken: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return providerFailure("GOOGLE_CHAT_SPACE_PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) {
    return providerFailure(`GOOGLE_CHAT_SPACE_PROVIDER_${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    return providerFailure("GOOGLE_CHAT_SPACE_PROVIDER_INVALID_JSON");
  }
}

/**
 * Reads and validates only the current provider Space audience. This is not
 * wired to project authority, turn delivery, storage, or any mutation path.
 */
export async function readValidatedGoogleChatSpace(
  rawSpaceName: string,
): Promise<GoogleChatSpaceSnapshot> {
  const spaceName = googleSpaceNameSchema.safeParse(rawSpaceName);
  if (!spaceName.success) providerFailure("GOOGLE_CHAT_SPACE_NAME_INVALID");

  const metadataAccessToken = await googleChatAccessToken("space-proof");
  const rawSpace = await fetchJson(
    `${GOOGLE_CHAT_API_URL}/${spaceName.data}`,
    metadataAccessToken,
  );
  const space = validatePrivateSpace(rawSpace, spaceName.data);

  // App-authenticated membership reads omit Chat app memberships. This is a
  // bounded human snapshot, never complete delivery authorization.
  const membershipAccessToken = await googleChatAccessToken();
  const members: {
    membershipName: string;
    userName: string;
    role: "ROLE_MEMBER" | "ROLE_MANAGER" | "ROLE_ASSISTANT_MANAGER";
  }[] = [];
  const membershipNames = new Set<string>();
  const userNames = new Set<string>();
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      showGroups: "true",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const rawPage = await fetchJson(
      `${GOOGLE_CHAT_API_URL}/${spaceName.data}/members?${query}`,
      membershipAccessToken,
    );
    const parsedPage = membershipPageSchema.safeParse(rawPage);
    if (!parsedPage.success) {
      providerFailure("GOOGLE_CHAT_SPACE_MEMBERSHIP_PAGE_INVALID");
    }
    for (const rawMembership of parsedPage.data.memberships) {
      const membership = membershipSchema.safeParse(rawMembership);
      if (
        !membership.success ||
        !membership.data.name.startsWith(`${spaceName.data}/members/`)
      ) {
        providerFailure("GOOGLE_CHAT_SPACE_MEMBER_INVALID");
      }
      if (
        membershipNames.has(membership.data.name) ||
        userNames.has(membership.data.member.name)
      ) {
        providerFailure("GOOGLE_CHAT_SPACE_MEMBER_DUPLICATE");
      }
      membershipNames.add(membership.data.name);
      userNames.add(membership.data.member.name);
      members.push({
        membershipName: membership.data.name,
        userName: membership.data.member.name,
        role: membership.data.role,
      });
      if (members.length > MAX_MEMBERSHIPS) {
        providerFailure("GOOGLE_CHAT_SPACE_MEMBERSHIP_LIMIT");
      }
    }
    const nextPageToken = parsedPage.data.nextPageToken;
    if (!nextPageToken) {
      if (members.length !== space.membershipCount.joinedDirectHumanUserCount) {
        providerFailure("GOOGLE_CHAT_SPACE_MEMBERSHIP_COUNT_MISMATCH");
      }
      return {
        spaceName: space.name,
        directHumanCount: members.length,
        joinedGroupCount: 0,
        membershipCoverage: "APP_AUTH_HUMANS_ONLY_INCOMPLETE",
        members,
      };
    }
    if (seenPageTokens.has(nextPageToken)) {
      providerFailure("GOOGLE_CHAT_SPACE_PAGE_TOKEN_REPEATED");
    }
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  return providerFailure("GOOGLE_CHAT_SPACE_PAGE_LIMIT");
}

/**
 * Server-only reader for an already-owned user OAuth token with
 * chat.spaces.readonly and chat.memberships.readonly. Existing Workspace
 * credentials do not request both scopes; this result cannot authorize a binding. Google
 * documents `members/app` for user authentication. The caller must resolve
 * this token from an owned HRMNY Google-client connection; no route accepts it.
 */
export async function readGoogleChatOwnedUserMembershipSnapshot(input: {
  spaceName: string;
  ownedAccessToken: string;
  grantedScopes: readonly string[];
}): Promise<GoogleChatUserMembershipSnapshot> {
  const spaceName = googleSpaceNameSchema.safeParse(input.spaceName);
  if (
    !spaceName.success ||
    !z.string().min(20).safeParse(input.ownedAccessToken).success ||
    !z.array(z.string()).max(100).safeParse(input.grantedScopes).success ||
    OWNED_USER_REQUIRED_SCOPES.some(
      (scope) => !input.grantedScopes.includes(scope),
    )
  ) {
    providerFailure("GOOGLE_CHAT_USER_CREDENTIAL_INVALID");
  }
  const rawSpace = await fetchJson(
    `${GOOGLE_CHAT_API_URL}/${spaceName.data}`,
    input.ownedAccessToken,
  );
  const space = validatePrivateSpace(rawSpace, spaceName.data);
  const rawAppMembership = await fetchJson(
    `${GOOGLE_CHAT_API_URL}/${spaceName.data}/members/app`,
    input.ownedAccessToken,
  );
  const appMembership = userMembershipSchema.safeParse(rawAppMembership);
  if (
    !appMembership.success ||
    !appMembership.data.name.startsWith(`${spaceName.data}/members/`) ||
    appMembership.data.member.type !== "BOT"
  ) {
    providerFailure("GOOGLE_CHAT_ASSISTANT_APP_INVALID");
  }
  const members: GoogleChatUserMembershipSnapshot["members"][number][] = [];
  const names = new Set<string>();
  const users = new Set<string>();
  const tokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      showGroups: "true",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const rawPage = await fetchJson(
      `${GOOGLE_CHAT_API_URL}/${spaceName.data}/members?${query}`,
      input.ownedAccessToken,
    );
    const parsed = membershipPageSchema.safeParse(rawPage);
    if (!parsed.success)
      providerFailure("GOOGLE_CHAT_SPACE_MEMBERSHIP_PAGE_INVALID");
    for (const raw of parsed.data.memberships) {
      const membership = userMembershipSchema.safeParse(raw);
      if (
        !membership.success ||
        !membership.data.name.startsWith(`${spaceName.data}/members/`)
      ) {
        providerFailure("GOOGLE_CHAT_SPACE_MEMBER_INVALID");
      }
      if (
        names.has(membership.data.name) ||
        users.has(membership.data.member.name)
      ) {
        providerFailure("GOOGLE_CHAT_SPACE_MEMBER_DUPLICATE");
      }
      names.add(membership.data.name);
      users.add(membership.data.member.name);
      members.push({
        membershipName: membership.data.name,
        userName: membership.data.member.name,
        kind: membership.data.member.type,
        role: membership.data.role,
      });
      if (members.length > MAX_MEMBERSHIPS)
        providerFailure("GOOGLE_CHAT_SPACE_MEMBERSHIP_LIMIT");
    }
    const next = parsed.data.nextPageToken;
    if (!next) {
      const bots = members.filter((member) => member.kind === "BOT");
      if (
        bots.length !== 1 ||
        bots[0]?.membershipName !== appMembership.data.name ||
        bots[0]?.userName !== appMembership.data.member.name
      ) {
        providerFailure("GOOGLE_CHAT_ASSISTANT_APP_MISMATCH");
      }
      const humans = members
        .filter((member) => member.kind === "HUMAN")
        .map(({ membershipName, userName, role }) => ({
          membershipName,
          userName,
          role,
        }));
      if (humans.length !== space.membershipCount.joinedDirectHumanUserCount)
        providerFailure("GOOGLE_CHAT_SPACE_MEMBERSHIP_COUNT_MISMATCH");
      return {
        spaceName: spaceName.data,
        audiencePolicy: "PRIVATE_NO_EXTERNAL_OR_GROUPS",
        membershipCoverage: "COMPLETE_USER_AUTH",
        bindingReady: false,
        assistantBotUserName: appMembership.data.member.name,
        humans,
        members,
      };
    }
    if (tokens.has(next))
      providerFailure("GOOGLE_CHAT_SPACE_PAGE_TOKEN_REPEATED");
    tokens.add(next);
    pageToken = next;
  }
  return providerFailure("GOOGLE_CHAT_SPACE_PAGE_LIMIT");
}
