import { readQmBrain } from "@/server/qm/brain-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 8_192;

async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
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
      if (size > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request) {
  if (process.env.QM_BRAIN_ENABLED !== "1")
    return Response.json({ error: "QM_BRAIN_UNAVAILABLE" }, { status: 403 });
  const token = request.headers.get("x-agent-capability");
  if (!token || token.length > 16_384)
    return Response.json({ error: "QM_ACCESS_DENIED" }, { status: 403 });
  let body: string;
  try {
    body = await readBoundedBody(request);
  } catch {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  try {
    return Response.json(await readQmBrain(token, input), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "QM_BRAIN_UNAVAILABLE" }, { status: 403 });
  }
}
