import { runQmOsTool } from "@/server/qm/os-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const token = request.headers.get("x-agent-capability");
  if (!token || token.length > 16_384)
    return Response.json({ error: "QM_ACCESS_DENIED" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 32_768)
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > 32_768)
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
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
  } catch {
    return Response.json({ error: "QM_OS_TOOL_UNAVAILABLE" }, { status: 403 });
  }
}
