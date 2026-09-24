import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveActiveStaffById, sessionCanViewMargin } from "./auth/session";
import { requireProjectAccess } from "./trpc/work-management-router";

const requestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("search"),
      query: z.string().trim().min(1).max(500),
      projectId: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.enum(["get_page", "get_links", "get_backlinks"]),
      slug: z
        .string()
        .min(1)
        .max(300)
        .regex(/^[a-z0-9][a-z0-9/_-]*$/),
      projectId: z.string().uuid().optional(),
    })
    .strict(),
]);

type GbrainSourceScope = {
  includePersonal: boolean;
  projectId?: string;
  requireWorkFeature: boolean;
};

/** Resolve permissions afresh; never accept source IDs or employee identity from tool arguments. */
async function sourcesForEmployee(
  employeeId: string,
  scope: GbrainSourceScope,
) {
  const user = await resolveActiveStaffById(
    z.string().uuid().parse(employeeId),
  );
  if (!user || user.actorType !== "staff" || user.clientId !== null)
    throw new Error("GBRAIN_ACCESS_DENIED");
  const sources = ["hrmny-company"];
  if (scope.includePersonal) sources.push(`hrmny-personal-${user.employeeId}`);
  if (scope.projectId) {
    await requireProjectAccess(
      {
        user,
        employeeId: user.employeeId,
        roles: user.roles,
        clientId: null,
        canViewMargin: sessionCanViewMargin(user),
        requestedFeatureKey: scope.requireWorkFeature
          ? "work.projects"
          : undefined,
      },
      scope.projectId,
    );
    sources.push(`hrmny-project-${scope.projectId}`);
  }
  return sources;
}

export function gbrainRetrievalConfigured() {
  return Boolean(
    process.env.GBRAIN_RETRIEVAL_URL && process.env.GBRAIN_REQUEST_SECRET,
  );
}

async function readGbrain(
  employeeId: string,
  input: unknown,
  trustedProjectId?: string,
) {
  const parsed = requestSchema.parse(input);
  if (
    trustedProjectId &&
    parsed.projectId &&
    parsed.projectId !== trustedProjectId
  )
    throw new Error("GBRAIN_PROJECT_SCOPE_MISMATCH");
  const scope: GbrainSourceScope = trustedProjectId
    ? {
        includePersonal: false,
        projectId: trustedProjectId,
        requireWorkFeature: true,
      }
    : {
        includePersonal: true,
        projectId: parsed.projectId,
        requireWorkFeature: false,
      };
  const sources = await sourcesForEmployee(employeeId, scope);
  const secret = process.env.GBRAIN_REQUEST_SECRET;
  if (!secret || secret.length < 32 || !process.env.GBRAIN_RETRIEVAL_URL)
    throw new Error("GBRAIN_RETRIEVAL_NOT_CONFIGURED");
  const endpoint = new URL(process.env.GBRAIN_RETRIEVAL_URL);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/read"
  )
    throw new Error("GBRAIN_RETRIEVAL_URL_INVALID");
  const requestId = randomUUID();
  const body = JSON.stringify({
    version: 1,
    audience: "hrmny-brain",
    requestId,
    employeeId,
    expiresAt: Date.now() + 15_000,
    sources,
    operation: parsed.operation,
    args:
      parsed.operation === "search"
        ? { query: parsed.query, limit: 5, snippet_chars: 1200 }
        : { slug: parsed.slug },
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hrmny-signature": createHmac("sha256", secret)
        .update(body)
        .digest("hex"),
    },
    body,
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`GBRAIN_RETRIEVAL_HTTP_${response.status}`);
  if (Number(response.headers.get("content-length")) > 256_000)
    throw new Error("GBRAIN_RESPONSE_TOO_LARGE");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("GBRAIN_RESPONSE_INVALID");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 256_000) throw new Error("GBRAIN_RESPONSE_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    requestId?: string;
    results?: unknown;
  };
  if (result.requestId !== requestId || !Array.isArray(result.results))
    throw new Error("GBRAIN_RESPONSE_INVALID");
  // Membership can be removed while the provider is working; discard the entire response.
  const current = await sourcesForEmployee(employeeId, scope);
  if (JSON.stringify(current) !== JSON.stringify(sources))
    throw new Error("GBRAIN_ACCESS_CHANGED");
  return { requestId, results: result.results };
}

export async function readAuthorizedGbrain(employeeId: string, input: unknown) {
  return readGbrain(employeeId, input);
}

/** Internal shared-context entry point; project scope comes only from native capability verification. */
export async function readAuthorizedProjectGbrain(
  employeeId: string,
  projectId: string,
  input: unknown,
) {
  return readGbrain(employeeId, input, z.string().uuid().parse(projectId));
}
