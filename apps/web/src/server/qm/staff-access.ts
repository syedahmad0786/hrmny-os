import { sql } from "@hrmny/db";
import { z } from "zod";
import {
  resolveActiveStaffByEmail,
  sessionCanViewMargin,
  type SessionUser,
} from "../auth/session";
import { getDb } from "../db";
import { requireProjectAccess } from "../trpc/work-management-router";

const identitySchema = z.object({
  actorId: z.string().email().max(320),
  scopeId: z.string().max(400),
  scopeVersion: z.string().max(100).optional(),
});

type QmIdentity = z.infer<typeof identitySchema>;

export type QmBrainContext =
  | { user: SessionUser; scope: { kind: "personal" } }
  | {
      user: SessionUser;
      scope: { kind: "project"; projectId: string; revision: string };
    };

async function qmIdentity(token: string): Promise<QmIdentity> {
  if (!/^[A-Za-z0-9_.-]{1,16384}$/.test(token))
    throw new Error("QM_ACCESS_DENIED");
  const origin = process.env.QM_PUBLIC_URL;
  if (!origin) throw new Error("QM_NOT_CONFIGURED");
  const url = new URL(origin);
  if (
    url.origin !== "https://hrmny-portal.fly.dev" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("QM_URL_INVALID");
  const response = await fetch(new URL("/v1/apis", url), {
    headers: { "x-agent-capability": token },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("QM_ACCESS_DENIED");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("QM_RESPONSE_INVALID");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 128_000) throw new Error("QM_RESPONSE_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return identitySchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
}

function canonicalActor(identity: QmIdentity): boolean {
  return (
    identity.actorId === identity.actorId.trim().toLowerCase() &&
    identity.actorId.endsWith("@hrmny.co")
  );
}

async function activeStaff(identity: QmIdentity): Promise<SessionUser> {
  if (!canonicalActor(identity)) throw new Error("QM_SCOPE_NOT_SUPPORTED");
  const user = await resolveActiveStaffByEmail(identity.actorId);
  if (!user || user.actorType !== "staff" || user.clientId !== null)
    throw new Error("QM_ACCESS_DENIED");
  return user;
}

async function currentWorkRevision(): Promise<string> {
  const db = getDb();
  if (!db) throw new Error("QM_WORK_PROJECTS_DATABASE_REQUIRED");
  const [state] = await db.execute<{ revision: string }>(sql`
    select revision::text as revision
    from qm_internal.work_authority_revision
    where singleton = true
  `);
  if (!state) throw new Error("WORK_AUTHORITY_FENCE_STATE_MISSING");
  return state.revision;
}

async function authorizeProjectScope(
  user: SessionUser,
  projectId: string,
  revision: string,
): Promise<void> {
  if ((await currentWorkRevision()) !== revision)
    throw new Error("QM_WORK_AUTHORITY_REVISION_STALE");
  await requireProjectAccess(
    {
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      clientId: null,
      canViewMargin: sessionCanViewMargin(user),
      requestedFeatureKey: "work.projects",
    },
    projectId,
  );
  if ((await currentWorkRevision()) !== revision)
    throw new Error("QM_WORK_AUTHORITY_REVISION_STALE");
}

export async function qmStaff(token: string) {
  const identity = await qmIdentity(token);
  if (
    !canonicalActor(identity) ||
    identity.scopeId !== `personal:${identity.actorId}`
  )
    throw new Error("QM_SCOPE_NOT_SUPPORTED");
  return activeStaff(identity);
}

/** Brain-only resolution for personal or revision-bound native Work contexts. */
export async function qmBrainContext(token: string): Promise<QmBrainContext> {
  const identity = await qmIdentity(token);
  const user = await activeStaff(identity);
  if (identity.scopeId === `personal:${identity.actorId}`)
    return { user, scope: { kind: "personal" } };
  if (process.env.QM_WORK_PROJECTS_ENABLED !== "1")
    throw new Error("QM_SCOPE_NOT_SUPPORTED");

  const prefix = "group:web-project-";
  const projectId = identity.scopeId.startsWith(prefix)
    ? identity.scopeId.slice(prefix.length)
    : "";
  if (
    identity.scopeId !== `${prefix}${projectId}` ||
    projectId !== projectId.toLowerCase() ||
    !z.string().uuid().safeParse(projectId).success
  )
    throw new Error("QM_SCOPE_NOT_SUPPORTED");
  const match = /^hrmny-work:(0|[1-9]\d*)$/.exec(identity.scopeVersion ?? "");
  if (!match) throw new Error("QM_SCOPE_NOT_SUPPORTED");
  const revision = match[1]!;
  await authorizeProjectScope(user, projectId, revision);
  return { user, scope: { kind: "project", projectId, revision } };
}
