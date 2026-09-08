import { z } from "zod";
import { resolveActiveStaffByEmail } from "../auth/session";
import { readAuthorizedGbrain } from "../gbrain-access";

const identitySchema = z.object({
  actorId: z.string().email().max(320),
  scopeId: z.string().max(400),
});

async function qmStaff(token: string) {
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
  const identity = identitySchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  if (
    identity.actorId !== identity.actorId.trim().toLowerCase() ||
    !identity.actorId.endsWith("@hrmny.co") ||
    identity.scopeId !== `personal:${identity.actorId}`
  )
    throw new Error("QM_SCOPE_NOT_SUPPORTED");
  const user = await resolveActiveStaffByEmail(identity.actorId);
  if (!user || user.actorType !== "staff" || user.clientId !== null)
    throw new Error("QM_ACCESS_DENIED");
  return user;
}

/** Core verifies its own per-run token; the OS retains staff and source authority. */
export async function readQmBrain(token: string, input: unknown) {
  const user = await qmStaff(token);
  const result = await readAuthorizedGbrain(user.employeeId, input);
  const current = await qmStaff(token);
  if (current.employeeId !== user.employeeId)
    throw new Error("QM_ACCESS_CHANGED");
  return result;
}
