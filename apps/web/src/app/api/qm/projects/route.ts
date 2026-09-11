import { createHash, timingSafeEqual } from "node:crypto";
import {
  qmWorkProjectsInput,
  readQmWorkProjects,
} from "@/server/qm/work-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const MAX_REQUEST_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 1_024 * 1_024;
const MAX_TOKEN_BYTES = 16_384;
const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function bearerAuthorized(request: Request): boolean {
  const expected = process.env.QM_WORK_AUTHORITY_TOKEN;
  if (
    !expected ||
    expected.length < 32 ||
    Buffer.byteLength(expected) > MAX_TOKEN_BYTES ||
    /\s/.test(expected)
  )
    return false;
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  );
  if (!match || Buffer.byteLength(match[1]!) > MAX_TOKEN_BYTES) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(match[1]!).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES)
    throw new Error("PAYLOAD_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request) {
  if (
    process.env.QM_WORK_PROJECTS_ENABLED !== "1" ||
    !bearerAuthorized(request)
  )
    return jsonResponse({ error: "QM_WORK_PROJECTS_DENIED" }, 403);

  let body: string;
  try {
    body = await readBoundedBody(request);
  } catch {
    return jsonResponse({ error: "PAYLOAD_TOO_LARGE" }, 413);
  }
  let input: unknown;
  try {
    input = qmWorkProjectsInput.parse(JSON.parse(body));
  } catch {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }

  try {
    const serialized = JSON.stringify(await readQmWorkProjects(input));
    if (Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES)
      return jsonResponse(
        { error: "QM_WORK_PROJECTS_RESPONSE_TOO_LARGE" },
        503,
      );
    return new Response(serialized, { status: 200, headers: responseHeaders });
  } catch {
    return jsonResponse({ error: "QM_WORK_PROJECTS_UNAVAILABLE" }, 503);
  }
}
