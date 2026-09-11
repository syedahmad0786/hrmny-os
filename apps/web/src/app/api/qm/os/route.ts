import { QmInvalidInputError, runQmOsTool } from "@/server/qm/os-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function boundedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 32_768) throw new Error("PAYLOAD_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request) {
  const token = request.headers.get("x-agent-capability");
  if (!token || token.length > 16_384)
    return Response.json({ error: "QM_ACCESS_DENIED" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 32_768)
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  let body: string;
  try {
    body = await boundedBody(request);
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
    return Response.json(await runQmOsTool(token, input), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof QmInvalidInputError)
      return Response.json(
        {
          error: "QM_INVALID_INPUT",
          fields: error.fields,
          ...(error.allowedValues
            ? { allowedValues: error.allowedValues }
            : {}),
        },
        { status: 400 },
      );
    return Response.json({ error: "QM_OS_TOOL_UNAVAILABLE" }, { status: 403 });
  }
}
