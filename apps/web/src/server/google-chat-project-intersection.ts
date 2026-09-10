import { z } from "zod";
import {
  resolveActiveStaffById,
  sessionCanViewMargin,
  type SessionUser,
} from "./auth/session";
import type { GoogleChatUserMembershipSnapshot } from "./google-chat-space-proof";
import { resolveEmployeeGoogleIdentity } from "./qm/google-identity";
import type { TrpcContext } from "./trpc/trpc";
import { requireProjectAccess } from "./trpc/work-management-router";

const projectIdSchema = z.string().uuid();
const userNameSchema = z.string().regex(/^users\/[0-9]{1,255}$/);
const membershipNameSchema = z
  .string()
  .regex(/^spaces\/[A-Za-z0-9_-]+\/members\/[A-Za-z0-9_-]+$/);
const roleSchema = z.enum([
  "ROLE_MEMBER",
  "ROLE_MANAGER",
  "ROLE_ASSISTANT_MANAGER",
]);
const observedSnapshotSchema = z
  .object({
    spaceName: z.string().regex(/^spaces\/[A-Za-z0-9_-]+$/),
    audiencePolicy: z.literal("PRIVATE_NO_EXTERNAL_OR_GROUPS"),
    membershipCoverage: z.literal("COMPLETE_USER_AUTH"),
    bindingReady: z.literal(false),
    assistantBotUserName: userNameSchema,
    humans: z
      .array(
        z.object({
          membershipName: membershipNameSchema,
          userName: userNameSchema,
          role: roleSchema,
        }),
      )
      .min(1)
      .max(1_000),
    members: z
      .array(
        z.object({
          membershipName: membershipNameSchema,
          userName: userNameSchema,
          kind: z.enum(["HUMAN", "BOT"]),
          role: roleSchema,
        }),
      )
      .min(2)
      .max(1_001),
  })
  .strict();

type Observation = Readonly<{
  spaceName: string;
  assistantBotUserName: string;
  humanEmployeeIds: readonly string[];
  roles: readonly Readonly<{
    employeeId: string;
    googleRole: "ROLE_MEMBER" | "ROLE_MANAGER" | "ROLE_ASSISTANT_MANAGER";
  }>[];
  bindingReady: false;
}>;

function staffContext(user: SessionUser): TrpcContext {
  return {
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: null,
  };
}

function deny(code: string): never {
  throw new Error(code);
}

/**
 * Observes a complete, user-authenticated Google Chat roster against live Work
 * access. It does not create a binding, authorize a turn, or claim an atomic
 * Google/Work revision; callers must repeat it immediately before any send.
 */
export async function observeGoogleChatProjectIntersection(input: {
  projectId: string;
  actor: SessionUser;
  observedGoogle: GoogleChatUserMembershipSnapshot;
}): Promise<Observation> {
  const projectId = projectIdSchema.safeParse(input.projectId);
  const snapshot = observedSnapshotSchema.safeParse(input.observedGoogle);
  if (!projectId.success || !snapshot.success)
    deny("GOOGLE_CHAT_PROJECT_OBSERVATION_INVALID");
  if (input.actor.actorType !== "staff" || input.actor.clientId !== null)
    deny("GOOGLE_CHAT_PROJECT_ACTOR_INVALID");

  const memberNames = new Set<string>();
  const memberUsers = new Set<string>();
  const botMembers = snapshot.data.members.filter(
    (member) => member.kind === "BOT",
  );
  for (const member of snapshot.data.members) {
    if (
      !member.membershipName.startsWith(`${snapshot.data.spaceName}/members/`) ||
      memberNames.has(member.membershipName) ||
      memberUsers.has(member.userName)
    )
      deny("GOOGLE_CHAT_PROJECT_MEMBER_DUPLICATE");
    memberNames.add(member.membershipName);
    memberUsers.add(member.userName);
  }
  if (
    botMembers.length !== 1 ||
    botMembers[0]?.userName !== snapshot.data.assistantBotUserName
  )
    deny("GOOGLE_CHAT_PROJECT_ASSISTANT_BOT_INVALID");

  const humanByUser = new Map(
    snapshot.data.humans.map((human) => [human.userName, human]),
  );
  if (humanByUser.size !== snapshot.data.humans.length)
    deny("GOOGLE_CHAT_PROJECT_MEMBER_DUPLICATE");
  if (
    snapshot.data.humans.some(
      (human) =>
        !human.membershipName.startsWith(
          `${snapshot.data.spaceName}/members/`,
        ),
    )
  )
    deny("GOOGLE_CHAT_PROJECT_OBSERVATION_INVALID");
  const listedHumans = snapshot.data.members.filter(
    (member) => member.kind === "HUMAN",
  );
  if (
    listedHumans.length !== humanByUser.size ||
    listedHumans.some((member) => {
      const human = humanByUser.get(member.userName);
      return (
        !human ||
        human.membershipName !== member.membershipName ||
        human.role !== member.role
      );
    })
  )
    deny("GOOGLE_CHAT_PROJECT_ROSTER_INCOMPLETE");

  const employees = new Set<string>();
  const roles: Observation["roles"][number][] = [];
  let freshActor: SessionUser | null = null;
  for (const human of snapshot.data.humans) {
    const identity = await resolveEmployeeGoogleIdentity({
      proof: "chat",
      googleChatUser: human.userName,
      action: "resolve_identity",
    });
    if (!identity || employees.has(identity.employeeId))
      deny("GOOGLE_CHAT_PROJECT_IDENTITY_UNRESOLVED");
    const staff = await resolveActiveStaffById(identity.employeeId);
    if (!staff || staff.actorType !== "staff" || staff.clientId !== null)
      deny("GOOGLE_CHAT_PROJECT_IDENTITY_UNRESOLVED");
    await requireProjectAccess(staffContext(staff), projectId.data, "viewer");
    employees.add(identity.employeeId);
    if (identity.employeeId === input.actor.employeeId) freshActor = staff;
    roles.push({ employeeId: identity.employeeId, googleRole: human.role });
  }
  if (!freshActor) deny("GOOGLE_CHAT_PROJECT_ACTOR_NOT_PARTICIPANT");
  await requireProjectAccess(staffContext(freshActor), projectId.data, "admin");
  const actorRole = roles.find(
    (role) => role.employeeId === input.actor.employeeId,
  );
  if (
    !actorRole ||
    !["ROLE_MANAGER", "ROLE_ASSISTANT_MANAGER"].includes(actorRole.googleRole)
  )
    deny("GOOGLE_CHAT_PROJECT_ACTOR_NOT_MANAGER");
  return {
    spaceName: snapshot.data.spaceName,
    assistantBotUserName: snapshot.data.assistantBotUserName,
    humanEmployeeIds: roles.map((role) => role.employeeId),
    roles,
    bindingReady: false,
  };
}
